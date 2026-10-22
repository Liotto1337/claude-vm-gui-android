import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { hasTestKey, launchApp, TEST_KEY, trustedKnownHosts, withConfig, type Launched } from './helpers';

// Телефон: поле ввода, лист «Модель и effort», лента. Сессии — на отдельном сервере tmux
let SOCK = '';
const tmux = (...args: string[]) => execFileSync('tmux', ['-L', SOCK, ...args], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
const PHONE = { viewport: { width: 393, height: 851 }, mobile: true };

test.skip(!hasTestKey, 'нет тестового ключа');

test.beforeEach(() => {
  SOCK = `cvg-test-pc-${Math.random().toString(16).slice(2, 8)}`;
});
test.afterEach(() => {
  try {
    tmux('kill-server');
  } catch {}
});

/** Сессия, где «claude» — это cat: всё, что ушло в терминал, видно на экране панели. */
async function openCat(): Promise<Launched> {
  tmux('new-session', '-d', '-s', 'cvg-test-cat', '-x', '100', '-y', '30', 'cat');
  const userData = withConfig({ host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme: 'light' });
  const l = await launchApp({ CVG_USER_DATA: userData, CVG_KNOWN_HOSTS: trustedKnownHosts(), CVG_TMUX_SOCKET: SOCK, CVG_FAKE_CLAUDE: '1' }, PHONE);
  await l.page.getByRole('navigation', { name: 'Сессии' }).getByRole('button', { name: /^cvg-test-cat/ }).tap({ timeout: 20_000 });
  await expect(l.page.getByRole('heading', { name: 'cvg-test-cat' })).toBeVisible();
  return l;
}
const pane = () => tmux('capture-pane', '-p', '-t', '=cvg-test-cat:');
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Модель и effort' });

test('«Модель и effort» — нижний лист: выбор уходит в claude, свайп вниз закрывает', async () => {
  const { app, page } = await openCat();
  try {
    const btn = page.getByRole('button', { name: 'Модель и effort' });
    await btn.tap();
    await expect(sheet(page)).toBeVisible();
    await sheet(page).getByRole('menuitemradio', { name: /^Sonnet/ }).first().tap({ timeout: 30_000 });
    await expect.poll(pane).toContain('/model sonnet');
    await sheet(page).getByRole('menuitemradio', { name: 'low' }).tap();
    await expect.poll(pane).toContain('/effort low');
    await expect(btn).toContainText('Sonnet');
    await expect(btn).toContainText('low');
    const box = (await sheet(page).boundingBox())!;
    await swipe(page, box.x + box.width / 2, box.y + 12, box.y + 250);
    await expect(sheet(page)).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('на телефоне нет отдельных меню «Модель» и «Effort» и подсказки про Ctrl+V', async () => {
  const { app, page } = await openCat();
  try {
    await expect(page.getByRole('button', { name: 'Модель и effort' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Effort/ })).toHaveCount(0);
    await expect(page.getByText('Ctrl+V или перетаскивание')).toBeHidden();
  } finally {
    await app.close();
  }
});

/** Свайп касанием по вертикали: из (x, y) до y2. */
async function swipe(page: Page, x: number, y: number, y2: number) {
  const cdp = await page.context().newCDPSession(page);
  const at = (py: number) => [{ x, y: py }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(y) });
  for (let py = y + 30; py <= y2; py += 30) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(py) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
