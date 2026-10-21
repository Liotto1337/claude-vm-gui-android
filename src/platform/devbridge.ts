import type { ConnectionState, HostKeyPrompt, PreflightEvent, Result, VmConfig } from '@shared/ipc';
import { Emitter } from '@core/emitter';
import type { Channel, ConnectableTransport, ExecResult } from '@core/transport';
import type { BridgeEvent, BridgeRequest, BridgeResponse } from './bridge-protocol';

type SocketLike = {
  readyState: number;
  send(s: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: string }) => void) | null;
  onclose: (() => void) | null;
};

const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

class BridgeError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/** Канал моста: пачки собираются по seq, чтобы порядок байтов не зависел от доставки. */
class BridgeChannel extends Emitter implements Channel {
  private next = 0;
  private readonly held = new Map<number, { kind: 'data' | 'stderr'; bytes: Uint8Array }>();
  readonly stderr = new Emitter();

  constructor(private readonly ch: number, private readonly call: (r: BridgeRequest) => Promise<unknown>) {
    super();
  }

  push(seq: number, kind: 'data' | 'stderr', bytes: Uint8Array): void {
    this.held.set(seq, { kind, bytes });
    for (let p = this.held.get(this.next); p; p = this.held.get(this.next)) {
      this.held.delete(this.next++);
      if (p.kind === 'data') this.emit('data', p.bytes);
      else this.stderr.emit('data', p.bytes);
    }
  }

  write(data: string): void {
    void this.call({ op: 'write', ch: this.ch, data }).catch(() => {});
  }
  end(): void {
    void this.call({ op: 'end', ch: this.ch }).catch(() => {});
  }
  close(): void {
    void this.call({ op: 'close', ch: this.ch }).catch(() => {});
  }
  setWindow(rows: number, cols: number): void {
    void this.call({ op: 'resize', ch: this.ch, rows, cols }).catch(() => {});
  }
}

export type DevBridge = ConnectableTransport & { call(r: BridgeRequest): Promise<unknown> };

/** SSH через dev-мост (bridge/server.ts): для браузера и E2E, в APK не попадает. */
export function devBridgeTransport(url: string, opts: { WebSocket?: new (url: string) => SocketLike } = {}): DevBridge {
  const WS = opts.WebSocket ?? (globalThis.WebSocket as unknown as new (url: string) => SocketLike);
  const ws = new WS(url);
  const events = new Emitter();
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void; onProgress?: (n: number) => void }>();
  const channels = new Map<number, BridgeChannel>();
  const queue: string[] = [];
  let nextId = 1;
  let closed = false;
  let state: ConnectionState = { state: 'idle' };

  ws.onopen = () => {
    for (const s of queue.splice(0)) ws.send(s);
  };
  ws.onclose = () => {
    closed = true;
    for (const p of pending.values()) p.reject(new BridgeError('NOT_CONNECTED', 'NOT_CONNECTED'));
    pending.clear();
    for (const c of channels.values()) c.emit('close');
    channels.clear();
    if (state.state !== 'idle') {
      state = { state: 'failed' };
      events.emit('state', state);
    }
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data) as BridgeResponse | BridgeEvent;
    if ('id' in m && 'ok' in m) {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.result);
      else p.reject(new BridgeError(m.error.code, m.error.message));
      return;
    }
    switch (m.ev) {
      case 'state':
        state = m.state;
        events.emit('state', m.state);
        break;
      case 'lost':
      case 'reconnected':
        events.emit(m.ev);
        break;
      case 'hostkey':
        events.emit('hostkey', m.prompt);
        break;
      case 'preflight':
        events.emit('preflight', m.event);
        break;
      case 'data':
      case 'stderr':
        channels.get(m.ch)?.push(m.seq, m.ev, fromB64(m.b64));
        break;
      case 'close': {
        const c = channels.get(m.ch);
        channels.delete(m.ch);
        c?.emit('close');
        break;
      }
      case 'progress':
        pending.get(m.id)?.onProgress?.(m.sent);
        break;
    }
  };

  const call = (r: BridgeRequest, onProgress?: (n: number) => void): Promise<unknown> => {
    if (closed) return Promise.reject(new BridgeError('NOT_CONNECTED', 'NOT_CONNECTED'));
    const id = nextId++;
    const msg = JSON.stringify({ id, ...r });
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, onProgress });
      if (ws.readyState === 1) ws.send(msg);
      else queue.push(msg);
    });
  };

  const openChannel = async (r: BridgeRequest): Promise<Channel> => {
    const { ch } = (await call(r)) as { ch: number };
    const c = new BridgeChannel(ch, call);
    channels.set(ch, c);
    return c;
  };

  return {
    call,
    get connected() {
      return !closed && state.state === 'connected';
    },
    exec: (cmd, o = {}) => call({ op: 'exec', cmd, ...o }) as Promise<ExecResult>,
    stream: (cmd) => openChannel({ op: 'stream', cmd }),
    openPty: (cmd, cols, rows) => openChannel({ op: 'pty', cmd, cols, rows }),
    writeFile: async (path, bytes, onProgress) => {
      await call({ op: 'writeFile', path, b64: toB64(bytes) }, onProgress);
    },
    on: ((e: string, cb: (...a: any[]) => void) => events.on(e, cb)) as DevBridge['on'],
    connect: (cfg: VmConfig) => call({ op: 'connect', cfg }) as Promise<Result<void>>,
    close: async () => {
      await call({ op: 'disconnect' }).catch(() => {});
    },
    checkTcp: (host, port) => call({ op: 'tcp', host, port }) as Promise<{ ok: boolean; ms: number | null }>,
    onHostKey: (cb: (p: HostKeyPrompt) => void) => events.on('hostkey', cb),
    answerHostKey: (trust) => void call({ op: 'answerHostKey', trust }).catch(() => {}),
    onPreflight: (cb: (e: PreflightEvent) => void) => events.on('preflight', cb),
  };
}
