import type { ConnectionState, HostKeyPrompt, PreflightEvent, Result, VmConfig } from '@shared/ipc';
import { Emitter } from '@core/emitter';
import type { Channel, ConnectableTransport, ExecResult } from '@core/transport';
import type { BridgeEvent, BridgeRequest, BridgeResponse } from './bridge-protocol';
import { fromB64, SeqChannel, toB64 } from './seq-channel';

type SocketLike = {
  readyState: number;
  send(s: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: string }) => void) | null;
  onclose: (() => void) | null;
};

class BridgeError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export type DevBridge = ConnectableTransport & { call(r: BridgeRequest, onProgress?: (n: number, total?: number) => void): Promise<unknown> };

/** SSH через dev-мост (bridge/server.ts): для браузера и E2E, в APK не попадает. */
export function devBridgeTransport(url: string, opts: { WebSocket?: new (url: string) => SocketLike } = {}): DevBridge {
  const WS = opts.WebSocket ?? (globalThis.WebSocket as unknown as new (url: string) => SocketLike);
  const ws = new WS(url);
  const events = new Emitter();
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void; onProgress?: (n: number, total?: number) => void }>();
  const channels = new Map<number, SeqChannel>();
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
    for (const c of channels.values()) c.closedByPeer();
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
        c?.closedByPeer();
        break;
      }
      case 'progress':
        pending.get(m.id)?.onProgress?.(m.sent, m.total);
        break;
    }
  };

  const call = (r: BridgeRequest, onProgress?: (n: number, total?: number) => void): Promise<unknown> => {
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
    const quiet = (r: BridgeRequest) => void call(r).catch(() => {});
    const c = new SeqChannel({
      write: (data) => quiet({ op: 'write', ch, data }),
      end: () => quiet({ op: 'end', ch }),
      close: () => quiet({ op: 'close', ch }),
      resize: (rows, cols) => quiet({ op: 'resize', ch, rows, cols }),
    });
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
    forgetHostKey: async (host, port) => {
      await call({ op: 'forgetHostKey', host, port });
    },
  };
}
