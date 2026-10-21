import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const TEST_KEY = join(homedir(), '.ssh', 'cvg_test_ed25519');
export const hasTestKey = existsSync(TEST_KEY);
export const BASE_URL = 'http://127.0.0.1:4173/';

/**
 * Папка «данных приложения» с настройками. keyPath — ключ, который мост считает импортированным;
 * сам конфиг попадает в localStorage профиля Chromium при первом запуске.
 */
export function withConfig(cfg: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'cvg-e2e-'));
  writeFileSync(join(dir, 'config.json'), JSON.stringify(cfg));
  return dir;
}

export const tempKnownHostsPath = () => join(mkdtempSync(join(tmpdir(), 'cvg-kh-')), 'known_hosts');

/** known_hosts, где ключ localhost уже записан — подключение без диалога «Новый сервер». */
export function trustedKnownHosts(): string {
  const path = tempKnownHostsPath();
  writeFileSync(path, execFileSync('ssh-keyscan', ['-t', 'ed25519', '127.0.0.1'], { stdio: ['ignore', 'pipe', 'ignore'] }));
  return path;
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

/** Dev-мост на свободном порту; ждёт строки «dev-мост». */
async function startBridge(env: Record<string, string>): Promise<{ port: number; proc: ChildProcess }> {
  const port = await freePort();
  const proc = spawn('node_modules/.bin/tsx', ['--tsconfig', 'tsconfig.node.json', 'bridge/server.ts'], {
    env: { ...process.env, ...env, CVG_BRIDGE_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('dev-мост не запустился за 20 с')), 20_000);
    proc.stdout!.on('data', (d: Buffer) => {
      if (String(d).includes('dev-мост')) {
        clearTimeout(t);
        resolve();
      }
    });
    proc.once('exit', (code) => reject(new Error(`dev-мост завершился: ${code}`)));
  });
  return { port, proc };
}

export interface Launched {
  app: { close(): Promise<void> };
  page: Page;
  context: BrowserContext;
  userData: string;
}

/**
 * «Запуск приложения»: dev-мост + Chromium с постоянным профилем в userData (настройки и раскладка переживают перезапуск).
 * Переменные как в 0.2.2: CVG_USER_DATA, CVG_KNOWN_HOSTS, CVG_TMUX_SOCKET, CVG_FAKE_CLAUDE, CVG_CLAUDE_CMD, CVG_CLAUDE_DIR,
 * CVG_TEST_HOOKS, CVG_DEMO_HOST. Окно 1280×800.
 */
export async function launchApp(env: Record<string, string> = {}, opts: { viewport?: { width: number; height: number }; mobile?: boolean } = {}): Promise<Launched> {
  const userData = env.CVG_USER_DATA ?? mkdtempSync(join(tmpdir(), 'cvg-e2e-'));
  const cfgFile = join(userData, 'config.json');
  const { keyPath, ...cfg } = existsSync(cfgFile) ? (JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, unknown>) : ({} as Record<string, unknown>);
  const bridge = await startBridge({
    CVG_KNOWN_HOSTS: env.CVG_KNOWN_HOSTS ?? tempKnownHostsPath(),
    ...(typeof keyPath === 'string' && keyPath ? { CVG_BRIDGE_KEY: keyPath } : {}),
  });
  const context = await chromium.launchPersistentContext(join(userData, 'profile'), {
    viewport: opts.viewport ?? { width: 1280, height: 800 },
    ...(opts.mobile ? { isMobile: true, hasTouch: true } : {}),
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  if (cfg.host) {
    await context.addInitScript((c: string) => {
      if (localStorage.getItem('cvg:config') === null) localStorage.setItem('cvg:config', c);
    }, JSON.stringify(cfg));
  }
  const knobs: Record<string, unknown> = {};
  if (env.CVG_TMUX_SOCKET) knobs.tmuxSocket = env.CVG_TMUX_SOCKET;
  if (env.CVG_FAKE_CLAUDE === '1') knobs.fakeClaude = true;
  if (env.CVG_CLAUDE_CMD) knobs.claudeCmd = env.CVG_CLAUDE_CMD;
  if (env.CVG_CLAUDE_DIR) knobs.claudeDir = env.CVG_CLAUDE_DIR;
  const q = new URLSearchParams({ bridge: `ws://127.0.0.1:${bridge.port}`, knobs: JSON.stringify(knobs) });
  if (env.CVG_TEST_HOOKS === '1') q.set('testHooks', '1');
  if (env.CVG_DEMO_HOST) q.set('demoHost', env.CVG_DEMO_HOST);
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`${BASE_URL}?${q}`);
  await page.waitForLoadState('domcontentloaded');
  return {
    page,
    context,
    userData,
    app: {
      close: async () => {
        // Как закрытие вкладки: pagehide успевает сохранить отложенную запись раскладки
        await page.close({ runBeforeUnload: true }).catch(() => {});
        await page.waitForEvent('close', { timeout: 2000 }).catch(() => {});
        await context.close().catch(() => {});
        bridge.proc.kill();
      },
    },
  };
}

/** Буфер обмена страницы (Chromium, с разрешением clipboard-read). */
export const readClipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());
export const writeClipboard = (page: Page, text: string) => page.evaluate((t) => navigator.clipboard.writeText(t), text);
/** Картинка PNG (base64) в буфер обмена страницы. */
export const writeClipboardPng = (page: Page, b64: string) =>
  page.evaluate(async (b) => {
    const png = new Blob([Uint8Array.from(atob(b), (c) => c.charCodeAt(0))], { type: 'image/png' });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  }, b64);
