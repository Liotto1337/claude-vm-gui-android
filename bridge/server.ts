// Dev-мост: SSH из браузера через Node (ssh2). Только для разработки и E2E, в APK не попадает.
//   npm run bridge — слушает 127.0.0.1:${CVG_BRIDGE_PORT ?? 8790}
//   CVG_KNOWN_HOSTS — свой known_hosts; CVG_BRIDGE_KEY — путь к ключу; CVG_BRIDGE_PASSWORD — пароль
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { utils, type ClientChannel } from 'ssh2';
import { WebSocketServer, type WebSocket } from 'ws';
import { fail, ok, type HostKeyPrompt, type VmConfig } from '../src/shared/ipc';
import type { BridgeEvent, BridgeRequest } from '../src/platform/bridge-protocol';
import { removeHost } from '../src/shared/known-hosts';
import { bridgeAllowed } from './auth';
import { checkTcp } from './preflight';
import { SshConnection } from './ssh';

/** Секреты моста — в памяти процесса, общие для всех вкладок. */
const secrets: { password?: string; key?: string; passphrase?: string } = {
  password: process.env.CVG_BRIDGE_PASSWORD || undefined,
  key: process.env.CVG_BRIDGE_KEY ? readFileSync(process.env.CVG_BRIDGE_KEY, 'utf8') : undefined,
};

/** Тип ключа как в ssh-keygen: ssh-ed25519 → ed25519. */
function keyTypeOf(text: string, passphrase?: string): { type: string } | { error: 'passphrase' | 'invalid' | 'wrong-passphrase' } {
  const parsed = utils.parseKey(text, passphrase);
  if (parsed instanceof Error) {
    if (/no passphrase/i.test(parsed.message)) return { error: 'passphrase' };
    if (/passphrase|decrypt|bad/i.test(parsed.message) && passphrase) return { error: 'wrong-passphrase' };
    return { error: 'invalid' };
  }
  const k = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!k.isPrivateKey()) return { error: 'invalid' };
  return { type: k.type.replace(/^ssh-/, '').replace(/^ecdsa-sha2-.*/, 'ecdsa') };
}

function session(ws: WebSocket): void {
  let conn: SshConnection | null = null;
  let hostKeyAnswer: ((trust: boolean) => void) | null = null;
  const channels = new Map<number, { s: ClientChannel; seq: number }>();
  let nextCh = 1;
  const send = (m: unknown) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
  const ev = (e: BridgeEvent) => send(e);

  const open = (s: ClientChannel): { ch: number } => {
    const ch = nextCh++;
    const c = { s, seq: 0 };
    channels.set(ch, c);
    s.on('data', (d: Buffer) => ev({ ev: 'data', ch, seq: c.seq++, b64: d.toString('base64') }));
    s.stderr.on('data', (d: Buffer) => ev({ ev: 'stderr', ch, seq: c.seq++, b64: d.toString('base64') }));
    s.on('error', () => {});
    s.on('close', () => {
      channels.delete(ch);
      ev({ ev: 'close', ch });
    });
    return { ch };
  };
  const need = () => {
    if (!conn?.connected) throw Object.assign(new Error('NOT_CONNECTED'), { code: 'NOT_CONNECTED' });
    return conn;
  };

  const handle = async (id: number, r: BridgeRequest): Promise<unknown> => {
    switch (r.op) {
      case 'connect': {
        conn?.close();
        const cfg: VmConfig = r.cfg;
        const c = new SshConnection(
          cfg,
          {
            knownHostsPath: process.env.CVG_KNOWN_HOSTS ?? join(homedir(), '.ssh', 'known_hosts'),
            askHostKey: (p: HostKeyPrompt) =>
              new Promise((resolve) => {
                hostKeyAnswer?.(false);
                hostKeyAnswer = resolve;
                ev({ ev: 'hostkey', prompt: p });
              }),
            onPreflight: (event) => ev({ ev: 'preflight', event }),
            password: secrets.password,
            privateKey: secrets.key,
            passphrase: secrets.passphrase,
          },
        );
        c.on('state', (state) => ev({ ev: 'state', state }));
        c.on('lost', () => ev({ ev: 'lost' }));
        c.on('reconnected', () => ev({ ev: 'reconnected' }));
        conn = c;
        const res = await c.connect();
        if (!res.ok) {
          c.close();
          if (conn === c) conn = null;
        }
        return res;
      }
      case 'disconnect':
        hostKeyAnswer?.(false);
        hostKeyAnswer = null;
        conn?.close();
        conn = null;
        return null;
      case 'exec':
        return need().exec(r.cmd, { stdin: r.stdin, timeoutMs: r.timeoutMs });
      case 'stream':
        return open(await need().stream(r.cmd));
      case 'pty':
        return open(await need().openPty(r.cmd, r.cols, r.rows));
      case 'write':
        channels.get(r.ch)?.s.write(r.data);
        return null;
      case 'end':
        channels.get(r.ch)?.s.end();
        return null;
      case 'close':
        channels.get(r.ch)?.s.close();
        return null;
      case 'resize':
        channels.get(r.ch)?.s.setWindow(r.rows, r.cols, 0, 0);
        return null;
      case 'writeFile': {
        const { NodeTransport } = await import('./node-transport');
        await new NodeTransport(need()).writeFile(r.path, Buffer.from(r.b64, 'base64'), (sent) => ev({ ev: 'progress', id, sent }));
        return null;
      }
      case 'downloadFile': {
        // Как Kotlin: «Загрузки» — без перезаписи («имя (1).ext»), просмотр — своя папка на каждое открытие
        const { NodeTransport } = await import('./node-transport');
        const root = process.env.CVG_DEV_DOWNLOADS ?? join(tmpdir(), 'cvg-dev-downloads');
        const name = r.name.replace(/[/\\]/g, '_') || 'file';
        const dir = r.target === 'downloads' ? join(root, 'downloads') : join(root, 'view-html', randomUUID());
        mkdirSync(dir, { recursive: true });
        const ext = extname(name);
        let dest = join(dir, name);
        for (let n = 1; existsSync(dest); n++) dest = join(dir, `${name.slice(0, name.length - ext.length)} (${n})${ext}`);
        await new NodeTransport(need()).readFile(r.path, dest, (sent, total) => ev({ ev: 'progress', id, sent, total }));
        return { uri: dest };
      }
      case 'answerHostKey':
        hostKeyAnswer?.(r.trust === true);
        hostKeyAnswer = null;
        return null;
      case 'forgetHostKey': {
        const path = process.env.CVG_KNOWN_HOSTS ?? join(homedir(), '.ssh', 'known_hosts');
        if (existsSync(path)) writeFileSync(path, removeHost(readFileSync(path, 'utf8'), r.host, r.port));
        return null;
      }
      case 'tcp': {
        const t = await checkTcp(r.host, r.port);
        return { ok: t.ok, ms: t.ms };
      }
      case 'secrets.save': {
        if (r.name === 'password') {
          secrets.password = r.value || undefined;
          return ok({});
        }
        if (!r.value) {
          secrets.key = undefined;
          secrets.passphrase = undefined;
          return ok({});
        }
        const t = keyTypeOf(r.value, r.passphrase);
        if ('error' in t) {
          if (t.error === 'passphrase') return fail('CONFIG_INVALID', 'Ключ защищён парольной фразой');
          if (t.error === 'wrong-passphrase') return fail('CONFIG_INVALID', 'Неверная парольная фраза');
          return fail('CONFIG_INVALID', 'Это не закрытый ключ OpenSSH или PEM');
        }
        secrets.key = r.value;
        secrets.passphrase = r.passphrase;
        return ok({ keyType: t.type });
      }
      case 'secrets.has':
        return (r.name === 'password' ? secrets.password : secrets.key) ? 'yes' : 'no';
      case '__drop':
        (conn as unknown as { client?: { end(): void } } | null)?.client?.end();
        return null;
    }
  };

  ws.on('message', (raw) => {
    const { id, ...r } = JSON.parse(String(raw)) as { id: number } & BridgeRequest;
    handle(id, r as BridgeRequest).then(
      (result) => send({ id, ok: true, result: result ?? null }),
      (e: Error & { code?: string }) => send({ id, ok: false, error: { code: e.code ?? 'NOT_CONNECTED', message: e.message } }),
    );
  });
  ws.on('close', () => {
    hostKeyAnswer?.(false);
    conn?.close();
  });
}

const port = Number(process.env.CVG_BRIDGE_PORT ?? 8790);
// Случайный токен на запуск: страница передаёт его в ?bridge=ws://…/?token=…
const token = process.env.CVG_BRIDGE_TOKEN || randomBytes(16).toString('hex');
const wss = new WebSocketServer({
  host: '127.0.0.1',
  port,
  maxPayload: 64 * 1024 * 1024,
  verifyClient: (info: { origin: string; req: { url?: string } }) => bridgeAllowed(info.origin, info.req.url, token),
});
wss.on('connection', session);
wss.on('listening', () => {
  const url = `ws://127.0.0.1:${port}/?token=${token}`;
  console.log(`dev-мост: ${url}`);
  console.log(`интерфейс: http://127.0.0.1:5173/?bridge=${encodeURIComponent(url)}`);
});
