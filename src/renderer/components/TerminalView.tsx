import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { ExitReason } from '@shared/ipc';
import { parseOsc52 } from '@shared/osc52';
import { ctrlKey } from '@shared/paste';
import { api } from '../api';
import { refreshSessions, useAppState } from '../state';
import { muteDeviceAttributes } from '../terminal-reports';
import { terminalTheme } from '../terminal-theme';
import { FONT_DEFAULT, pinchFontSize, rowAt } from '../terminal-touch';
import { usePhone } from '../use-phone';
import { KeyRow } from './KeyRow';

const EXIT_TEXT: Record<Exclude<ExitReason, 'connection-lost'>, string> = {
  killed: 'Сессия завершена',
  detached: 'Отключено от сессии',
};

/** xterm.js, привязанный к PTY-каналу `tmux attach` выбранной сессии. */
/** hidden — показана лента: терминал остаётся в разметке (размер PTY не меняется), но невидим. */
export function TerminalView({ name, hidden = false }: { name: string; hidden?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const { theme } = useAppState();
  const [exit, setExit] = useState<Exclude<ExitReason, 'connection-lost'> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const phone = usePhone();
  const phoneRef = useRef(phone);
  phoneRef.current = phone;
  // Залипающий Ctrl строки клавиш: следующая клавиша уходит как Ctrl+клавиша
  const [ctrl, setCtrl] = useState(false);
  const ctrlRef = useRef(false);
  const armCtrl = (on: boolean) => {
    ctrlRef.current = on;
    setCtrl(on);
  };
  // Выделение долгим нажатием (телефон) — кнопка «Копировать» над ним
  const [copyable, setCopyable] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    setExit(null);
    const term = new Terminal({
      fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
      fontSize: FONT_DEFAULT,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: false,
      theme: terminalTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    const unmute = muteDeviceAttributes(term);
    termRef.current = term;
    fitRef.current = fit;
    fit.fit();

    const copySelection = () => {
      const text = term.getSelection();
      if (!text) return false;
      api.clipboard.write(text);
      return true;
    };
    const pasteClipboard = () => {
      void api.clipboard.read().then((t) => t && term.paste(t)).catch(() => undefined);
    };
    // Выделение мышью в Claude Code и копирование в tmux приходят как OSC 52 — кладём текст в буфер Windows
    const osc52 = term.parser.registerOscHandler(52, (data) => {
      const text = parseOsc52(data);
      if (text) api.clipboard.write(text);
      return true;
    });
    // Claude Code включает отслеживание всех движений мыши; xterm.js считает их вводом и снимает
    // выделение (Shift+мышь) при первом же движении. Пока выделение есть, движение без кнопок не передаём.
    const keepSelection = (e: MouseEvent) => {
      if (e.buttons === 0 && term.hasSelection()) e.stopPropagation();
    };
    el.addEventListener('mousemove', keepSelection, true);
    // Ctrl+C копирует, когда есть выделение (иначе это прерывание для claude); Ctrl+Shift+C/V — всегда.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey || e.altKey || e.metaKey) return true;
      const key = e.key.toLowerCase();
      if (key === 'c' && (e.shiftKey || term.hasSelection())) {
        copySelection();
        return false;
      }
      if (key === 'v' && e.shiftKey) {
        pasteClipboard();
        return false;
      }
      return true;
    });
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      // На телефоне долгое нажатие — выделение строк, а не вставка
      if (phoneRef.current) return;
      if (!copySelection()) pasteClipboard();
    };
    el.addEventListener('contextmenu', onContext);

    const offData = api.term.onData((d) => term.write(d));
    const offExit = api.term.onExit((reason) => {
      if (reason === 'connection-lost') return;
      setExit(reason);
      void refreshSessions();
    });
    const input = term.onData((d) => {
      if (ctrlRef.current) {
        armCtrl(false);
        const c = ctrlKey(d);
        if (c) return api.term.write(c);
      }
      api.term.write(d);
    });
    void api.platform.pref('terminalFontSize').then((v) => {
      const size = Number(v);
      if (size && termRef.current === term) {
        term.options.fontSize = pinchFontSize(size, 1);
        fit.fit();
        api.term.resize(term.cols, term.rows);
      }
    });
    const touch = touchGestures(el, term, () => {
      fit.fit();
      api.term.resize(term.cols, term.rows);
    }, setCopyable);
    void api.term.open(name, term.cols, term.rows).then((r) => {
      if (!r.ok) setExit('killed');
      else if (!hiddenRef.current) term.focus();
    });

    const ro = new ResizeObserver(() => {
      // Спрятан под лентой — размер PTY не трогаем: иначе открытая клавиатура телефона сжимает терминал до нескольких строк,
      // и Claude Code перерисовывает в них меню (теряются заголовок и варианты). Подгонка — когда терминал снова виден
      if (hiddenRef.current) return;
      fit.fit();
      api.term.resize(term.cols, term.rows);
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      touch();
      el.removeEventListener('contextmenu', onContext);
      el.removeEventListener('mousemove', keepSelection, true);
      osc52.dispose();
      unmute();
      input.dispose();
      offData();
      offExit();
      term.dispose();
      termRef.current = null;
    };
  }, [name, attempt]);

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = terminalTheme(theme);
  }, [theme]);

  // Спрятан под ленту — фокус из терминала в поле ввода, иначе нажатия ушли бы в невидимый терминал.
  // Снова видим — подогнать размер и отдать фокус
  useEffect(() => {
    if (hidden) {
      const a = document.activeElement;
      if (!a || a === document.body || host.current?.contains(a)) {
        termRef.current?.blur();
        document.getElementById('composer-input')?.focus();
      }
      return;
    }
    if (!termRef.current) return;
    fitRef.current?.fit();
    api.term.resize(termRef.current.cols, termRef.current.rows);
    termRef.current.focus();
  }, [hidden]);

  const keyRow =
    phone && !hidden && !exit ? (
      <KeyRow
        ctrl={ctrl}
        onCtrl={() => armCtrl(!ctrlRef.current)}
        appCursor={() => termRef.current?.modes.applicationCursorKeysMode ?? false}
        onKey={(bytes) => {
          // Ctrl + клавиша строки: / и прочее без Ctrl-варианта уходят как есть
          const c = ctrlRef.current && bytes.length === 1 ? ctrlKey(bytes) : null;
          if (ctrlRef.current) armCtrl(false);
          api.term.write(c ?? bytes);
          termRef.current?.focus();
        }}
      />
    ) : null;

  return (
    <>
      <section aria-label="Терминал" className={hidden ? 'terminal-card is-hidden' : 'terminal-card'} aria-hidden={hidden || undefined}>
        <div ref={host} className="terminal-host" />
        {copyable ? (
          <button
            type="button"
            className="btn btn-sm copy-btn"
            onClick={() => {
              const t = termRef.current;
              const text = t?.getSelection();
              if (text) api.clipboard.write(text);
              t?.clearSelection();
              setCopyable(false);
            }}
          >
            Копировать
          </button>
        ) : null}
        {exit ? (
          <div className="terminal-exit" role="status">
            <p>{EXIT_TEXT[exit]}</p>
            {exit === 'detached' ? (
              <button type="button" className="btn" onClick={() => setAttempt((a) => a + 1)}>Подключиться снова</button>
            ) : null}
          </div>
        ) : null}
      </section>
      {keyRow}
    </>
  );
}

/**
 * Касания терминала (телефон): щипок двумя пальцами — размер шрифта (запоминается),
 * долгое нажатие и ведение — выделение строк, потом «Копировать». Возвращает отписку.
 */
function touchGestures(el: HTMLElement, term: Terminal, refit: () => void, onSelection: (has: boolean) => void): () => void {
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { dist: number; size: number } | null = null;
  let press: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | null = null;
  let anchor: number | null = null;
  const dist = () => {
    const [a, b] = [...touches.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const row = (y: number) => term.buffer.active.viewportY + rowAt(y, el.getBoundingClientRect(), term.rows);
  const cancelPress = () => {
    if (press) clearTimeout(press.timer);
    press = null;
  };

  const down = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      cancelPress();
      pinch = { dist: dist(), size: term.options.fontSize ?? FONT_DEFAULT };
      return;
    }
    cancelPress();
    press = {
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => {
        press = null;
        anchor = row(e.clientY);
        term.selectLines(anchor, anchor);
      }, 500),
    };
  };
  const move = (e: PointerEvent) => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size === 2) {
      const size = pinchFontSize(pinch.size, dist() / pinch.dist);
      if (size !== term.options.fontSize) {
        term.options.fontSize = size;
        refit();
      }
      return;
    }
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancelPress();
    if (anchor !== null) {
      const r = row(e.clientY);
      term.selectLines(Math.min(anchor, r), Math.max(anchor, r));
      e.preventDefault();
    }
  };
  const up = (e: PointerEvent) => {
    if (!touches.delete(e.pointerId)) return;
    cancelPress();
    if (pinch && touches.size < 2) {
      void api.platform.setPref('terminalFontSize', String(term.options.fontSize));
      pinch = null;
    }
    if (anchor !== null) {
      anchor = null;
      onSelection(term.hasSelection());
    }
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  return () => {
    cancelPress();
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
  };
}
