import { useEffect, type ReactNode } from 'react';

/** С какого расстояния от левого края касание считается свайпом панели и сколько надо провести. */
const EDGE = 24;
const SWIPE = 60;

/** Выдвижная панель слева (телефон): кнопка ☰, свайп от левого края; касание фона закрывает. */
export function Drawer({ open, onOpen, onClose, children }: { open: boolean; onOpen(): void; onClose(): void; children: ReactNode }) {
  useEffect(() => {
    let start: { x: number; y: number } | null = null;
    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      start = !open && t && t.clientX <= EDGE ? { x: t.clientX, y: t.clientY } : null;
    };
    const move = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!start || !t) return;
      const dx = t.clientX - start.x;
      if (dx > SWIPE && Math.abs(t.clientY - start.y) < dx) {
        start = null;
        onOpen();
      }
    };
    document.addEventListener('touchstart', down, { passive: true });
    document.addEventListener('touchmove', move, { passive: true });
    return () => {
      document.removeEventListener('touchstart', down);
      document.removeEventListener('touchmove', move);
    };
  }, [open, onOpen]);

  return (
    <>
      <div className={open ? 'drawer drawer-open' : 'drawer'} inert={!open}>
        {children}
      </div>
      {open ? <div className="drawer-scrim" data-testid="drawer-scrim" onClick={onClose} /> : null}
    </>
  );
}
