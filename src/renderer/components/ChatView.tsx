import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChatItem } from '@shared/ipc';
import { displayName, isImageName } from '@shared/upload-name';
import { api } from '../api';
import { FOLLOW_START, followOnScroll, followUserUp, type Follow } from '../follow';
import { getState, togglePinned, typingDone, useAppState } from '../state';
import { orderPins, pinnable, pinText, stepActive } from '../pins';
import { longPress } from '../long-press';
import { ContextMenu } from './ContextMenu';
import { PinBar } from './PinBar';
import { ChatItemView } from './ChatItemView';
import { MenuCard } from './MenuCard';
import { placeAnswers } from '../menu-history';
import { IconFile, IconImage, IconPin, IconUnpin } from './icons';
import { Spinner } from './Spinner';

const UP_KEYS = new Set(['ArrowUp', 'PageUp', 'Home']);

/** Лента переписки открытой сессии (вместо терминала, пока работает claude). */
export function ChatView({ session }: { session: string }) {
  const chat = useAppState().chat[session];
  const items = chat?.items ?? [];
  const status = chat?.screen?.kind === 'prompt' ? chat.screen.status : null;
  const working = status !== null || (!!chat?.busy && chat.screen?.kind !== 'menu');
  const menu = chat?.screen?.kind === 'menu' ? chat.screen.menu : null;
  // Итоги ответов на меню — на месте карточки: после элемента, который был последним, когда меню открылось
  const answers = useMemo(() => placeAnswers(items.map((i) => i.id), chat?.answers ?? []), [items, chat?.answers]);
  const pending = chat?.pending ?? [];
  const typing = chat?.typing ?? {};
  // Пока ответ «печатается», лента следит за низом
  const [tick, setTick] = useState(0);
  const box = useRef<HTMLElement>(null);
  // Слежение за низом; пользователь сам ушёл вверх (колесо, клавиши) — только когда докрутит до самого низа
  const follow = useRef<Follow>(FOLLOW_START);
  const sentIds = useRef(new Set(pending.map((p) => p.id)));
  const hadMenu = useRef(false);
  const restore = useRef<number | null>(null);
  const [behind, setBehind] = useState(false);
  const [loading, setLoading] = useState(false);
  // Закреплённое: порядок как в ленте, какое показано на панели, меню (ПКМ мышью, долгое нажатие пальцем — нижним листом), подсветка после перехода
  const ordered = useMemo(() => orderPins(chat?.pins ?? [], items.map((i) => i.id)), [chat?.pins, items]);
  const [activePin, setActivePin] = useState<string | null>(null);
  const shownPin = ordered.find((p) => p.id === activePin)?.id ?? ordered.at(-1)?.id ?? null;
  const [ctx, setCtx] = useState<{ x: number; y: number; id: string; sheet: boolean } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const lastTouch = useRef(0);
  const fromTouch = () => Date.now() - lastTouch.current < 2000;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Долгое нажатие пальцем по сообщению; следом WebView сам шлёт contextmenu — его при касании не слушаем
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const touched = (e: globalThis.PointerEvent) => {
      if (e.pointerType === 'touch') lastTouch.current = Date.now();
    };
    el.addEventListener('pointerdown', touched, true);
    const off = longPress(el, (x, y, target) => {
      const id = target?.closest<HTMLElement>('[data-item-id]')?.dataset.itemId;
      if (id) setCtx({ x, y, id, sheet: true });
    });
    return () => {
      off();
      el.removeEventListener('pointerdown', touched, true);
    };
  }, []);

  // Новые сообщения: прокрутка вниз, если пользователь и так был внизу; ранняя часть — без прыжка
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (restore.current !== null) {
      el.scrollTop = el.scrollHeight - restore.current;
      restore.current = null;
      return;
    }
    // Своё новое сообщение и вопрос Claude Code — вниз, где бы ни была лента (как на claude.ai)
    const fresh = pending.some((p) => !sentIds.current.has(p.id)) || (menu !== null && !hadMenu.current);
    hadMenu.current = menu !== null;
    sentIds.current = new Set(pending.map((p) => p.id));
    if (fresh) {
      follow.current = FOLLOW_START;
      setBehind(false);
    }
    if (follow.current.atBottom) el.scrollTop = el.scrollHeight;
    else setBehind(true);
  }, [items, status, pending, tick, menu, chat?.answers]);

  // Содержимое растёт само («печать» ответа) — держим низ, если пользователь внизу
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    const content = inner.current;
    if (!el || !content) return;
    const ro = new ResizeObserver(() => {
      if (follow.current.atBottom) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    follow.current = followOnScroll(follow.current, { scrollTop: el.scrollTop, gap: el.scrollHeight - el.scrollTop - el.clientHeight });
    if (follow.current.atBottom) setBehind(false);
  };
  const goingUp = () => {
    const el = box.current;
    if (!el || el.scrollTop <= 0) return; // некуда вверх — лента не прокручивается
    follow.current = followUserUp(follow.current, el.scrollTop);
  };

  const loadEarlier = async () => {
    const el = box.current;
    if (el) restore.current = el.scrollHeight - el.scrollTop;
    setLoading(true);
    await api.chat.loadEarlier();
    setLoading(false);
  };

  const find = (id: string) => [...(box.current?.querySelectorAll<HTMLElement>('[data-item-id]') ?? [])].find((e) => e.dataset.itemId === id) ?? null;

  /** К закреплённому сообщению; если оно в ранней части журнала — подгружаем, пока не найдётся. */
  const jump = async (id: string) => {
    let el = find(id);
    while (!el && getState().chat[session]?.hasEarlier) {
      await api.chat.loadEarlier();
      await new Promise((r) => setTimeout(r, 50));
      el = find(id);
    }
    setActivePin(stepActive(ordered, id));
    if (!el) {
      // Сообщения нет в журнале — закрепление зря
      togglePinned(session, { id, text: '' });
      return;
    }
    // Лента не должна тут же прыгнуть обратно вниз
    follow.current = followUserUp(follow.current, box.current?.scrollTop ?? 1);
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setFlash(id);
    setTimeout(() => setFlash((f) => (f === id ? null : f)), 1400);
  };

  const row = (i: ChatItem) => {
    const view = (
      <ChatItemView
        item={i}
        typingSince={typing[i.id]}
        onTyped={typing[i.id] !== undefined ? () => {
          typingDone(session, i.id);
          setTick((t) => t + 1);
        } : undefined}
      />
    );
    if (!pinnable(i)) return view;
    const pinned = ordered.some((p) => p.id === i.id);
    return (
      <div
        className={`chat-item chat-item-${i.kind}${pinned ? ' is-pinned' : ''}${flash === i.id ? ' is-flash' : ''}`}
        data-item-id={i.id}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!fromTouch()) setCtx({ x: e.clientX, y: e.clientY, id: i.id, sheet: false });
        }}
      >
        {pinned ? <span className="pin-mark" title="Закреплено"><IconPin /></span> : null}
        {view}
      </div>
    );
  };

  return (
    <section
      aria-label="Переписка"
      className="chat"
      ref={box}
      // Щелчок по ленте отдаёт ей фокус: иначе фокус на body, Chromium листает ленту клавишами, а onKeyDown молчит
      tabIndex={-1}
      onScroll={onScroll}
      onWheel={(e) => e.deltaY < 0 && goingUp()}
      onKeyDown={(e) => UP_KEYS.has(e.key) && goingUp()}
    >
      {shownPin ? <PinBar pins={ordered} active={shownPin} onJump={(id) => void jump(id)} /> : null}
      <div className="chat-inner" ref={inner}>
        {chat?.hasEarlier ? (
          <button type="button" className="btn btn-sm chat-earlier" disabled={loading} onClick={() => void loadEarlier()}>
            Показать раньше
          </button>
        ) : null}
        {items.length === 0 && pending.length === 0 && !working ? <p className="caption chat-empty">Переписка пока пустая</p> : null}
        {/* Итоги без якоря — начало сессии: пока ранняя часть журнала не загружена, им тут не место */}
        {chat?.hasEarlier ? null : answers.top.map((a) => <ChatItemView key={a.id} item={{ kind: 'note', id: a.id, text: a.text }} />)}
        {items.map((i) => (
          <Fragment key={i.id}>
            {row(i)}
            {answers.after.get(i.id)?.map((a) => <ChatItemView key={a.id} item={{ kind: 'note', id: a.id, text: a.text }} />)}
          </Fragment>
        ))}
        {pending.map((p) => (
          <div key={p.id} className={p.state === 'sending' ? 'bubble is-sending' : 'bubble'}>
            {p.files.map((f) => (
              <span key={f} className="img-chip">
                {isImageName(f) ? <IconImage /> : <IconFile />}
                {displayName(f)}
              </span>
            ))}
            {p.text ? <span className="bubble-text">{p.text}</span> : null}
          </div>
        ))}
        {menu ? <MenuCard session={session} menu={menu} /> : null}
        {working ? (
          <div className="chat-status" role="status">
            <Spinner /> {status ?? 'Claude работает…'}
          </div>
        ) : null}
      </div>
      {behind ? (
        <button
          type="button"
          className="btn btn-sm chat-new"
          onClick={() => {
            const el = box.current;
            follow.current = FOLLOW_START;
            if (el) el.scrollTop = el.scrollHeight;
            setBehind(false);
          }}
        >
          ↓ Новые сообщения
        </button>
      ) : null}
      {ctx ? (() => {
        const item = items.find((i) => i.id === ctx.id);
        if (!item || !pinnable(item)) return null;
        const pinned = ordered.some((p) => p.id === item.id);
        return (
          <ContextMenu
            label="Сообщение"
            x={ctx.x}
            y={ctx.y}
            variant={ctx.sheet ? 'sheet' : 'popup'}
            items={
              pinned
                ? [{ label: 'Открепить', icon: <IconUnpin />, onSelect: () => togglePinned(session, { id: item.id, text: '' }) }]
                : [{
                    label: 'Прикрепить',
                    icon: <IconPin />,
                    onSelect: () => {
                      togglePinned(session, { id: item.id, text: pinText(item) });
                      setActivePin(item.id);
                    },
                  }]
            }
            onClose={() => setCtx(null)}
          />
        );
      })() : null}
    </section>
  );
}
