import { execFileSync } from 'node:child_process';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { hasTestKey, launchApp, TEST_KEY, trustedKnownHosts, withConfig, type Launched } from './helpers';

// Список сессий на телефоне: долгое нажатие — меню нижним листом, перенос касанием
let SOCK = '';
const tmux = (...args: string[]) => execFileSync('tmux', ['-L', SOCK, ...args], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
const NAMES = ['cvg-test-a', 'cvg-test-b', 'cvg-test-c'];
const PHONE = { viewport: { width: 393, height: 851 }, mobile: true };

test.skip(!hasTestKey, 'нет тестового ключа');
let userData = '';
test.beforeEach(() => {
  SOCK = `cvg-test-pss-${Math.random().toString(16).slice(2, 8)}`;
  for (const n of NAMES) tmux('new-session', '-d', '-s', n);
  userData = withConfig({ host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme: 'light' });
});
test.afterEach(() => {
  try {
    tmux('kill-server');
  } catch {}
});

async function open(): Promise<Launched> {
  const l = await launchApp({ CVG_USER_DATA: userData, CVG_KNOWN_HOSTS: trustedKnownHosts(), CVG_TMUX_SOCKET: SOCK }, PHONE);
  await expect(item(l.page, NAMES[0])).toBeVisible({ timeout: 20_000 });
  return l;
}
const nav = (page: Page) => page.getByRole('navigation', { name: 'Сессии' });
const item = (page: Page, name: string) => nav(page).getByRole('button', { name: new RegExp(`^${name}\\b`) });
const sheet = (page: Page, name: string) => page.getByRole('dialog', { name });

/** Долгое нажатие пальцем: касание и удержание 700 мс. */
export async function hold(page: Page, target: Locator, at?: { x: number; y: number }) {
  const b = (await target.boundingBox())!;
  const p = at ?? { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
  await page.waitForTimeout(700);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('долгое нажатие на сессию — меню листом, подменю и «‹ Назад»', async () => {
  const { app, page } = await open();
  try {
    await hold(page, item(page, 'cvg-test-b'));
    const s = sheet(page, 'Действия с сессией cvg-test-b');
    await expect(s).toBeVisible();
    await expect(s.getByRole('menuitem', { name: 'Закрепить' })).toBeVisible();
    await s.getByRole('menuitem', { name: 'Переместить в группу' }).tap();
    await expect(s.getByRole('menuitem', { name: 'Новая группа…' })).toBeVisible();
    await s.getByRole('menuitem', { name: 'Назад' }).tap();
    await s.getByRole('menuitem', { name: 'Закрепить' }).tap();
    await expect(s).toHaveCount(0);
    await expect(nav(page).locator('.session-name:visible').first()).toHaveText('cvg-test-b');
  } finally {
    await app.close();
  }
});

test('долгое нажатие на пустое место списка — «Новая сессия…» и «Новая группа…»', async () => {
  const { app, page } = await open();
  try {
    const list = nav(page).getByRole('group', { name: /^Список сессий/ });
    const b = (await list.boundingBox())!;
    await hold(page, list, { x: b.x + b.width / 2, y: b.y + b.height - 20 });
    const s = sheet(page, 'Список сессий');
    await expect(s.getByRole('menuitem', { name: 'Новая сессия…' })).toBeVisible();
    await expect(s.getByRole('menuitem', { name: 'Новая группа…' })).toBeVisible();
  } finally {
    await app.close();
  }
});

/** Перенос пальцем: касание ручки и ведение до точки (to — центр/верх строки-цели). */
async function dragTouch(page: Page, handle: Locator, to: { x: number; y: number }) {
  const h = (await handle.boundingBox())!;
  const from = { x: h.x + h.width / 2, y: h.y + h.height / 2 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  const steps = 8;
  for (let i = 1; i <= steps; i++)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }] });
  await page.waitForTimeout(100);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const order = (page: Page) => nav(page).locator('.session-name:visible').allTextContents();

test('перенос ручкой ⋮⋮: третья сессия — на место первой, порядок переживает перезапуск', async () => {
  let l = await open();
  try {
    const target = (await item(l.page, 'cvg-test-a').boundingBox())!;
    await dragTouch(l.page, item(l.page, 'cvg-test-c').locator('xpath=..').getByRole('button', { name: 'Перенести' }), { x: target.x + 40, y: target.y + 6 });
    await expect.poll(() => order(l.page)).toEqual(['cvg-test-c', 'cvg-test-a', 'cvg-test-b']);
  } finally {
    await l.app.close();
  }
  l = await open();
  try {
    await expect.poll(() => order(l.page)).toEqual(['cvg-test-c', 'cvg-test-a', 'cvg-test-b']);
  } finally {
    await l.app.close();
  }
});
