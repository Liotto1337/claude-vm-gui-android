import { ok } from '@shared/ipc';
import type { Platform, Prefs } from '@core/platform';
import { devBridgeTransport } from './devbridge';

/** localStorage как Preferences (только браузер). */
export const localPrefs: Prefs = {
  get: async (k) => localStorage.getItem(`cvg:${k}`),
  set: async (k, v) => localStorage.setItem(`cvg:${k}`, v),
};

/**
 * Платформа для разработки и E2E: SSH через dev-мост, настройки в localStorage.
 * testHooks — window.__cvg: обрыв SSH (dropConnection) и последняя открытая ссылка (lastLink).
 */
export function devPlatform(url: string, opts: { testHooks?: boolean } = {}): Platform {
  const bridge = devBridgeTransport(url);
  const hooks: { lastLink?: string; dropConnection?: () => void; back?: () => void; minimized?: number } = {};
  const backs = new Set<() => void>();
  if (opts.testHooks) {
    hooks.dropConnection = () => void bridge.call({ op: '__drop' });
    // Кнопка «Назад» Android и сворачивание — для E2E
    hooks.back = () => backs.forEach((cb) => cb());
    (window as unknown as { __cvg: typeof hooks }).__cvg = hooks;
  }
  return {
    ssh: bridge,
    prefs: localPrefs,
    secrets: {
      save: async (name, value, passphrase) => {
        const r = (await bridge.call({ op: 'secrets.save', name, value, passphrase }).catch(() => null)) as Awaited<
          ReturnType<Platform['secrets']['save']>
        > | null;
        return r ?? ok({});
      },
      has: async (name) => ((await bridge.call({ op: 'secrets.has', name }).catch(() => 'no')) as 'yes' | 'no' | 'unreadable'),
    },
    clipboard: {
      read: () => navigator.clipboard.readText(),
      write: (t) => navigator.clipboard.writeText(t),
    },
    onBack: (cb) => {
      backs.add(cb);
      return () => backs.delete(cb);
    },
    minimize: () => {
      hooks.minimized = (hooks.minimized ?? 0) + 1;
    },
    openExternal: async (url) => {
      if (opts.testHooks) hooks.lastLink = url;
      else window.open(url, '_blank', 'noopener');
    },
  };
}
