import { afterEach, describe, expect, it } from 'vitest';
import { createApi } from '../../src/core/api';
import { Emitter } from '../../src/core/emitter';
import type { Platform } from '../../src/core/platform';
import type { ConnectableTransport } from '../../src/core/transport';
import type { Api, HostKeyPrompt, PreflightEvent, VmConfig } from '../../src/shared/ipc';
import { fakePrefs, fakeSecrets } from './fakes/platform';

const cfg: VmConfig = { host: '10.0.0.5', port: 22, username: 'root', theme: 'system', keepAlive: true, notifications: true };

/** SSH без сети: connect шлёт шаги tcp и ssh, exec отвечает пусто. */
function fakeSsh() {
  const ev = new Emitter();
  let connected = false;
  const t = {
    connects: 0,
    answers: [] as boolean[],
    get connected() {
      return connected;
    },
    async connect() {
      t.connects++;
      for (const e of [
        { step: 'tcp', status: 'running', detail: '' },
        { step: 'tcp', status: 'ok', detail: '' },
        { step: 'ssh', status: 'running', detail: '' },
        { step: 'ssh', status: 'ok', detail: '' },
      ] as PreflightEvent[])
        ev.emit('preflight', e);
      connected = true;
      ev.emit('state', { state: 'connected' });
      return { ok: true as const, data: undefined };
    },
    async close() {
      connected = false;
    },
    exec: async (cmd: string) => ({ code: 0, stdout: cmd.includes('$HOME') ? '/root' : '', stderr: '' }),
    stream: async () => {
      throw new Error('нет');
    },
    openPty: async () => {
      throw new Error('нет');
    },
    writeFile: async () => {},
    checkTcp: async () => ({ ok: true, ms: 1 }),
    on: (e: string, cb: () => void) => ev.on(e, cb),
    onHostKey: (cb: (p: HostKeyPrompt) => void) => ev.on('hostkey', cb),
    answerHostKey: (trust: boolean) => void t.answers.push(trust),
    onPreflight: (cb: (e: PreflightEvent) => void) => ev.on('preflight', cb),
    hostKey: (p: HostKeyPrompt) => ev.emit('hostkey', p),
  };
  return t;
}

function setup(withConfig = true) {
  const ssh = fakeSsh();
  const prefs = fakePrefs(withConfig ? { config: JSON.stringify(cfg) } : {});
  const secrets = fakeSecrets();
  secrets.store.key = 'KEY';
  const platform: Platform = {
    ssh: ssh as unknown as ConnectableTransport,
    prefs,
    secrets,
    clipboard: { read: async () => '', write: async () => {} },
    openExternal: async () => {},
  };
  return { ssh, api: createApi(platform) };
}

let api: Api | null = null;
afterEach(async () => {
  await api?.connection.disconnect();
  api = null;
});

describe('createApi', () => {
  it('без настроек — CONFIG_INVALID', async () => {
    const s = setup(false);
    api = s.api;
    expect(await api.connection.connect()).toMatchObject({ ok: false, error: { code: 'CONFIG_INVALID' } });
  });

  it('шаги подключения: tcp → ssh → tmux', async () => {
    const s = setup();
    api = s.api;
    const steps: string[] = [];
    api.connection.onPreflight((e) => steps.push(`${e.step}:${e.status}`));
    expect((await api.connection.connect()).ok).toBe(true);
    expect(steps).toEqual(['tcp:running', 'tcp:ok', 'ssh:running', 'ssh:ok', 'tmux:running', 'tmux:ok']);
  });

  it('до подключения — NOT_CONNECTED', async () => {
    api = setup().api;
    expect(await api.tmux.list()).toMatchObject({ ok: false, error: { code: 'NOT_CONNECTED' } });
  });

  it('повторный connect при живом соединении с тем же конфигом не переподключается', async () => {
    const s = setup();
    api = s.api;
    const states: string[] = [];
    api.connection.onState((st) => states.push(st.state));
    await api.connection.connect();
    states.length = 0;
    expect((await api.connection.connect()).ok).toBe(true);
    expect(s.ssh.connects).toBe(1);
    expect(states).toEqual(['connected']);
    expect((await api.tmux.list()).ok).toBe(true);
  });

  it('ключ хоста: вопрос уходит в интерфейс, ответ — в транспорт', async () => {
    const s = setup();
    api = s.api;
    const prompts: HostKeyPrompt[] = [];
    api.connection.onHostKey((p) => prompts.push(p));
    s.ssh.hostKey({ host: 'h', port: 22, kind: 'unknown', fingerprint: 'SHA256:x' });
    api.connection.answerHostKey(true);
    expect(prompts).toHaveLength(1);
    expect(s.ssh.answers).toEqual([true]);
  });

  it('настройки: ключ сохраняется, в конфиге — hasKey', async () => {
    const s = setup(false);
    api = s.api;
    expect(await api.config.save(cfg, undefined, { text: 'NEWKEY' })).toEqual({ ok: true, data: undefined });
    expect(await api.config.get()).toMatchObject({ host: '10.0.0.5', hasKey: true, keyType: 'ed25519' });
  });
});
