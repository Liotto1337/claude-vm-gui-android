import type { LayoutItem, SidebarLayout } from '@shared/ipc';
import { move, moveToGroup, type ItemRef, type Row } from '@shared/layout';

/** Место вставки: строка (ключ) и край — перед, после или в группу. */
export type Drop = { key: string; edge: 'before' | 'after' | 'into' } | null;

type Group = Extract<LayoutItem, { kind: 'group' }>;
export const rowKey = (r: Row) => (r.kind === 'session' ? `s:${r.name}` : r.kind === 'group' ? `g:${r.id}` : r.kind);
export const groupById = (l: SidebarLayout, id: string) => l.items.find((i): i is Group => i.kind === 'group' && i.id === id) ?? null;
export const groupIndex = (l: SidebarLayout, id: string) => l.items.findIndex((i) => i.kind === 'group' && i.id === id);

/** Куда ляжет перетаскиваемое над строкой: верхняя половина — перед, нижняя — после; сессия на заголовок группы — в группу. */
export function dropEdge(drag: ItemRef, row: Row, y: number, box: { top: number; height: number }): Drop {
  if (row.kind !== 'session' && row.kind !== 'group') return null;
  if (row.kind === 'group' && 'session' in drag) return { key: rowKey(row), edge: 'into' };
  return { key: rowKey(row), edge: y > box.top + box.height / 2 ? 'after' : 'before' };
}

/** Раскладка после переноса ref на место d у строки row (общая для мыши и касания). */
export function applyDrop(l: SidebarLayout, ref: ItemRef, row: Row, d: NonNullable<Drop>): SidebarLayout {
  if (row.kind === 'group' && d.edge === 'into' && 'session' in ref) return moveToGroup(l, ref.session, row.id);
  const after = d.edge === 'after' ? 1 : 0;
  if ('group' in ref || (row.kind === 'session' && row.group === null) || row.kind === 'group') {
    // Группы — только на верхнем уровне: место считается по группе строки
    const topId = row.kind === 'group' ? row.id : row.kind === 'session' && row.group ? row.group : null;
    const index = topId
      ? groupIndex(l, topId) + after
      : l.items.findIndex((i) => i.kind === 'session' && i.name === (row as { name: string }).name) + after;
    return move(l, ref, { group: null, index });
  }
  if (row.kind !== 'session' || row.group === null) return l;
  const g = groupById(l, row.group);
  const index = (g?.sessions.findIndex((m) => m.name === row.name) ?? 0) + after;
  return move(l, ref, { group: row.group, index });
}
