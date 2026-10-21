import { describe, expect, it } from 'vitest';
import { Emitter } from '../../src/core/emitter';

type Events = { tick: (n: number) => void; done: () => void };

describe('Emitter', () => {
  it('on возвращает отписку', () => {
    const e = new Emitter<Events>();
    const got: number[] = [];
    const off = e.on('tick', (n) => got.push(n));
    e.emit('tick', 1);
    off();
    e.emit('tick', 2);
    expect(got).toEqual([1]);
  });

  it('once срабатывает один раз', () => {
    const e = new Emitter<Events>();
    let n = 0;
    e.once('done', () => n++);
    e.emit('done');
    e.emit('done');
    expect(n).toBe(1);
  });

  it('emit без подписчиков не бросает', () => {
    expect(() => new Emitter<Events>().emit('done')).not.toThrow();
  });

  it('отписка внутри emit не ломает обход остальных', () => {
    const e = new Emitter<Events>();
    const calls: string[] = [];
    const offA = e.on('done', () => {
      calls.push('a');
      offA();
    });
    e.on('done', () => calls.push('b'));
    e.emit('done');
    e.emit('done');
    expect(calls).toEqual(['a', 'b', 'b']);
  });

  it('off снимает подписчика', () => {
    const e = new Emitter<Events>();
    let n = 0;
    const cb = () => n++;
    e.on('done', cb);
    e.off('done', cb);
    e.emit('done');
    expect(n).toBe(0);
  });
});
