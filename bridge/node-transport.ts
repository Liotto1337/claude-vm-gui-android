import type { ClientChannel } from 'ssh2';
import type { Channel, ExecResult, SshTransport } from '../src/core/transport';
import type { SshConnection } from './ssh';

const CHUNK = 64 * 1024;

/** ClientChannel ssh2 как Channel: Buffer — уже Uint8Array, отличается только setWindow. */
function asChannel(s: ClientChannel): Channel {
  return {
    on: (e: string, cb: (...a: any[]) => void) => void s.on(e, cb),
    stderr: { on: (_e: 'data', cb: (d: Uint8Array) => void) => void s.stderr.on('data', cb) },
    write: (d) => void s.write(d),
    end: () => void s.end(),
    close: () => void s.close(),
    setWindow: (rows, cols) => s.setWindow(rows, cols, 0, 0),
  } as Channel;
}

/** SshTransport поверх SshConnection (ssh2): для dev-моста и интеграционных тестов. */
export class NodeTransport implements SshTransport {
  constructor(private readonly conn: SshConnection) {}

  get connected(): boolean {
    return this.conn.connected;
  }

  exec(cmd: string, opts?: { stdin?: string; timeoutMs?: number }): Promise<ExecResult> {
    return this.conn.exec(cmd, opts);
  }

  async stream(cmd: string): Promise<Channel> {
    return asChannel(await this.conn.stream(cmd));
  }

  async openPty(cmd: string, cols: number, rows: number): Promise<Channel> {
    return asChannel(await this.conn.openPty(cmd, cols, rows));
  }

  async writeFile(path: string, bytes: Uint8Array, onProgress: (sent: number) => void): Promise<void> {
    const sftp = await this.conn.sftp();
    const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    await new Promise<void>((resolve, reject) => {
      const ws = sftp.createWriteStream(path, { mode: 0o600 });
      ws.on('error', reject);
      ws.on('close', () => resolve());
      let sent = 0;
      const writeNext = () => {
        while (sent < data.length) {
          const chunk = data.subarray(sent, sent + CHUNK);
          sent += chunk.length;
          onProgress(sent);
          if (!ws.write(chunk)) {
            ws.once('drain', writeNext);
            return;
          }
        }
        ws.end();
      };
      writeNext();
    });
  }

  on(e: 'state' | 'lost' | 'reconnected', cb: (...a: any[]) => void): () => void {
    this.conn.on(e, cb);
    return () => void this.conn.off(e, cb);
  }
}
