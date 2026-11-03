import { describe, expect, it } from 'vitest';
import { albumLayout, aspectOf, clampAspect, type AlbumNode } from '../../src/shared/album-layout';

/** Схема раскладки строкой: p0 — фото, r(…) — ряд, c(…) — колонка. */
const show = (n: AlbumNode): string => (n.kind === 'photo' ? `p${n.index}` : `${n.kind === 'row' ? 'r' : 'c'}(${n.items.map(show).join(' ')})`);
const photos = (n: AlbumNode): number[] => (n.kind === 'photo' ? [n.index] : n.items.flatMap(photos));
const SQ = (n: number) => Array.from({ length: n }, () => 1);
const WIDE = 1.78;
const TALL = 0.56;

describe('раскладка альбома как в Telegram', () => {
  it('одно фото — просто фото', () => expect(show(albumLayout([1.5]))).toBe('p0'));

  describe('два фото', () => {
    it('два горизонтальных — друг под другом', () => expect(show(albumLayout([WIDE, WIDE]))).toBe('c(p0 p1)'));
    it('горизонтальное и вертикальное — рядом', () => expect(show(albumLayout([WIDE, TALL]))).toBe('r(p0 p1)'));
    it('два вертикальных — рядом', () => expect(show(albumLayout([TALL, TALL]))).toBe('r(p0 p1)'));
    it('квадраты — рядом', () => expect(show(albumLayout(SQ(2)))).toBe('r(p0 p1)'));
  });

  describe('три фото', () => {
    it('первое горизонтальное — сверху на всю ширину, два под ним', () => expect(show(albumLayout([WIDE, 1, 1]))).toBe('c(p0 r(p1 p2))'));
    it('первое вертикальное — слева, два справа друг над другом', () => expect(show(albumLayout([TALL, 1, 1]))).toBe('r(p0 c(p1 p2))'));
    it('первое квадратное — слева крупное', () => expect(show(albumLayout(SQ(3)))).toBe('r(p0 c(p1 p2))'));
  });

  describe('четыре фото', () => {
    it('первое горизонтальное — сверху, три под ним', () => expect(show(albumLayout([WIDE, 1, 1, 1]))).toBe('c(p0 r(p1 p2 p3))'));
    it('первое вертикальное — слева, три справа столбиком', () => expect(show(albumLayout([TALL, 1, 1, 1]))).toBe('r(p0 c(p1 p2 p3))'));
  });

  describe('пять и больше', () => {
    it('5 квадратов — 2 + 3', () => expect(show(albumLayout(SQ(5)))).toBe('c(r(p0 p1) r(p2 p3 p4))'));
    it('6 квадратов — 3 + 3', () => expect(show(albumLayout(SQ(6)))).toBe('c(r(p0 p1 p2) r(p3 p4 p5))'));
    it('в ряду не больше трёх, порядок и состав сохраняются', () => {
      for (let n = 5; n <= 30; n++) {
        const ratios = Array.from({ length: n }, (_, i) => [1, WIDE, TALL, 1.33, 0.75][i % 5]);
        const root = albumLayout(ratios);
        expect(photos(root)).toEqual(Array.from({ length: n }, (_, i) => i));
        if (root.kind !== 'col') throw new Error('ожидалась колонка рядов');
        for (const row of root.items) expect(row.kind === 'row' ? row.items.length : 1).toBeLessThanOrEqual(3);
      }
    });
    it('одинокая строка из одного фото не появляется на квадратах', () => {
      for (let n = 5; n <= 12; n++) {
        const root = albumLayout(SQ(n));
        if (root.kind !== 'col') throw new Error('ожидалась колонка рядов');
        for (const row of root.items) expect(row.kind).toBe('row');
      }
    });
  });

  describe('устойчивость к плохим пропорциям', () => {
    it('0, NaN и отрицательные считаются квадратом', () => expect(show(albumLayout([0, NaN, -2]))).toBe('r(p0 c(p1 p2))'));
    it('сверхширокие и сверхвысокие ограничиваются', () => {
      const n = albumLayout([100]);
      expect(n.kind === 'photo' && n.ratio).toBeLessThanOrEqual(2.5);
      const m = albumLayout([0.001]);
      expect(m.kind === 'photo' && m.ratio).toBeGreaterThanOrEqual(0.5);
    });
  });
});

describe('пропорции узла', () => {
  it('фото — своя пропорция', () => expect(aspectOf(albumLayout([1.5]))).toBe(1.5));
  it('ряд из двух квадратов — 2:1', () => expect(aspectOf(albumLayout(SQ(2)))).toBe(2));
  it('колонка из двух квадратов — 1:2', () => expect(aspectOf({ kind: 'col', items: [{ kind: 'photo', index: 0, ratio: 1 }, { kind: 'photo', index: 1, ratio: 1 }] })).toBeCloseTo(0.5));
  it('три квадрата: крупный слева + два справа = 1.5:1', () => expect(aspectOf(albumLayout(SQ(3)))).toBeCloseTo(1.5));
  it('clampAspect: не выше 4:3 и не шире 2:1', () => {
    expect(clampAspect(0.3)).toBe(0.75);
    expect(clampAspect(5)).toBe(2);
    expect(clampAspect(1.2)).toBe(1.2);
  });
});
