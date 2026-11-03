/**
 * Раскладка альбома фотографий в сообщении — по образцу Telegram.
 * Результат — дерево: ряд (фото слева направо одной высоты) и колонка (фото сверху вниз одной ширины).
 * Размеры в пикселях не считаются: интерфейс раскладывает дерево флексами, у каждого узла
 * `flex-grow` равен его пропорции (aspectOf), поэтому ряд получает общую высоту, а колонка — общую ширину.
 */
export type AlbumNode = { kind: 'photo'; index: number; ratio: number } | { kind: 'row' | 'col'; items: AlbumNode[] };

const MIN_RATIO = 0.5;
const MAX_RATIO = 2.5;
/** Выше 4:3 по вертикали и шире 2:1 по горизонтали альбом не растёт: лишнее обрезается. */
const MIN_ALBUM = 0.75;
const MAX_ALBUM = 2;
/** Фото шире 1.2:1 считается горизонтальным. */
const WIDE = 1.2;
/** Подходящая высота ряда при ширине альбома 1: ряд из двух квадратов — 0.5, из трёх — 0.33. */
const ROW_HEIGHT = 0.4;

const sane = (r: number) => (Number.isFinite(r) && r > 0 ? Math.min(MAX_RATIO, Math.max(MIN_RATIO, r)) : 1);

/** Ширина узла, делённая на его высоту. */
export function aspectOf(n: AlbumNode): number {
  if (n.kind === 'photo') return n.ratio;
  if (n.kind === 'row') return n.items.reduce((s, x) => s + aspectOf(x), 0);
  return 1 / n.items.reduce((s, x) => s + 1 / aspectOf(x), 0);
}

export const clampAspect = (a: number) => Math.min(MAX_ALBUM, Math.max(MIN_ALBUM, a));

const photo = (index: number, ratio: number): AlbumNode => ({ kind: 'photo', index, ratio });
const row = (items: AlbumNode[]): AlbumNode => ({ kind: 'row', items });
const col = (items: AlbumNode[]): AlbumNode => ({ kind: 'col', items });

/** Ряды по 1–3 фото: минимум суммы квадратов отклонения высоты ряда от подходящей. При равенстве первый ряд короче. */
function rowSizes(ratios: number[]): number[] {
  const n = ratios.length;
  // Стоимость в целых числах: равные раскладки сравниваются без шума float
  const cost = (from: number, to: number) => Math.round((1 / ratios.slice(from, to).reduce((s, r) => s + r, 0) - ROW_HEIGHT) ** 2 * 1e9);
  // best[i] — лучшая раскладка фото с i-го до конца
  const best: { cost: number; size: number }[] = Array.from({ length: n + 1 }, () => ({ cost: Infinity, size: 0 }));
  best[n] = { cost: 0, size: 0 };
  for (let i = n - 1; i >= 0; i--) {
    for (const k of [2, 3, 1]) {
      if (i + k > n) continue;
      const c = cost(i, i + k) + best[i + k].cost;
      if (c < best[i].cost) best[i] = { cost: c, size: k };
    }
  }
  const sizes: number[] = [];
  for (let i = 0; i < n; i += best[i].size) sizes.push(best[i].size);
  return sizes;
}

export function albumLayout(rawRatios: number[]): AlbumNode {
  const r = rawRatios.map(sane);
  const n = r.length;
  const p = (i: number) => photo(i, r[i]);
  if (n === 1) return p(0);
  if (n === 2) return r[0] > 1.4 && r[1] > 1.4 && Math.abs(r[0] - r[1]) < 0.2 ? col([p(0), p(1)]) : row([p(0), p(1)]);
  if (n === 3 || n === 4) {
    const rest = Array.from({ length: n - 1 }, (_, i) => p(i + 1));
    // Первое горизонтальное — сверху на всю ширину, остальные рядом под ним; иначе — слева крупное, остальные столбиком справа
    return r[0] > WIDE ? col([p(0), row(rest)]) : row([p(0), col(rest)]);
  }
  const rows: AlbumNode[] = [];
  let at = 0;
  for (const k of rowSizes(r)) {
    rows.push(row(Array.from({ length: k }, (_, j) => p(at + j))));
    at += k;
  }
  return col(rows);
}
