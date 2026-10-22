import type { PointerEvent } from 'react';

/** Клавиши, которых нет на экранной клавиатуре. bytes — что уходит в терминал; arrow — стрелка (зависит от режима курсора). */
const KEYS: { label: string; name: string; bytes?: string; arrow?: 'A' | 'B' | 'C' | 'D' }[] = [
  { label: 'Esc', name: 'Esc', bytes: '\x1b' },
  { label: 'Tab', name: 'Tab', bytes: '\t' },
  { label: '↑', name: 'Вверх', arrow: 'A' },
  { label: '↓', name: 'Вниз', arrow: 'B' },
  { label: '←', name: 'Влево', arrow: 'D' },
  { label: '→', name: 'Вправо', arrow: 'C' },
  { label: '/', name: '/', bytes: '/' },
  { label: '|', name: '|', bytes: '|' },
  { label: '~', name: '~', bytes: '~' },
  { label: '-', name: '-', bytes: '-' },
  { label: '⏎', name: 'Enter', bytes: '\r' },
];

/**
 * Строка клавиш над экранной клавиатурой (телефон). Ctrl залипает до следующей клавиши.
 * Нажатие не забирает фокус: клавиатура остаётся открытой, ввод — в терминале.
 */
export function KeyRow(props: { ctrl: boolean; onCtrl(): void; onKey(bytes: string): void; appCursor: () => boolean }) {
  const keep = (e: PointerEvent) => e.preventDefault();
  return (
    <div role="toolbar" aria-label="Клавиши терминала" className="key-row">
      <button type="button" className="key" aria-pressed={props.ctrl} onPointerDown={keep} onClick={props.onCtrl}>
        Ctrl
      </button>
      {KEYS.map((k) => (
        <button
          key={k.name}
          type="button"
          className="key"
          aria-label={k.name === k.label ? undefined : k.name}
          onPointerDown={keep}
          onClick={() => props.onKey(k.arrow ? `\x1b${props.appCursor() ? 'O' : '['}${k.arrow}` : k.bytes!)}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}
