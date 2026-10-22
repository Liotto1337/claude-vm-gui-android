import { useRef, type ReactNode, type TouchEvent } from 'react';
import { useBack } from '../back-stack';

/** Насколько протянуть лист вниз, чтобы он закрылся. */
const CLOSE_DRAG = 80;

/** Нижний лист (телефон): касание фона, свайп вниз и «Назад» закрывают. */
export function BottomSheet({ open, title, onClose, children }: { open: boolean; title: string; onClose(): void; children: ReactNode }) {
  useBack(open, onClose);
  const sheet = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  if (!open) return null;

  const touchStart = (e: TouchEvent) => {
    // Тянуть можно, только когда содержимое листа прокручено к началу
    startY.current = (sheet.current?.scrollTop ?? 0) <= 0 ? (e.touches[0]?.clientY ?? null) : null;
  };
  const touchMove = (e: TouchEvent) => {
    const y = e.touches[0]?.clientY;
    if (startY.current === null || y === undefined || !sheet.current) return;
    const dy = Math.max(0, y - startY.current);
    sheet.current.style.transform = dy ? `translateY(${dy}px)` : '';
  };
  const touchEnd = (e: TouchEvent) => {
    const y = e.changedTouches[0]?.clientY;
    const dy = startY.current === null || y === undefined ? 0 : y - startY.current;
    startY.current = null;
    if (sheet.current) sheet.current.style.transform = '';
    if (dy > CLOSE_DRAG) onClose();
  };

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={touchStart}
        onTouchMove={touchMove}
        onTouchEnd={touchEnd}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <h2 className="sheet-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}
