import { Emitter } from './emitter';
import { fail, ok, type ImageExt, type Result } from '@shared/ipc';
import type { SshTransport } from './transport';

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const UPLOAD_DIR = '"$HOME/.cache/claude-vm-gui/uploads"';
const EXTS: ImageExt[] = ['png', 'jpg', 'gif', 'webp'];

const pad = (n: number) => String(n).padStart(2, '0');
const randomHex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
function fileName(ext: ImageExt, d = new Date()): string {
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${stamp}-${randomHex(3)}.${ext}`;
}

/** Загрузка картинок на ВМ по SFTP. Событие `progress` (UploadProgress). */
export class UploadService extends Emitter {
  private dir: string | null = null;

  constructor(private readonly conn: SshTransport) {
    super();
    conn.on('reconnected', () => {
      this.dir = null;
    });
  }

  private async uploadDir(): Promise<string> {
    if (this.dir) return this.dir;
    const r = await this.conn.exec(`mkdir -p ${UPLOAD_DIR} && cd ${UPLOAD_DIR} && pwd`);
    if (r.code !== 0) throw new Error(r.stderr.trim() || 'Не удалось создать папку для картинок');
    this.dir = r.stdout.trim();
    return this.dir;
  }

  async image(id: string, bytes: Uint8Array, ext: ImageExt): Promise<Result<{ remotePath: string }>> {
    if (bytes.byteLength > MAX_IMAGE_BYTES) return fail('UPLOAD_TOO_BIG', 'Картинка больше 20 МБ');
    if (!EXTS.includes(ext)) return fail('UPLOAD_FAILED', 'Поддерживаются PNG, JPEG, GIF и WebP');
    if (!this.conn.connected) return fail('NOT_CONNECTED', 'Нет подключения к ВМ');
    try {
      const remotePath = `${await this.uploadDir()}/${fileName(ext)}`;
      const total = bytes.byteLength;
      if (total === 0) this.emit('progress', { id, sent: 0, total: 0 });
      await this.conn.writeFile(remotePath, bytes, (sent) => this.emit('progress', { id, sent, total }));
      return ok({ remotePath });
    } catch (e) {
      return fail('UPLOAD_FAILED', (e as Error).message);
    }
  }

  /** Удаляет загруженные картинки старше 7 дней. */
  async cleanup(): Promise<void> {
    if (!this.conn.connected) return;
    await this.conn.exec(`find ${UPLOAD_DIR} -type f -mtime +7 -delete 2>/dev/null; true`);
  }
}
