import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { hasTestKey, launchApp, TEST_KEY, trustedKnownHosts, withConfig } from './helpers';

const PHONE = { viewport: { width: 393, height: 851 }, mobile: true };
let SOCK = '';

test.skip(!hasTestKey, 'нет тестового ключа');
test.beforeEach(() => {
  SOCK = `cvg-test-ps-${Math.random().toString(16).slice(2, 8)}`;
  execFileSync('tmux', ['-L', SOCK, 'new-session', '-d', '-s', 'cvg-test-srv']);
});
test.afterEach(() => {
  try {
    execFileSync('tmux', ['-L', SOCK, 'kill-server']);
  } catch {}
});

const panel = (page: Page) => page.getByRole('dialog', { name: 'Сервер' });

test('«Сервер» на телефоне — во весь экран, блоки в одну колонку, «Назад» закрывает', async () => {
  const userData = withConfig({ host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme: 'light' });
  const { app, page } = await launchApp({ CVG_USER_DATA: userData, CVG_KNOWN_HOSTS: trustedKnownHosts(), CVG_TMUX_SOCKET: SOCK, CVG_TEST_HOOKS: '1' }, PHONE);
  try {
    const nav = page.getByRole('navigation', { name: 'Сессии' });
    await nav.getByRole('button', { name: 'Сервер' }).tap({ timeout: 20_000 });
    await expect(panel(page)).toBeVisible();
    const box = (await panel(page).boundingBox())!;
    expect([box.x, box.width]).toEqual([0, 393]);
    // Сведения о системе — пары «название: значение» в одну колонку
    await expect(panel(page).getByText('Ядро')).toBeVisible({ timeout: 15_000 });
    const cols = await panel(page).locator('.server-facts').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(cols).toBe(2);
    await panel(page).getByRole('button', { name: 'Назад' }).tap();
    await expect(panel(page)).toBeHidden();

    // Кнопка «Назад» Android тоже закрывает
    await nav.getByRole('button', { name: 'Сервер' }).tap();
    await expect(panel(page)).toBeVisible();
    await page.evaluate(() => (window as unknown as { __cvg: { back(): void } }).__cvg.back());
    await expect(panel(page)).toBeHidden();
  } finally {
    await app.close();
  }
});
