import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SshConnection } from '../../bridge/ssh';
import { NodeTransport } from '../../bridge/node-transport';
import { UploadService } from '../../src/core/upload';
import { hasTestKey, tempKnownHosts, testConfig } from './helpers';

const OUTBOX = join(homedir(), '.cache/claude-vm-gui/outbox');

describe.skipIf(!hasTestKey)('папка outbox: чтение, проверка пути, очистка', () => {
  let conn: SshConnection;
  let upload: UploadService;
  const made: string[] = [];
  const put = (name: string, data: string) => {
    mkdirSync(OUTBOX, { recursive: true });
    const p = join(OUTBOX, name);
    writeFileSync(p, data);
    made.push(p);
    return p;
  };

  beforeAll(async () => {
    conn = new SshConnection(testConfig(), { knownHostsPath: tempKnownHosts(), askHostKey: async () => true });
    expect((await conn.connect()).ok).toBe(true);
    upload = new UploadService(new NodeTransport(conn));
  });
  afterAll(() => {
    for (const f of made) rmSync(f, { force: true });
    conn.close();
  });

  it('папка создаётся сама, файл outbox читается', async () => {
    rmSync(OUTBOX, { recursive: true, force: true });
    expect(await upload.read(join(OUTBOX, 'cvg-test-none'), 10)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(existsSync(OUTBOX)).toBe(true);
    const r = await upload.read(put('cvg-test-a.txt', 'привет'), 1000);
    expect(r.ok && new TextDecoder().decode(r.data.bytes)).toBe('привет');
  });

  it('outboxFile: настоящий путь и размер; ссылка наружу, «..» и загрузки — BAD_PATH', async () => {
    const p = put('cvg-test-b.bin', 'x'.repeat(1234));
    expect(await upload.outboxFile(p)).toEqual({ ok: true, data: { real: p, size: 1234 } });
    const link = join(OUTBOX, 'cvg-test-link');
    rmSync(link, { force: true });
    symlinkSync(join(homedir(), '.ssh/authorized_keys'), link);
    made.push(link);
    expect(await upload.outboxFile(link)).toMatchObject({ ok: false, error: { code: 'BAD_PATH' } });
    expect(await upload.read(link, 100)).toMatchObject({ ok: false, error: { code: 'BAD_PATH' } });
    expect(await upload.outboxFile(`${OUTBOX}/../uploads/x`)).toMatchObject({ ok: false });
    const uploads = join(homedir(), '.cache/claude-vm-gui/uploads');
    mkdirSync(uploads, { recursive: true });
    const u = join(uploads, 'cvg-test-up.txt');
    writeFileSync(u, 'x');
    made.push(u);
    expect(await upload.outboxFile(u)).toMatchObject({ ok: false, error: { code: 'BAD_PATH' } });
    expect(await upload.outboxFile(join(OUTBOX, 'cvg-test-none'))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('очистка: старше 7 дней удаляется, свежий остаётся', async () => {
    const old = put('cvg-test-old.txt', 'old');
    const fresh = put('cvg-test-fresh.txt', 'fresh');
    execFileSync('touch', ['-d', '8 days ago', old]);
    await upload.cleanup();
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  it('мост: обрыв связи посреди скачивания — недокачанного файла нет', async () => {
    const big = put('cvg-test-cut.bin', 'x'.repeat(20 * 1024 * 1024));
    const c = new SshConnection(testConfig(), { knownHostsPath: tempKnownHosts(), askHostKey: async () => true });
    expect((await c.connect()).ok).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), 'cvg-dl-cut-'));
    const dest = join(dir, 'cut.bin');
    let closed = false;
    await expect(
      new NodeTransport(c).readFile(big, dest, (sent) => {
        if (!closed && sent > 1024 * 1024) {
          closed = true;
          c.close();
        }
      }),
    ).rejects.toThrow();
    expect(readdirSync(dir)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});
