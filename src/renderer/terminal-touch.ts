/** Размер шрифта терминала: по умолчанию как на Windows, щипком — от 10 до 22. */
export const FONT_DEFAULT = 13;
export const FONT_MIN = 10;
export const FONT_MAX = 22;

export function pinchFontSize(start: number, scale: number): number {
  return Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(start * scale)));
}

/** Строка экрана терминала под точкой y (выделение долгим нажатием). */
export function rowAt(y: number, box: { top: number; height: number }, rows: number): number {
  const r = Math.floor(((y - box.top) / box.height) * rows);
  return Math.min(rows - 1, Math.max(0, r));
}
