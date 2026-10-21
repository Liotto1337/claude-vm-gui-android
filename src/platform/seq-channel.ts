import { Emitter } from '@core/emitter';
import type { Channel } from '@core/transport';

export interface ChannelOps {
  write(data: string): void;
  end(): void;
  close(): void;
  resize(rows: number, cols: number): void;
}

/** Канал, у которого пачки собираются по seq: порядок байтов не зависит от доставки. Общий для моста и Android. */
export class SeqChannel extends Emitter implements Channel {
  private next = 0;
  private closed = false;
  private readonly held = new Map<number, { kind: 'data' | 'stderr'; bytes: Uint8Array }>();
  readonly stderr = new Emitter();

  constructor(private readonly ops: ChannelOps) {
    super();
  }

  push(seq: number, kind: 'data' | 'stderr', bytes: Uint8Array): void {
    if (this.closed) return;
    this.held.set(seq, { kind, bytes });
    for (let p = this.held.get(this.next); p; p = this.held.get(this.next)) {
      this.held.delete(this.next++);
      if (p.kind === 'data') this.emit('data', p.bytes);
      else this.stderr.emit('data', p.bytes);
    }
  }

  /** Канал закрыт на стороне SSH: дальше пачки не принимаются. */
  closedByPeer(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }

  write(data: string): void {
    this.ops.write(data);
  }
  end(): void {
    this.ops.end();
  }
  close(): void {
    this.ops.close();
  }
  setWindow(rows: number, cols: number): void {
    this.ops.resize(rows, cols);
  }
}

export const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
