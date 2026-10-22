import { describe, expect, it } from 'vitest';
import { applyDrop, dropEdge } from '../../src/renderer/drop';
import type { SidebarLayout } from '../../src/shared/ipc';

const box = { top: 100, height: 40 };
const lay = (...names: string[]): SidebarLayout => ({ v: 1, items: names.map((name) => ({ kind: 'session' as const, name })) });
const names = (l: SidebarLayout) => l.items.map((i) => (i.kind === 'session' ? i.name : `[${i.name}: ${i.sessions.map((s) => s.name).join(',')}]`));

describe('куда бросить', () => {
  const a = { kind: 'session' as const, name: 'a', group: null };
  const g = { kind: 'group' as const, id: 'g1', continued: false };
  it('верхняя половина строки — перед ней', () => expect(dropEdge({ session: 'c' }, a, 110, box)).toEqual({ key: 's:a', edge: 'before' }));
  it('нижняя половина — после', () => expect(dropEdge({ session: 'c' }, a, 130, box)).toEqual({ key: 's:a', edge: 'after' }));
  it('сессию на заголовок группы — в группу', () => expect(dropEdge({ session: 'c' }, g, 110, box)).toEqual({ key: 'g:g1', edge: 'into' }));
  it('группу на заголовок группы — перед или после', () => expect(dropEdge({ group: 'g2' }, g, 130, box)).toEqual({ key: 'g:g1', edge: 'after' }));
  it('разделитель — некуда', () => expect(dropEdge({ session: 'c' }, { kind: 'divider' }, 110, box)).toBeNull());
});

describe('перенос', () => {
  it('третью сессию — перед первой', () => {
    const l = applyDrop(lay('a', 'b', 'c', 'd'), { session: 'c' }, { kind: 'session', name: 'a', group: null }, { key: 's:a', edge: 'before' });
    expect(names(l)).toEqual(['c', 'a', 'b', 'd']);
  });
  it('первую — после последней', () => {
    const l = applyDrop(lay('a', 'b', 'c'), { session: 'a' }, { kind: 'session', name: 'c', group: null }, { key: 's:c', edge: 'after' });
    expect(names(l)).toEqual(['b', 'c', 'a']);
  });
  it('в группу', () => {
    const l0: SidebarLayout = { v: 1, items: [{ kind: 'session', name: 'a' }, { kind: 'group', id: 'g1', name: 'Работа', sessions: [{ name: 'b' }] }] };
    const l = applyDrop(l0, { session: 'a' }, { kind: 'group', id: 'g1', continued: false }, { key: 'g:g1', edge: 'into' });
    // Как в 0.2.2: в группу — первой после закреплённых
    expect(names(l)).toEqual(['[Работа: a,b]']);
  });
});
