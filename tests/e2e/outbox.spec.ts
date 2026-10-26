import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { hasTestKey, launchApp, TEST_KEY, trustedKnownHosts, withConfig, type Launched } from './helpers';

// Файлы, которые Claude сделал для пользователя: outbox → карточки под ответом; скачивает платформа (здесь — dev-мост)
const FAKE = join(__dirname, '../fixtures/fake-claude.mjs');
const OUTBOX = join(homedir(), '.cache/claude-vm-gui/outbox');
const PHONE = { viewport: { width: 393, height: 851 }, mobile: true };
let SOCK = '';
let claudeDir = '';
let downloads = '';
let TAG = '';
const tmux = (...args: string[]) => execFileSync('tmux', ['-L', SOCK, ...args], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
const file = (name: string) => join(OUTBOX, `${TAG}-${name}`);
type Hooks = { lastOpened?: { uri: string; name?: string } };

test.skip(!hasTestKey, 'нет тестового ключа');

test.beforeEach(() => {
  SOCK = `cvg-test-out-${Math.random().toString(16).slice(2, 8)}`;
  TAG = `cvg-test-${Math.random().toString(16).slice(2, 8)}`;
  claudeDir = mkdtempSync(join(tmpdir(), 'cvg-cd-out-'));
  downloads = mkdtempSync(join(tmpdir(), 'cvg-dl-'));
  tmux('new-session', '-d', '-s', 'cvg-out', '-x', '120', '-y', '40', `CVG_CLAUDE_DIR=${claudeDir} CVG_FAKE_OUTBOX_TAG=${TAG} node ${FAKE}`);
});
test.afterEach(() => {
  try {
    tmux('kill-server');
  } catch {}
  for (const n of ['shot.png', 'report.html', 'notes.txt', 'bundle.zip']) rmSync(file(n), { force: true });
  rmSync(downloads, { recursive: true, force: true });
});

async function open(phone = false): Promise<Launched> {
  const userData = withConfig({ host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme: 'light' });
  const l = await launchApp(
    { CVG_USER_DATA: userData, CVG_KNOWN_HOSTS: trustedKnownHosts(), CVG_TMUX_SOCKET: SOCK, CVG_CLAUDE_DIR: claudeDir, CVG_TEST_HOOKS: '1', CVG_DEV_DOWNLOADS: downloads },
    phone ? PHONE : undefined,
  );
  const item = l.page.getByRole('navigation', { name: 'Сессии' }).getByRole('button', { name: /^cvg-out\b/ });
  await (phone ? item.tap({ timeout: 20_000 }) : item.click({ timeout: 20_000 }));
  return l;
}
async function ask(page: Page) {
  const box = page.getByRole('textbox', { name: 'Сообщение для Claude' });
  await box.fill('outbox');
  await box.press('Enter');
}
const card = (page: Page, name: string) => page.getByRole('group', { name: `${TAG}-${name}` });
const hooks = (page: Page) => page.evaluate(() => (window as unknown as { __cvg: Hooks }).__cvg.lastOpened ?? null);
/** Файлы, сохранённые мостом в «Загрузки» (подпапка downloads) */
const saved = () => readdirSync(join(downloads, 'downloads'));

test('карточки под ответом; «Сохранить» — в «Загрузки», «Открыть» — открывает сохранённое; HTML — в браузере', async () => {
  const { app, page } = await open();
  try {
    await ask(page);
    await expect(card(page, 'shot.png').getByRole('img', { name: `${TAG}-shot.png` })).toBeVisible({ timeout: 15_000 });
    await card(page, 'notes.txt').getByRole('button', { name: new RegExp(`${TAG}-notes.txt`) }).click();
    await expect(card(page, 'notes.txt')).toContainText('Заметки: всё готово');
    await expect(card(page, 'bundle.zip')).toContainText('2 МБ');

    await card(page, 'bundle.zip').getByRole('button', { name: 'Сохранить' }).click();
    await expect(card(page, 'bundle.zip')).toContainText('Сохранено', { timeout: 15_000 });
    expect(saved()).toEqual([`${TAG}-bundle.zip`]);
    expect(readFileSync(join(downloads, 'downloads', `${TAG}-bundle.zip`)).equals(readFileSync(file('bundle.zip')))).toBe(true);
    await card(page, 'bundle.zip').getByRole('button', { name: 'Открыть' }).click();
    await expect.poll(() => hooks(page)).toMatchObject({ uri: join(downloads, 'downloads', `${TAG}-bundle.zip`) });

    await card(page, 'report.html').getByRole('button', { name: 'Открыть в браузере' }).click();
    await expect.poll(() => hooks(page).then((h) => h?.name)).toBe(`${TAG}-report.html`);
    const opened = (await hooks(page))!.uri;
    expect(opened.startsWith(join(downloads, 'view-html'))).toBe(true);
    expect(readFileSync(opened).equals(readFileSync(file('report.html')))).toBe(true);
  } finally {
    await app.close();
  }
});

test('телефон: «Сохранить» касанием — файл в «Загрузках»', async () => {
  const { app, page } = await open(true);
  try {
    await ask(page);
    const btn = card(page, 'notes.txt').getByRole('button', { name: 'Сохранить' });
    await expect(btn).toBeVisible({ timeout: 15_000 });
    // кнопки карточки — в зоне касания
    expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await btn.tap();
    await expect(card(page, 'notes.txt')).toContainText('Сохранено', { timeout: 15_000 });
    expect(saved()).toEqual([`${TAG}-notes.txt`]);
  } finally {
    await app.close();
  }
});

test('«Открыть в браузере» открывает только HTML — и при прямом вызове из страницы', async () => {
  const { app, page } = await open();
  try {
    await ask(page);
    await expect(card(page, 'bundle.zip')).toBeVisible({ timeout: 15_000 });
    const r = await page.evaluate((p) => (window as unknown as { api: { outbox: { openHtml(p: string): Promise<unknown> } } }).api.outbox.openHtml(p), file('bundle.zip'));
    expect(r).toMatchObject({ ok: false, error: { code: 'BAD_PATH' } });
    expect(await hooks(page)).toBeNull();
    expect(readdirSync(downloads)).toEqual([]);
  } finally {
    await app.close();
  }
});
