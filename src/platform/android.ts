import { fail, ok, type ConnectionState, type ErrorCode, type HostKeyPrompt, type PreflightEvent, type Result, type VmConfig } from '@shared/ipc';
import { Emitter } from '@core/emitter';
import type { Platform, Prefs } from '@core/platform';
import type { Channel, ConnectableTransport, ExecResult } from '@core/transport';
import { fromB64, SeqChannel, toB64 } from './seq-channel';

type Fail = { ok: false; code: string; message: string };

const FILE_CHUNK = 256 * 1024;

/** Нативный плагин (android/.../VmBridgePlugin.kt). Ошибки вызовов — reject с code (NOT_CONNECTED и др.). */
export interface VmBridgePlugin {
  connect(o: { host: string; port: number; username: string }): Promise<{ ok: true } | Fail>;
  close(): Promise<void>;
  status(): Promise<{ connected: boolean }>;
  exec(o: { cmd: string; stdin?: string; timeoutMs?: number }): Promise<ExecResult>;
  openChannel(o: { cmd: string; pty?: { cols: number; rows: number } }): Promise<{ ch: number }>;
  write(o: { ch: number; data: string }): Promise<void>;
  end(o: { ch: number }): Promise<void>;
  closeChannel(o: { ch: number }): Promise<void>;
  resize(o: { ch: number; cols: number; rows: number }): Promise<void>;
  /** offset 0 — файл создаётся заново (права 0600), дальше — дописывается с этого места */
  writeFile(o: { path: string; b64: string; offset: number }): Promise<void>;
  answerHostKey(o: { trust: boolean }): Promise<void>;
  checkTcp(o: { host: string; port: number }): Promise<{ ok: boolean; ms: number | null }>;
  secretsSave(o: { name: 'password' | 'key'; value: string | null; passphrase?: string }): Promise<{ ok: true; keyType?: string } | Fail>;
  secretsHas(o: { name: 'password' | 'key' }): Promise<{ value: 'yes' | 'no' | 'unreadable' }>;
  setBackground(o: { keepAlive: boolean; notifications: boolean; tmux: string; sessions: number }): Promise<void>;
  clearNotification(o: { name: string }): Promise<void>;
  requestNotifications(): Promise<{ granted: boolean }>;
  addListener(event: string, cb: (data: never) => void): Promise<{ remove(): Promise<void> }>;
}

export interface AndroidDeps {
  plugin: VmBridgePlugin;
  prefs: Prefs;
  clipboard: Platform['clipboard'];
  openExternal(url: string): Promise<void>;
  onBack?(cb: () => void): () => void;
  minimize?(): void;
}

const err = (code: string, message: string) => fail(code as ErrorCode, message);

/** Android: SSH и секреты — в нативном плагине, данные каналов приходят base64-пачками с номерами seq. */
export async function androidPlatformWith(d: AndroidDeps): Promise<Platform> {
  const { plugin } = d;
  const events = new Emitter();
  const channels = new Map<number, SeqChannel>();
  let connected = (await plugin.status().catch(() => ({ connected: false }))).connected;

  const on = <T>(event: string, cb: (data: T) => void) => void plugin.addListener(event, cb as (data: never) => void);
  on<ConnectionState>('state', (s) => {
    connected = s.state === 'connected';
    events.emit('state', s);
  });
  on('lost', () => events.emit('lost'));
  on('reconnected', () => events.emit('reconnected'));
  on<HostKeyPrompt>('hostkey', (p) => events.emit('hostkey', p));
  on<PreflightEvent>('preflight', (e) => events.emit('preflight', e));
  on<{ items: { ch: number; seq: number; kind: 'data' | 'stderr'; b64: string }[] }>('chunks', ({ items }) => {
    for (const i of items) channels.get(i.ch)?.push(i.seq, i.kind, fromB64(i.b64));
  });
  on<{ ch: number }>('closed', ({ ch }) => {
    const c = channels.get(ch);
    channels.delete(ch);
    c?.closedByPeer();
  });

  const openChannel = async (cmd: string, pty?: { cols: number; rows: number }): Promise<Channel> => {
    const { ch } = await plugin.openChannel(pty ? { cmd, pty } : { cmd });
    const quiet = (p: Promise<void>) => void p.catch(() => {});
    const c = new SeqChannel({
      write: (data) => quiet(plugin.write({ ch, data })),
      end: () => quiet(plugin.end({ ch })),
      close: () => quiet(plugin.closeChannel({ ch })),
      resize: (rows, cols) => quiet(plugin.resize({ ch, cols, rows })),
    });
    channels.set(ch, c);
    return c;
  };

  const ssh: ConnectableTransport = {
    get connected() {
      return connected;
    },
    connect: async (cfg: VmConfig): Promise<Result<void>> => {
      const r = await plugin.connect({ host: cfg.host, port: cfg.port, username: cfg.username });
      return r.ok ? ok(undefined) : err(r.code, r.message);
    },
    close: () => plugin.close(),
    exec: (cmd, o = {}) => plugin.exec({ cmd, ...o }),
    stream: (cmd) => openChannel(cmd),
    openPty: (cmd, cols, rows) => openChannel(cmd, { cols, rows }),
    // Частями по 256 КБ: мост Capacitor передаёт строки, огромный base64 одним вызовом подвешивал бы интерфейс
    writeFile: async (path, bytes, onProgress) => {
      for (let offset = 0; offset < bytes.byteLength || offset === 0; offset += FILE_CHUNK) {
        const part = bytes.subarray(offset, offset + FILE_CHUNK);
        await plugin.writeFile({ path, b64: toB64(part), offset });
        onProgress(offset + part.byteLength);
        if (part.byteLength === 0) break;
      }
    },
    checkTcp: (host, port) => plugin.checkTcp({ host, port }),
    on: ((e: string, cb: (...a: any[]) => void) => events.on(e, cb)) as ConnectableTransport['on'],
    onHostKey: (cb) => events.on('hostkey', cb),
    answerHostKey: (trust) => void plugin.answerHostKey({ trust }).catch(() => {}),
    onPreflight: (cb) => events.on('preflight', cb),
  };

  return {
    ssh,
    prefs: d.prefs,
    secrets: {
      save: async (name, value, passphrase) => {
        const r = await plugin.secretsSave(passphrase ? { name, value, passphrase } : { name, value });
        return r.ok ? ok(r.keyType ? { keyType: r.keyType } : {}) : err(r.code, r.message);
      },
      has: async (name) => (await plugin.secretsHas({ name })).value,
    },
    clipboard: d.clipboard,
    openExternal: d.openExternal,
    onBack: d.onBack,
    minimize: d.minimize,
    background: {
      set: (o) => void plugin.setBackground(o).catch(() => {}),
      onOpenSession: (cb) => {
        const h = plugin.addListener('openSession', ((e: { name: string }) => cb(e.name)) as (data: never) => void);
        return () => void h.then((x) => x.remove());
      },
      sessionOpened: (name) => void plugin.clearNotification({ name }).catch(() => {}),
      requestNotifications: async () => (await plugin.requestNotifications().catch(() => ({ granted: false }))).granted,
    },
  };
}
