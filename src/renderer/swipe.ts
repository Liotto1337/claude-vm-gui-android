const MIN_DISTANCE = 50;

/** Горизонтальный свайп (dx, dy в пикселях): +1 — следующее (палец влево), −1 — предыдущее, 0 — не свайп. */
export function swipeStep(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}

/** Индекс после шага; на краях остаётся на месте. */
export const stepIndex = (index: number, step: number, count: number) => Math.min(count - 1, Math.max(0, index + step));
