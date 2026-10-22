import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { longPress } from '../../src/renderer/long-press';

const ev = (type: string, x = 10, y = 10, pointerType = 'touch') => Object.assign(new Event(type), { clientX: x, clientY: y, pointerType, pointerId: 1 });

describe('долгое нажатие', () => {
  let el: EventTarget;
  let fired: [number, number][];
  beforeEach(() => {
    vi.useFakeTimers();
    el = new EventTarget();
    fired = [];
    longPress(el as HTMLElement, (x, y) => fired.push([x, y]));
  });
  afterEach(() => vi.useRealTimers());

  it('500 мс — срабатывает в точке нажатия', () => {
    el.dispatchEvent(ev('pointerdown', 30, 40));
    vi.advanceTimersByTime(499);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(fired).toEqual([[30, 40]]);
  });

  it('отпустил раньше — не срабатывает', () => {
    el.dispatchEvent(ev('pointerdown'));
    vi.advanceTimersByTime(300);
    el.dispatchEvent(ev('pointerup'));
    vi.advanceTimersByTime(500);
    expect(fired).toEqual([]);
  });

  it('сдвиг больше 10 px — это прокрутка, не срабатывает', () => {
    el.dispatchEvent(ev('pointerdown', 10, 10));
    el.dispatchEvent(ev('pointermove', 10, 21));
    vi.advanceTimersByTime(600);
    expect(fired).toEqual([]);
  });

  it('сдвиг до 10 px — срабатывает', () => {
    el.dispatchEvent(ev('pointerdown', 10, 10));
    el.dispatchEvent(ev('pointermove', 16, 18));
    vi.advanceTimersByTime(500);
    expect(fired).toHaveLength(1);
  });

  it('мышь — не долгое нажатие (у неё есть ПКМ)', () => {
    el.dispatchEvent(ev('pointerdown', 10, 10, 'mouse'));
    vi.advanceTimersByTime(600);
    expect(fired).toEqual([]);
  });

  it('после срабатывания отпускание не даёт обычного клика (не открывает сессию под пальцем)', () => {
    let clicks = 0;
    el.addEventListener('click', () => clicks++);
    el.dispatchEvent(ev('pointerdown'));
    vi.advanceTimersByTime(500);
    el.dispatchEvent(ev('pointerup'));
    el.dispatchEvent(new Event('click'));
    expect(clicks).toBe(0);
    // Следующее обычное касание кликает
    el.dispatchEvent(new Event('click'));
    expect(clicks).toBe(1);
  });

  it('клик после срабатывания не пришёл — первое касание в открывшемся листе не теряется', () => {
    // Лист рисуется порталом вне списка: касание приходит в документ, а не в el
    const doc = new EventTarget();
    const list = Object.assign(new EventTarget(), { ownerDocument: doc });
    longPress(list as unknown as HTMLElement, () => {});
    let clicks = 0;
    doc.addEventListener('click', () => clicks++);
    list.dispatchEvent(ev('pointerdown'));
    vi.advanceTimersByTime(500);
    list.dispatchEvent(ev('pointerup'));
    // Браузер не прислал click (палец сдвинулся, под ним появился лист)
    doc.dispatchEvent(Object.assign(ev('pointerdown'), { pointerId: 2 }));
    doc.dispatchEvent(new Event('click'));
    expect(clicks).toBe(1);
  });
});
