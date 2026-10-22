import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { BottomSheet } from './BottomSheet';
import { IconChevronLeft, IconChevronRight } from './icons';
import { useBack } from '../back-stack';

export interface MenuEntry {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  onSelect?: () => void;
  submenu?: MenuEntry[];
}

/**
 * Меню по ПКМ / Shift+F10: стрелки, Enter, → открывает подменю, ← и Esc закрывают.
 * variant 'sheet' (телефон, долгое нажатие) — нижним листом; подменю открывается внутри листа со строкой «‹ Назад».
 */
export function ContextMenu(props: { label: string; x: number; y: number; items: MenuEntry[]; onClose: () => void; variant?: 'popup' | 'sheet' }) {
  if (props.variant === 'sheet') return <SheetMenu label={props.label} items={props.items} onClose={props.onClose} />;
  return <PopupMenu {...props} />;
}

function PopupMenu(props: { label: string; x: number; y: number; items: MenuEntry[]; onClose: () => void }) {
  useBack(true, props.onClose);
  const root = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<{ index: number; focus: boolean } | null>(null);
  const [pos, setPos] = useState({ left: props.x, top: props.y });

  // Не вылезать за окно
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(props.x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(props.y, window.innerHeight - r.height - 4)),
    });
  }, [props.x, props.y]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) props.onClose();
    };
    document.addEventListener('mousedown', away);
    return () => {
      document.removeEventListener('mousedown', away);
      if (prev?.isConnected) prev.focus();
    };
  }, []);

  const select = (e: MenuEntry, index: number) => {
    if (e.disabled) return;
    if (e.submenu) return setSub({ index, focus: true });
    props.onClose();
    e.onSelect?.();
  };

  const onKey = (ev: KeyboardEvent<HTMLDivElement>, inSub: boolean) => {
    const menu = ev.currentTarget;
    const items = [...menu.querySelectorAll<HTMLButtonElement>(':scope > [role="menuitem"]:not([disabled])')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      ev.stopPropagation();
      const d = ev.key === 'ArrowDown' ? 1 : -1;
      items[(i + d + items.length) % items.length]?.focus();
    } else if (ev.key === 'Escape' || (inSub && ev.key === 'ArrowLeft')) {
      ev.preventDefault();
      ev.stopPropagation();
      if (inSub) {
        const back = sub?.index;
        setSub(null);
        root.current?.querySelectorAll<HTMLButtonElement>(':scope > [role="menuitem"]')[back ?? 0]?.focus();
      } else props.onClose();
    } else if (ev.key === 'Tab') props.onClose();
  };

  const render = (items: MenuEntry[], onPick: (e: MenuEntry, i: number) => void, withSub: boolean) =>
    items.map((e, i) =>
      e.separator ? (
        <div key={`sep-${i}`} role="separator" className="ctx-sep" />
      ) : (
        <button
          key={`${i}-${e.label}`} // имена групп могут повторяться
          type="button"
          role="menuitem"
          disabled={e.disabled}
          aria-haspopup={e.submenu ? 'menu' : undefined}
          aria-expanded={e.submenu ? sub?.index === i : undefined}
          className={e.danger ? 'ctx-item ctx-danger' : 'ctx-item'}
          onClick={() => onPick(e, i)}
          onMouseEnter={withSub ? () => setSub(e.submenu ? { index: i, focus: false } : null) : undefined}
          onKeyDown={(ev) => {
            if (withSub && e.submenu && ev.key === 'ArrowRight') {
              ev.preventDefault();
              setSub({ index: i, focus: true });
            }
          }}
        >
          {e.icon ?? <span className="ctx-icon" aria-hidden="true" />}
          <span className="grow">{e.label}</span>
          {e.submenu ? <IconChevronRight /> : null}
        </button>
      ),
    );

  const subItems = sub ? props.items[sub.index]?.submenu : undefined;
  return (
    <div
      ref={root}
      role="menu"
      aria-label={props.label}
      className="popup ctx-menu"
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={(ev) => onKey(ev, false)}
      onContextMenu={(ev) => ev.preventDefault()}
    >
      {render(props.items, select, true)}
      {subItems && sub ? (
        <SubMenu label={props.items[sub.index].label} focus={sub.focus} onKeyDown={(ev) => onKey(ev, true)}>
          {render(subItems, (e) => select(e, -1), false)}
        </SubMenu>
      ) : null}
    </div>
  );
}

function SubMenu(props: { label: string; focus: boolean; children: ReactNode; onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (props.focus) ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
  }, [props.focus]);
  return (
    <div ref={ref} role="menu" aria-label={props.label} className="popup ctx-menu ctx-sub" onKeyDown={props.onKeyDown}>
      {props.children}
    </div>
  );
}

/** Меню нижним листом: подменю — переход внутри листа. */
function SheetMenu(props: { label: string; items: MenuEntry[]; onClose: () => void }) {
  const [sub, setSub] = useState<number | null>(null);
  const entries = sub === null ? props.items : (props.items[sub]?.submenu ?? []);
  const pick = (e: MenuEntry, i: number) => {
    if (e.disabled) return;
    if (sub === null && e.submenu) return setSub(i);
    props.onClose();
    e.onSelect?.();
  };
  return (
    <BottomSheet open title={props.label} onClose={props.onClose}>
      <div role="menu" aria-label={sub === null ? props.label : props.items[sub].label} className="sheet-section">
        {sub !== null ? (
          <button type="button" role="menuitem" aria-label="Назад" className="ctx-item" onClick={() => setSub(null)}>
            <IconChevronLeft />
            <span className="grow">{props.items[sub].label}</span>
          </button>
        ) : null}
        {entries.map((e, i) =>
          e.separator ? (
            <div key={`sep-${i}`} role="separator" className="ctx-sep" />
          ) : (
            <button
              key={`${i}-${e.label}`}
              type="button"
              role="menuitem"
              disabled={e.disabled}
              aria-haspopup={e.submenu ? 'menu' : undefined}
              className={e.danger ? 'ctx-item ctx-danger' : 'ctx-item'}
              onClick={() => pick(e, i)}
            >
              {e.icon ?? <span className="ctx-icon" aria-hidden="true" />}
              <span className="grow">{e.label}</span>
              {e.submenu ? <IconChevronRight /> : null}
            </button>
          ),
        )}
      </div>
    </BottomSheet>
  );
}
