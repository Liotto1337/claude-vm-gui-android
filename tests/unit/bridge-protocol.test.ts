import { describe, expect, it } from 'vitest';
import { devBridgeTransport } from '../../src/platform/devbridge';

/** Фейковый WebSocket: запоминает отправленное, сервер «отвечает» через reply/event. */
class FakeSocket {
  static last: FakeSocket;
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.last = this;
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }
  send(s: string) {
    this.sent.push(JSON.parse(s));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  server(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  lastId(): number {
    return this.sent[this.sent.length - 1].id as number;
  }
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('devBridgeTransport', () => {
  it('пачки канала отдаются по порядку seq, даже если пришли вразнобой', async () => {
    const t = devBridgeTransport('ws://x', { WebSocket: FakeSocket as never });
    await tick();
    const ws = FakeSocket.last;
    const pending = t.openPty('tmux attach', 80, 24);
    await tick();
    expect(ws.sent.at(-1)).toMatchObject({ op: 'pty', cmd: 'tmux attach', cols: 80, rows: 24 });
    ws.server({ id: ws.lastId(), ok: true, result: { ch: 7 } });
    const ch = await pending;
    const got: string[] = [];
    ch.on('data', (d) => got.push(new TextDecoder().decode(d)));
    ws.server({ ev: 'data', ch: 7, seq: 1, b64: b64('b') });
    ws.server({ ev: 'data', ch: 7, seq: 0, b64: b64('a') });
    ws.server({ ev: 'data', ch: 7, seq: 2, b64: b64('c') });
    expect(got).toEqual(['a', 'b', 'c']);
  });

  it('ответ на неизвестный id игнорируется', async () => {
    devBridgeTransport('ws://x', { WebSocket: FakeSocket as never });
    await tick();
    expect(() => FakeSocket.last.server({ id: 999, ok: true, result: null })).not.toThrow();
  });

  it('exec после закрытия сокета — ошибка NOT_CONNECTED', async () => {
    const t = devBridgeTransport('ws://x', { WebSocket: FakeSocket as never });
    await tick();
    FakeSocket.last.close();
    await expect(t.exec('echo hi')).rejects.toThrow('NOT_CONNECTED');
  });

  it('ожидающий запрос отклоняется, когда сокет закрылся', async () => {
    const t = devBridgeTransport('ws://x', { WebSocket: FakeSocket as never });
    await tick();
    const p = t.exec('sleep 10');
    await tick();
    FakeSocket.last.close();
    await expect(p).rejects.toThrow('NOT_CONNECTED');
  });
});
