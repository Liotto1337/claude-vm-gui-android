import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { hasTestKey, launchApp, TEST_KEY, trustedKnownHosts, withConfig, type Launched } from './helpers';

// Терминал на телефоне: сессия без claude (bash) на отдельном сервере tmux
let SOCK = '';
const tmux = (...args: string[]) => execFileSync('tmux', ['-L', SOCK, ...args], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
const PHONE = { viewport: { width: 393, height: 851 }, mobile: true };

test.skip(!hasTestKey, 'нет тестового ключа');

test.beforeEach(() => {
  SOCK = `cvg-test-pt-${Math.random().toString(16).slice(2, 8)}`;
  tmux('new-session', '-d', '-s', 'cvg-test-t', '-x', '60', '-y', '30');
});
test.afterEach(() => {
  try {
    tmux('kill-server');
  } catch {}
});

async function open(): Promise<Launched> {
  const userData = withConfig({ host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme: 'light' });
  const l = await launchApp({ CVG_USER_DATA: userData, CVG_KNOWN_HOSTS: trustedKnownHosts(), CVG_TMUX_SOCKET: SOCK }, PHONE);
  await l.page.getByRole('navigation', { name: 'Сессии' }).getByRole('button', { name: /^cvg-test-t/ }).tap({ timeout: 20_000 });
  await expect(l.page.locator('.xterm')).toBeVisible();
  return l;
}
const keys = (page: Page) => page.getByRole('toolbar', { name: 'Клавиши терминала' });
const command = () => tmux('display', '-p', '-t', '=cvg-test-t:', '#{pane_current_command}').trim();
const pane = () => tmux('capture-pane', '-p', '-t', '=cvg-test-t:');

test('строка клавиш: Ctrl залипает на одну клавишу, Ctrl+C прерывает команду', async () => {
  const { app, page } = await open();
  try {
    await page.locator('.xterm').tap();
    await page.keyboard.type('sleep 100\r');
    await expect.poll(command).toBe('sleep');
    const ctrl = keys(page).getByRole('button', { name: 'Ctrl' });
    await ctrl.tap();
    await expect(ctrl).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.type('c');
    await expect.poll(command).toBe('bash');
    await expect(ctrl).toHaveAttribute('aria-pressed', 'false');
    // Без Ctrl «c» — обычная буква
    await page.keyboard.type('echo c-ok\r');
    await expect.poll(pane).toContain('c-ok');
  } finally {
    await app.close();
  }
});

test('↑ — предыдущая команда, Esc и Tab уходят в терминал', async () => {
  const { app, page } = await open();
  try {
    await page.locator('.xterm').tap();
    await page.keyboard.type('echo first-cmd\r');
    await expect.poll(pane).toContain('first-cmd');
    await keys(page).getByRole('button', { name: 'Вверх' }).tap();
    await keys(page).getByRole('button', { name: 'Enter' }).tap();
    await expect.poll(() => pane().split('first-cmd').length - 1).toBe(4);
    // Tab дополняет имя: ech → echo
    await page.keyboard.type('ech');
    await keys(page).getByRole('button', { name: 'Tab' }).tap();
    await page.keyboard.type(' tab-ok\r');
    await expect.poll(pane).toContain('\ntab-ok');
  } finally {
    await app.close();
  }
});

test('нажатие на строку клавиш не уводит фокус из терминала', async () => {
  const { app, page } = await open();
  try {
    await page.locator('.xterm').tap();
    await keys(page).getByRole('button', { name: '/' }).tap();
    await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
    await page.keyboard.type('tmp\r');
    await expect.poll(pane).toContain('/tmp');
  } finally {
    await app.close();
  }
});

test('на широком экране строки клавиш нет', async () => {
  const userData = withConfig({ host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme: 'light' });
  const { app, page } = await launchApp({ CVG_USER_DATA: userData, CVG_KNOWN_HOSTS: trustedKnownHosts(), CVG_TMUX_SOCKET: SOCK });
  try {
    await page.getByRole('navigation', { name: 'Сессии' }).getByRole('button', { name: /^cvg-test-t/ }).click({ timeout: 20_000 });
    await expect(page.locator('.xterm')).toBeVisible();
    await expect(keys(page)).toHaveCount(0);
  } finally {
    await app.close();
  }
});
