/**
 * Долгое нажатие пальцем (телефон): удержание ms (500) без сдвига больше slop (10 px) вызывает cb в точке нажатия.
 * Мышь не участвует — у неё ПКМ. Клик после срабатывания проглатывается. Возвращает отписку.
 */
export function longPress(el: HTMLElement, cb: (x: number, y: number) => void, opts: { ms?: number; slop?: number } = {}): () => void {
  const ms = opts.ms ?? 500;
  const slop = opts.slop ?? 10;
  let press: { timer: ReturnType<typeof setTimeout>; x: number; y: number; id: number } | null = null;
  // Сработало — отпускание пальца не должно стать обычным кликом: ни по строке под пальцем,
  // ни по фону только что открытого меню (клик приходит туда, где палец, — ловим на уровне документа)
  const clickTarget: EventTarget = el.ownerDocument ?? el;
  let swallow = false;
  const click = (e: Event) => {
    if (!swallow) return;
    swallow = false;
    e.stopImmediatePropagation();
    e.preventDefault();
  };
  // Клик после срабатывания может и не прийти: новое касание где угодно (палец того жеста уже прижат) — другой жест, его клик не трогаем
  const anyDown = () => {
    swallow = false;
  };
  const cancel = () => {
    if (press) clearTimeout(press.timer);
    press = null;
  };
  const down = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    cancel();
    swallow = false;
    const { clientX: x, clientY: y } = e;
    press = {
      x,
      y,
      id: e.pointerId,
      timer: setTimeout(() => {
        press = null;
        swallow = true;
        cb(x, y);
      }, ms),
    };
  };
  const move = (e: PointerEvent) => {
    if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > slop) cancel();
  };
  clickTarget.addEventListener('click', click, true);
  clickTarget.addEventListener('pointerdown', anyDown, true);
  el.addEventListener('pointerdown', down as EventListener);
  el.addEventListener('pointermove', move as EventListener);
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  return () => {
    cancel();
    clickTarget.removeEventListener('click', click, true);
    clickTarget.removeEventListener('pointerdown', anyDown, true);
    el.removeEventListener('pointerdown', down as EventListener);
    el.removeEventListener('pointermove', move as EventListener);
    el.removeEventListener('pointerup', cancel);
    el.removeEventListener('pointercancel', cancel);
  };
}
