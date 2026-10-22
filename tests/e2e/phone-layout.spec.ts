import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { hasTestKey, launchApp, TEST_KEY, trustedKnownHosts, withConfig, type Launched } from './helpers';

// Телефон 393×851 с касаниями; отдельный сервер tmux — настоящие сессии не мешают
let SOCK = '';
const tmux = (...args: string[]) => execFileSync('tmux', ['-L', SOCK, ...args], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
export const PHONE = { viewport: { width: 393, height: 851 }, mobile: true };

test.skip(!hasTestKey, 'нет тестового ключа');

test.beforeEach(() => {
  SOCK = `cvg-test-ph-${Math.random().toString(16).slice(2, 8)}`;
  tmux('new-session', '-d', '-s', 'cvg-test-a');
  tmux('new-session', '-d', '-s', 'cvg-test-b');
});
test.afterEach(() => {
  try {
    tmux('kill-server');
  } catch {}
});

async function open(opts = PHONE): Promise<Launched> {
  const userData = withConfig({ host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme: 'light' });
  return launchApp({ CVG_USER_DATA: userData, CVG_KNOWN_HOSTS: trustedKnownHosts(), CVG_TMUX_SOCKET: SOCK }, opts);
}
const nav = (page: Page) => page.getByRole('navigation', { name: 'Сессии' });
const item = (page: Page, name: string) => nav(page).getByRole('button', { name: new RegExp(`^${name}\\b`) });
const burger = (page: Page) => page.getByRole('button', { name: 'Открыть список сессий' });

test('после подключения открыт список сессий; выбор сессии закрывает его, ☰ открывает', async () => {
  const { app, page } = await open();
  try {
    await expect(nav(page)).toBeInViewport({ timeout: 20_000 });
    await item(page, 'cvg-test-a').tap();
    await expect(nav(page)).not.toBeInViewport();
    await expect(page.getByRole('heading', { name: 'cvg-test-a' })).toBeVisible();
    await burger(page).tap();
    await expect(nav(page)).toBeInViewport();
    await item(page, 'cvg-test-b').tap();
    await expect(page.getByRole('heading', { name: 'cvg-test-b' })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('касание уже открытой сессии в списке тоже закрывает список', async () => {
  const { app, page } = await open();
  try {
    await item(page, 'cvg-test-a').tap({ timeout: 20_000 });
    await burger(page).tap();
    await expect(nav(page)).toBeInViewport();
    await item(page, 'cvg-test-a').tap();
    await expect(nav(page)).not.toBeInViewport();
  } finally {
    await app.close();
  }
});

test('свайп от левого края открывает список, касание фона — закрывает', async () => {
  const { app, page } = await open();
  try {
    await item(page, 'cvg-test-a').tap({ timeout: 20_000 });
    await expect(nav(page)).not.toBeInViewport();
    await swipe(page, 4, 300, 220);
    await expect(nav(page)).toBeInViewport();
    await page.getByTestId('drawer-scrim').tap({ position: { x: 370, y: 400 } });
    await expect(nav(page)).not.toBeInViewport();
  } finally {
    await app.close();
  }
});

test('«⋯ → Завершить сессию» спрашивает подтверждение', async () => {
  const { app, page } = await open();
  try {
    await item(page, 'cvg-test-a').tap({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Ещё' }).tap();
    await page.getByRole('menuitem', { name: 'Завершить сессию' }).tap();
    await expect(page.getByRole('dialog', { name: 'Завершить сессию cvg-test-a?' })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('диалог «Новая сессия» — во весь экран', async () => {
  const { app, page } = await open();
  try {
    await nav(page).getByRole('button', { name: 'Новая сессия' }).tap({ timeout: 20_000 });
    const box = await page.getByRole('dialog', { name: 'Новая сессия' }).boundingBox();
    expect(box?.width).toBe(393);
    expect(box?.height).toBe(851);
  } finally {
    await app.close();
  }
});

test('на широком экране раскладка прежняя: список виден, ☰ нет', async () => {
  const { app, page } = await open({ viewport: { width: 1280, height: 800 }, mobile: false });
  try {
    await item(page, 'cvg-test-a').click({ timeout: 20_000 });
    await expect(nav(page)).toBeInViewport();
    await expect(burger(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Завершить сессию' })).toBeVisible();
  } finally {
    await app.close();
  }
});

/** Свайп касанием: от (x, y) вправо до x2 через события touch. */
async function swipe(page: Page, x: number, y: number, x2: number) {
  const cdp = await page.context().newCDPSession(page);
  const point = (px: number) => [{ x: px, y }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(x) });
  for (let px = x + 30; px <= x2; px += 30) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(px) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** «Назад» Android: в браузере — хук window.__cvg.back(); свёрнутое приложение считается в __cvg.minimized. */
const back = (page: Page) => page.evaluate(() => (window as unknown as { __cvg: { back(): void } }).__cvg.back());
const minimized = (page: Page) => page.evaluate(() => (window as unknown as { __cvg: { minimized?: number } }).__cvg.minimized ?? 0);

test('«Назад»: диалог → список сессий → свернуть; из сессии — к списку', async () => {
  const userData = withConfig({ host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme: 'light' });
  const { app, page } = await launchApp(
    { CVG_USER_DATA: userData, CVG_KNOWN_HOSTS: trustedKnownHosts(), CVG_TMUX_SOCKET: SOCK, CVG_TEST_HOOKS: '1' },
    PHONE,
  );
  try {
    await nav(page).getByRole('button', { name: 'Новая сессия' }).tap({ timeout: 20_000 });
    await expect(page.getByRole('dialog', { name: 'Новая сессия' })).toBeVisible();
    await back(page);
    await expect(page.getByRole('dialog', { name: 'Новая сессия' })).toHaveCount(0);
    expect(await minimized(page)).toBe(0);
    await back(page);
    expect(await minimized(page)).toBe(1);

    await item(page, 'cvg-test-a').tap();
    await expect(nav(page)).not.toBeInViewport();
    await back(page);
    await expect(nav(page)).toBeInViewport();
    await back(page);
    expect(await minimized(page)).toBe(2);
  } finally {
    await app.close();
  }
});
