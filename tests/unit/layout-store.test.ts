import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LayoutStore } from '../../src/core/layout-store';
import type { SidebarLayout } from '../../src/shared/ipc';
import { fakePrefs } from './fakes/platform';

const lay = (...names: string[]): SidebarLayout => ({ v: 1, items: names.map((name) => ({ kind: 'session' as const, name })) });
const stored = (p: ReturnType<typeof fakePrefs>) => JSON.parse(p.data.get('layout') ?? '{}');

describe('LayoutStore', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('нет записи — пустая раскладка', async () => expect(await new LayoutStore(fakePrefs()).get('h')).toEqual({ v: 1, items: [] }));

  it('сохранение с задержкой 300 мс и flush', async () => {
    const p = fakePrefs();
    const st = new LayoutStore(p);
    expect(await st.save('h', lay('a'))).toEqual({ ok: true, data: undefined });
    expect(p.data.has('layout')).toBe(false);
    expect(await st.get('h')).toEqual(lay('a'));
    await vi.advanceTimersByTimeAsync(300);
    expect(stored(p).h).toEqual(lay('a'));
    await st.save('h', lay('b'));
    await st.flush();
    expect(stored(p).h).toEqual(lay('b'));
  });

  it('отдельные раскладки для разных ВМ', async () => {
    const p = fakePrefs();
    const st = new LayoutStore(p, 0);
    await st.save('one', lay('a'));
    await st.save('two', lay('b'));
    await st.flush();
    const again = new LayoutStore(p);
    expect(await again.get('one')).toEqual(lay('a'));
    expect(await again.get('two')).toEqual(lay('b'));
  });

  it('повреждённая запись — пустая раскладка, перезаписывается при сохранении', async () => {
    const p = fakePrefs({ layout: '{oops' });
    const st = new LayoutStore(p, 0);
    expect(await st.get('h')).toEqual({ v: 1, items: [] });
    await st.save('h', lay('a'));
    await st.flush();
    expect(stored(p).h).toEqual(lay('a'));
  });

  it('сохраняется нормализованная раскладка', async () => {
    const st = new LayoutStore(fakePrefs(), 0);
    await st.save('h', { v: 1, items: [{ kind: 'session', name: 'a' }, { kind: 'session', name: 'a' }] });
    expect(await st.get('h')).toEqual(lay('a'));
  });
});
