import { Emitter } from './emitter';
import { fail, ok, type Result } from '@shared/ipc';
import { shellQuote } from '@shared/quote';
import { MAX_FILE_BYTES, remoteName } from '@shared/upload-name';
import type { SshTransport } from './transport';

const UPLOAD_DIR = '"$HOME/.cache/claude-vm-gui/uploads"';
/** Папка «для вас»: сюда Claude кладёт файлы для пользователя (см. CLAUDE.md на ВМ) */
const OUTBOX_DIR = '"$HOME/.cache/claude-vm-gui/outbox"';

/**
 * Файлы на ВМ: загрузка по SFTP в папку загрузок (событие `progress`, UploadProgress), чтение начала файла
 * из загрузок и outbox, проверка файла outbox перед скачиванием (скачивает платформа).
 */
export class UploadService extends Emitter {
  private dirs: { uploads: string; outbox: string } | null = null;

  constructor(private readonly conn: SshTransport) {
    super();
    conn.on('reconnected', () => {
      this.dirs = null;
    });
  }

  private async folders(): Promise<{ uploads: string; outbox: string }> {
    if (this.dirs) return this.dirs;
    const r = await this.conn.exec(`mkdir -p ${UPLOAD_DIR} ${OUTBOX_DIR} && cd ${UPLOAD_DIR} && pwd -P && cd ${OUTBOX_DIR} && pwd -P`);
    if (r.code !== 0) throw new Error(r.stderr.trim() || 'Не удалось создать папку для загрузок');
    const [uploads, outbox] = r.stdout.trim().split('\n');
    this.dirs = { uploads, outbox };
    return this.dirs;
  }

  private async uploadDir(): Promise<string> {
    return (await this.folders()).uploads;
  }

  /** Настоящий путь файла внутри одной из папок (после realpath: никаких «..» и ссылок наружу) и его размер. */
  private async locate(path: string, dirs: string[]): Promise<Result<{ real: string; size: number }>> {
    if (typeof path !== 'string' || !path.startsWith('/')) return fail('BAD_PATH', 'Файл не из папки загрузок');
    const r = await this.conn.exec(`p=$(realpath -e -- ${shellQuote(path)}) && [ -f "$p" ] && printf '%s\\n' "$p" && stat -c %s -- "$p"`);
    if (r.code !== 0) return fail('NOT_FOUND', 'Файл удалён с ВМ');
    const [real, sizeText] = r.stdout.trimEnd().split('\n');
    if (!dirs.some((d) => real.startsWith(`${d}/`))) return fail('BAD_PATH', 'Файл не из папки загрузок');
    return ok({ real, size: Number(sizeText) });
  }

  /** Файл outbox перед скачиванием: настоящий путь и размер; вне outbox — BAD_PATH. */
  async outboxFile(path: string): Promise<Result<{ real: string; size: number }>> {
    if (!this.conn.connected) return fail('NOT_CONNECTED', 'Нет подключения к ВМ');
    try {
      return await this.locate(path, [(await this.folders()).outbox]);
    } catch (e) {
      return fail('DOWNLOAD_FAILED', (e as Error).message);
    }
  }

  async file(id: string, bytes: Uint8Array, name: string): Promise<Result<{ remotePath: string }>> {
    if (bytes.byteLength > MAX_FILE_BYTES) return fail('UPLOAD_TOO_BIG', 'Файл больше 50 МБ');
    if (!this.conn.connected) return fail('NOT_CONNECTED', 'Нет подключения к ВМ');
    try {
      const remotePath = `${await this.uploadDir()}/${remoteName(String(name))}`;
      const total = bytes.byteLength;
      if (total === 0) this.emit('progress', { id, sent: 0, total: 0 });
      await this.conn.writeFile(remotePath, bytes, (sent) => this.emit('progress', { id, sent, total }));
      return ok({ remotePath });
    } catch (e) {
      return fail('UPLOAD_FAILED', (e as Error).message);
    }
  }

  /**
   * Начало файла для ленты: не больше maxBytes и полный размер. Только внутри папки загрузок или outbox —
   * путь проверяется после realpath (никаких «..» и ссылок наружу). Байты — через поток канала (exec отдаёт строку
   * и испортил бы двоичные данные).
   */
  async read(path: string, maxBytes: number): Promise<Result<{ bytes: Uint8Array; size: number; truncated: boolean }>> {
    if (!this.conn.connected) return fail('NOT_CONNECTED', 'Нет подключения к ВМ');
    try {
      const { uploads, outbox } = await this.folders();
      const found = await this.locate(path, [uploads, outbox]);
      if (!found.ok) return found;
      const { real, size } = found.data;
      const n = Math.max(0, Math.min(size, Number.isFinite(maxBytes) ? maxBytes : 0));
      const bytes = n > 0 ? await this.head(real, n) : new Uint8Array(0);
      return ok({ bytes, size, truncated: size > bytes.byteLength });
    } catch (e) {
      return fail('UPLOAD_FAILED', (e as Error).message);
    }
  }

  private async head(path: string, n: number): Promise<Uint8Array> {
    const ch = await this.conn.stream(`head -c ${n} -- ${shellQuote(path)}`);
    const parts: Uint8Array[] = [];
    await new Promise<void>((resolve) => {
      ch.on('data', (d) => parts.push(d));
      ch.on('close', () => resolve());
      ch.on('error', () => resolve());
    });
    const out = new Uint8Array(parts.reduce((a, p) => a + p.byteLength, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.byteLength;
    }
    return out;
  }

  /** Удаляет загруженные файлы и файлы outbox старше 7 дней. */
  async cleanup(): Promise<void> {
    if (!this.conn.connected) return;
    await this.conn.exec(`find ${UPLOAD_DIR} ${OUTBOX_DIR} -type f -mtime +7 -delete 2>/dev/null; true`);
  }
}
