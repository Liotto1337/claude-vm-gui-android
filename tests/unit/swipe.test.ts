import { describe, expect, it } from 'vitest';
import { stepIndex, swipeStep } from '../../src/renderer/swipe';

describe('свайп в просмотре альбома', () => {
  it('влево — следующее фото, вправо — предыдущее', () => {
    expect(swipeStep(-80, 5)).toBe(1);
    expect(swipeStep(80, -5)).toBe(-1);
  });
  it('короткое движение не считается', () => expect(swipeStep(30, 0)).toBe(0));
  it('вертикальное движение не считается', () => expect(swipeStep(-60, 90)).toBe(0));
  it('листание по кругу не идёт: на краях остаёмся на месте', () => {
    expect(stepIndex(0, -1, 4)).toBe(0);
    expect(stepIndex(3, 1, 4)).toBe(3);
    expect(stepIndex(1, 1, 4)).toBe(2);
    expect(stepIndex(2, -1, 4)).toBe(1);
  });
});
