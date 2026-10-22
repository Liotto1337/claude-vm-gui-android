import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreenEvent, TmuxSession } from '../../src/shared/ipc';

// Повторный выбор той же сессии (касание уведомления о ней, касание открытой сессии в списке) не переоткрывает
// терминал, наблюдение за экраном не перезапускается и шлёт события только при изменении — экран сбрасывать нельзя
const sessions: TmuxSession[] = ['s', 't'].map((name) => ({ name, attachedClients: 0, command: 'claude', cwd: '/', claudeRunning: true }));
let onScreen: (e: ScreenEvent) => void = () => {};

vi.mock('../../src/renderer/api', () => ({
  api: {
    config: { get: async () => ({ host: 'h', port: 22, username: 'root', theme: 'light', keepAlive: true, notifications: true, lastSession: 's' }), save: async () => ({ ok: true }) },
    platform: { theme: async () => 'light', onThemeChange: () => () => {} },
    connection: { onPreflight: () => () => {}, onState: () => () => {}, onHostKey: () => () => {}, connect: async () => ({ ok: true, data: undefined }) },
    tmux: { onSessions: () => () => {}, list: async () => ({ ok: true, data: sessions }) },
    layout: { get: async () => ({ v: 1, items: [] }), save: async () => ({ ok: true }) },
    chat: { onItems: () => () => {}, onScreen: (cb: typeof onScreen) => ((onScreen = cb), () => {}), onUnavailable: () => () => {} },
    metrics: { onSample: () => () => {}, info: async () => ({ ok: false }), setActive: () => {} },
  },
}));

const menu = { kind: 'menu' as const, menu: { title: 'Выбор', context: [], code: [], options: [], notes: [], hint: null } };

describe('повторный выбор открытой сессии', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { documentElement: { dataset: {} } });
    vi.stubGlobal('location', { search: '' });
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  });

  it('экран (открытое меню) сохраняется; при переходе на другую сессию её экран сбрасывается', async () => {
    const state = await import('../../src/renderer/state');
    await state.init();
    await vi.waitFor(() => expect(state.getState().current).toBe('s'));
    onScreen({ session: 's', state: menu, busy: false });
    onScreen({ session: 't', state: menu, busy: false });
    state.openSession('s');
    expect(state.getState().chat.s.screen).toEqual(menu);
    state.openSession('t');
    expect(state.getState().chat.t.screen).toBeNull();
  });
});
