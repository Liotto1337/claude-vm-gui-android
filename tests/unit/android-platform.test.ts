import { describe, expect, it } from 'vitest';
import { androidPlatformWith, type VmBridgePlugin } from '../../src/platform/android';
import { fakePrefs } from './fakes/platform';

type Listener = (data: never) => void;

/** Плагин VmBridge без Android: ответы задаются в тесте, события шлёт fire. */
function fakePlugin(over: Partial<VmBridgePlugin> = {}) {
  const listeners = new Map<string, Listener[]>();
  const calls: { method: string; args: unknown }[] = [];
  const rec =
    <T>(method: string, result: T) =>
    async (args?: unknown) => {
      calls.push({ method, args });
      return result;
    };
  const plugin: VmBridgePlugin = {
    connect: rec('connect', { ok: true }),
    close: rec('close', undefined),
    status: rec('status', { connected: false }),
    exec: rec('exec', { code: 0, stdout: '', stderr: '' }),
    openChannel: rec('openChannel', { ch: 7 }),
    write: rec('write', undefined),
    end: rec('end', undefined),
    closeChannel: rec('closeChannel', undefined),
    resize: rec('resize', undefined),
    writeFile: rec('writeFile', undefined),
    answerHostKey: rec('answerHostKey', undefined),
    checkTcp: rec('checkTcp', { ok: true, ms: 1 }),
    secretsSave: rec('secretsSave', { ok: true }),
    secretsHas: rec('secretsHas', { value: 'no' }),
    addListener: async (event: string, cb: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), cb]);
      return { remove: async () => {} };
    },
    ...over,
  } as VmBridgePlugin;
  const fire = (event: string, data: unknown) => listeners.get(event)?.forEach((cb) => cb(data as never));
  return { plugin, fire, calls };
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const deps = (plugin: VmBridgePlugin) => ({
  plugin,
  prefs: fakePrefs(),
  clipboard: { read: async () => '', write: async () => {} },
  openExternal: async () => {},
});

describe('Android-платформа', () => {
  it('пачки канала отдаются по порядку seq', async () => {
    const f = fakePlugin();
    const p = await androidPlatformWith(deps(f.plugin));
    const ch = await p.ssh.openPty('tmux attach', 80, 24);
    expect(f.calls.at(-1)).toEqual({ method: 'openChannel', args: { cmd: 'tmux attach', pty: { cols: 80, rows: 24 } } });
    const got: string[] = [];
    ch.on('data', (d) => got.push(new TextDecoder().decode(d)));
    f.fire('chunks', { items: [{ ch: 7, seq: 2, kind: 'data', b64: b64('c') }, { ch: 7, seq: 0, kind: 'data', b64: b64('a') }] });
    f.fire('chunks', { items: [{ ch: 7, seq: 1, kind: 'data', b64: b64('b') }] });
    expect(got).toEqual(['a', 'b', 'c']);
  });

  it('пачки закрытого канала игнорируются', async () => {
    const f = fakePlugin();
    const p = await androidPlatformWith(deps(f.plugin));
    const ch = await p.ssh.stream('tail -F x');
    let closed = 0;
    ch.on('close', () => closed++);
    const got: string[] = [];
    ch.on('data', (d) => got.push(new TextDecoder().decode(d)));
    f.fire('closed', { ch: 7 });
    f.fire('chunks', { items: [{ ch: 7, seq: 0, kind: 'data', b64: b64('late') }] });
    expect(closed).toBe(1);
    expect(got).toEqual([]);
  });

  it('ошибка подключения приходит Result с кодом плагина', async () => {
    const f = fakePlugin({ connect: async () => ({ ok: false, code: 'AUTH_FAILED', message: 'Сервер не принял ключ' }) });
    const p = await androidPlatformWith(deps(f.plugin));
    const cfg = { host: 'h', port: 22, username: 'root', theme: 'system' as const, keepAlive: true, notifications: true };
    expect(await p.ssh.connect(cfg)).toEqual({ ok: false, error: { code: 'AUTH_FAILED', message: 'Сервер не принял ключ' } });
  });

  it('ключ с фразой без неё — CONFIG_INVALID', async () => {
    const f = fakePlugin({ secretsSave: async () => ({ ok: false, code: 'CONFIG_INVALID', message: 'Ключ защищён парольной фразой' }) });
    const p = await androidPlatformWith(deps(f.plugin));
    expect(await p.secrets.save('key', 'ENCRYPTED')).toEqual({
      ok: false,
      error: { code: 'CONFIG_INVALID', message: 'Ключ защищён парольной фразой' },
    });
  });

  it('connected — из состояния плагина и событий state', async () => {
    const f = fakePlugin({ status: async () => ({ connected: true }) });
    const p = await androidPlatformWith(deps(f.plugin));
    expect(p.ssh.connected).toBe(true);
    f.fire('state', { state: 'reconnecting', attempt: 1 });
    expect(p.ssh.connected).toBe(false);
    f.fire('state', { state: 'connected' });
    expect(p.ssh.connected).toBe(true);
  });

  it('exec без связи — ошибка с текстом NOT_CONNECTED', async () => {
    const f = fakePlugin({ exec: async () => Promise.reject(Object.assign(new Error('NOT_CONNECTED'), { code: 'NOT_CONNECTED' })) });
    const p = await androidPlatformWith(deps(f.plugin));
    await expect(p.ssh.exec('echo')).rejects.toThrow('NOT_CONNECTED');
  });

  it('запись в канал и изменение размера уходят в плагин', async () => {
    const f = fakePlugin();
    const p = await androidPlatformWith(deps(f.plugin));
    const ch = await p.ssh.openPty('x', 80, 24);
    ch.write('ls\r');
    ch.setWindow(30, 100);
    await new Promise((r) => setTimeout(r, 0));
    expect(f.calls.slice(-2)).toEqual([
      { method: 'write', args: { ch: 7, data: 'ls\r' } },
      { method: 'resize', args: { ch: 7, cols: 100, rows: 30 } },
    ]);
  });

  it('картинка 600 КБ уходит в плагин тремя частями по 256 КБ, прогресс — после каждой', async () => {
    const f = fakePlugin();
    const p = await androidPlatformWith(deps(f.plugin));
    const bytes = new Uint8Array(614_400).map((_, i) => i % 251);
    const progress: number[] = [];
    await p.ssh.writeFile('/u/1.png', bytes, (n) => progress.push(n));
    const calls = f.calls.filter((c) => c.method === 'writeFile').map((c) => c.args as { path: string; b64: string; offset: number });
    expect(calls.map((c) => [c.offset, Buffer.from(c.b64, 'base64').length])).toEqual([[0, 262_144], [262_144, 262_144], [524_288, 90_112]]);
    expect(Buffer.concat(calls.map((c) => Buffer.from(c.b64, 'base64'))).equals(Buffer.from(bytes))).toBe(true);
    expect(progress).toEqual([262_144, 524_288, 614_400]);
  });
});
