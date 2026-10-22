import { afterEach, expect, it, vi } from 'vitest';
import { createApi } from '../../src/core/api';
import { Emitter } from '../../src/core/emitter';
import type { Platform } from '../../src/core/platform';
import type { Channel, ConnectableTransport } from '../../src/core/transport';
import type { VmConfig } from '../../src/shared/ipc';
import { fakePrefs, fakeSecrets } from './fakes/platform';

const cfg: VmConfig = { host: '10.0.0.5', port: 22, username: 'root', theme: 'system', keepAlive: true, notifications: true };

/** Документ страницы: видимость и её событие. */
function fakeDocument() {
  const ev = new EventTarget();
  const doc = {
    visibilityState: 'visible' as 'visible' | 'hidden',
    addEventListener: (t: string, cb: EventListener) => ev.addEventListener(t, cb),
    set(v: 'visible' | 'hidden') {
      doc.visibilityState = v;
      ev.dispatchEvent(new Event('visibilitychange'));
    },
  };
  return doc;
}

/** SSH без сети: все команды записываются, PTY — пустой канал. */
function fakeSsh() {
  const ev = new Emitter();
  let connected = false;
  const execs: string[] = [];
  const pty: Channel = { on: () => {}, stderr: { on: () => {} }, write: () => {}, end: () => {}, close: () => {}, setWindow: () => {} };
  const ssh = {
    get connected() {
      return connected;
    },
    connect: async () => {
      connected = true;
      ev.emit('state', { state: 'connected' });
      return { ok: true as const, data: undefined };
    },
    close: async () => {
      connected = false;
    },
    exec: async (cmd: string) => {
      execs.push(cmd);
      return { code: 0, stdout: cmd.includes('$HOME') ? '/root' : '', stderr: '' };
    },
    stream: async () => pty,
    openPty: async () => pty,
    writeFile: async () => {},
    checkTcp: async () => ({ ok: true, ms: 1 }),
    forgetHostKey: async () => {},
    on: (e: string, cb: () => void) => ev.on(e, cb),
    onHostKey: () => () => {},
    answerHostKey: () => {},
    onPreflight: () => () => {},
  };
  return { ssh: ssh as unknown as ConnectableTransport, execs };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Подключённое приложение с открытой сессией; setVisible — свернуть и вернуть. */
async function connected(extra: Partial<Platform> = {}) {
  vi.useFakeTimers();
  const { ssh, execs } = fakeSsh();
  const prefs = fakePrefs({ config: JSON.stringify(cfg) });
  const secrets = fakeSecrets();
  secrets.store.key = 'KEY';
  const platform: Platform = { ssh, prefs, secrets, clipboard: { read: async () => '', write: async () => {} }, openExternal: async () => {}, ...extra };
  const api = createApi(platform);
  expect((await api.connection.connect()).ok).toBe(true);
  expect((await api.term.open('s1', 80, 24)).ok).toBe(true);
  await vi.advanceTimersByTimeAsync(1000);
  return { api, execs, prefs };
}

async function expectPausedWhileHidden(setVisible: (v: boolean) => void, execs: string[]) {
  setVisible(false);
  await vi.advanceTimersByTimeAsync(1000);
  execs.length = 0;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(execs).toEqual([]);

  setVisible(true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(execs.some((c) => c.includes(' ls -F'))).toBe(true);
  expect(execs.some((c) => c.includes('/proc/stat'))).toBe(true);
  expect(execs.some((c) => c.includes('capture-pane'))).toBe(true);
}

it('страница скрыта — опросы по SSH стоят (уведомления на нативной стороне), видна — снова идут', async () => {
  const doc = fakeDocument();
  vi.stubGlobal('document', doc);
  vi.stubGlobal('addEventListener', () => {});
  const { api, execs } = await connected();
  await expectPausedWhileHidden((v) => doc.set(v ? 'visible' : 'hidden'), execs);
  await api.connection.disconnect();
});

/** Платформа сама сообщает, свёрнуто ли приложение. */
function visibility() {
  const v = { notify: (_visible: boolean) => {} };
  const onVisibility = (cb: (visible: boolean) => void) => {
    v.notify = cb;
    return () => {};
  };
  return { v, onVisibility };
}

it('Android: WebView в фоне остаётся «visible» — свёрнутость приходит от платформы, опросы стоят', async () => {
  const { v, onVisibility } = visibility();
  const { api, execs } = await connected({ onVisibility });
  await expectPausedWhileHidden((x) => v.notify(x), execs);
  await api.connection.disconnect();
});

it('Android: приложение свернули — раскладка записывается сразу, не дожидаясь задержки', async () => {
  const { v, onVisibility } = visibility();
  const { api, prefs } = await connected({ onVisibility });
  await api.layout.save({ v: 1, items: [{ kind: 'session', name: 's1', pinned: true }] });
  v.notify(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(prefs.data.get('layout')).toContain('s1');
  await api.connection.disconnect();
});
