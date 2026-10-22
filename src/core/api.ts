import type { Api } from '@shared/ipc';
import { UpdateChecker } from '@shared/update-checker';
import { externalUrl } from '@shared/links';
import { loadConfig, saveConfig } from './config';
import { AppController } from './controller';
import { Emitter } from './emitter';
import { LayoutStore } from './layout-store';
import type { Platform } from './platform';

declare const __APP_VERSION__: string;

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
  // Страница скрылась или приложение свёрнуто (Android сообщает это через платформу): отложенная запись раскладки
  // не должна теряться, а опросы по SSH встают до возвращения
  const flush = () => void layouts.flush();
  // Новая версия на GitHub — проверяем, только пока приложение на экране
  const updates = new UpdateChecker('Liotto1337/claude-vm-gui-android', __APP_VERSION__, async (url) => {
    const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
  updates.on('available', (u) => emit('updates:available', u));
  updates.start();
  const setVisible = (visible: boolean) => {
    if (!visible) flush();
    if (visible) updates.start();
    else updates.stop();
    c.setHidden(!visible);
  };
  if (typeof document !== 'undefined') {
    addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => setVisible(document.visibilityState !== 'hidden'));
  }
  p.onVisibility?.(setVisible);

  return {
    config: {
      get: config,
      save: async (cfg, password, key) => {
        const r = await saveConfig(p.prefs, p.secrets, cfg, password, key);
        // Переключатели фона действуют сразу, без переподключения
        if (r.ok) c.syncBackground(cfg);
        return r;
      },
    },
    connection: {
      connect: () => c.connect(),
      disconnect: () => c.disconnect(),
      onPreflight: on('connection:preflight'),
      onState: on('connection:state'),
      onHostKey: on('connection:hostKey'),
      answerHostKey: (trust) => c.answerHostKey(trust === true),
      forgetHostKey: async () => {
        const cfg = await config();
        if (cfg) await p.ssh.forgetHostKey(cfg.host, cfg.port);
      },
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
    upload: { file: c.uploadFile, onProgress: on('upload:progress'), read: c.uploadRead },
    clipboard: {
      read: () => p.clipboard.read().catch(() => ''),
      write: (text) => {
        if (typeof text === 'string' && text) void p.clipboard.write(text).catch(() => {});
      },
    },
    layout: {
      get: async () => {
        const l = await layouts.get(await host());
        c.setWatched(l.watched ?? []);
        return l;
      },
      save: async (l) => {
        c.setWatched(l.watched ?? []);
        return layouts.save(await host(), l);
      },
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
      typeText: c.chatTypeText,
    },
    updates: {
      get: async () => updates.latest,
      onAvailable: on('updates:available'),
      dismissed: () => p.prefs.get('dismissedUpdate'),
      dismiss: (version) => p.prefs.set('dismissedUpdate', String(version)),
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
      onOpenSession: (cb) => p.background?.onOpenSession(cb) ?? (() => {}),
      requestNotifications: () => p.background?.requestNotifications() ?? Promise.resolve(true),
      pref: (key) => p.prefs.get(`ui:${key}`).catch(() => null),
      setPref: (key, value) => p.prefs.set(`ui:${key}`, value).catch(() => {}),
    },
  };
}
