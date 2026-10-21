import type { Api } from '@shared/ipc';
import { externalUrl } from '@shared/links';
import { loadConfig, saveConfig } from './config';
import { AppController } from './controller';
import { Emitter } from './emitter';
import { LayoutStore } from './layout-store';
import type { Platform } from './platform';

const darkQuery = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null);

/** window.api поверх платформы: те же каналы, что были у Electron, но в одном JS-контексте. */
export function createApi(p: Platform): Api {
  const bus = new Emitter();
  const emit = (channel: string, payload: unknown) => bus.emit(channel, payload);
  const on =
    <T>(channel: string) =>
    (cb: (payload: T) => void) =>
      bus.on(channel, cb);
  const config = () => loadConfig(p.prefs, p.secrets);
  const c = new AppController(p, emit, config);
  const layouts = new LayoutStore(p.prefs);
  const host = async () => (await config())?.host ?? '';
  // Отложенная запись раскладки не должна теряться: страница скрылась (Android — приложение ушло в фон) или закрывается
  if (typeof document !== 'undefined') {
    const flush = () => void layouts.flush();
    addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
  }

  return {
    config: {
      get: config,
      save: (cfg, password, key) => saveConfig(p.prefs, p.secrets, cfg, password, key),
    },
    connection: {
      connect: () => c.connect(),
      disconnect: () => c.disconnect(),
      onPreflight: on('connection:preflight'),
      onState: on('connection:state'),
      onHostKey: on('connection:hostKey'),
      answerHostKey: (trust) => c.answerHostKey(trust === true),
    },
    tmux: {
      list: c.tmuxList,
      onSessions: on('tmux:sessions'),
      create: c.tmuxCreate,
      kill: c.tmuxKill,
      startClaude: c.tmuxStartClaude,
    },
    term: {
      open: c.termOpen,
      write: (d) => void c.termWrite(d),
      resize: (cols, rows) => void c.termResize(cols, rows),
      onData: on('term:data'),
      onExit: on('term:exit'),
      send: c.termSend,
      setModel: c.termSetModel,
      setEffort: c.termSetEffort,
    },
    hints: { get: c.hintsGet, files: c.hintsFiles, dirs: c.hintsDirs },
    upload: { image: c.uploadImage, onProgress: on('upload:progress') },
    clipboard: {
      read: () => p.clipboard.read().catch(() => ''),
      write: (text) => {
        if (typeof text === 'string' && text) void p.clipboard.write(text).catch(() => {});
      },
    },
    layout: {
      get: async () => layouts.get(await host()),
      save: async (l) => layouts.save(await host(), l),
    },
    links: {
      // Ссылки из ленты — только http(s)
      open: (raw) => {
        const url = externalUrl(raw);
        if (url) void p.openExternal(url);
      },
    },
    metrics: { setActive: (fast) => void c.metricsSetActive(fast), onSample: on('metrics:sample'), info: c.metricsInfo },
    chat: {
      onItems: on('chat:items'),
      onScreen: on('chat:screen'),
      onUnavailable: on('chat:unavailable'),
      loadEarlier: c.chatLoadEarlier,
      key: c.chatKey,
    },
    platform: {
      theme: async () => (darkQuery()?.matches ? 'dark' : 'light'),
      onThemeChange: (cb) => {
        const q = darkQuery();
        if (!q) return () => {};
        const h = () => cb(q.matches ? 'dark' : 'light');
        q.addEventListener('change', h);
        return () => q.removeEventListener('change', h);
      },
      onBack: (cb) => p.onBack?.(cb) ?? (() => {}),
      minimize: () => p.minimize?.(),
    },
  };
}
