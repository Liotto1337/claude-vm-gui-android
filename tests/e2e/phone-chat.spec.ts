import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
/** Фейковый claude с журналом (как в chat.spec): лента, «menu» — карточка из трёх вариантов. */
async function openFake(viewport = PHONE.viewport): Promise<Launched> {
  const claudeDir = mkdtempSync(join(tmpdir(), 'cvg-cd-'));
  const fake = join(__dirname, '../fixtures/fake-claude.mjs');
  tmux('new-session', '-d', '-s', 'cvg-test-claude', '-x', '60', '-y', '40', `CVG_CLAUDE_DIR=${claudeDir} node ${fake}`);
  const userData = withConfig({ host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme: 'light' });
  const l = await launchApp(
    { CVG_USER_DATA: userData, CVG_KNOWN_HOSTS: trustedKnownHosts(), CVG_TMUX_SOCKET: SOCK, CVG_CLAUDE_DIR: claudeDir },
    { viewport, mobile: true },
  );
  await l.page.getByRole('navigation', { name: 'Сессии' }).getByRole('button', { name: /^cvg-test-claude/ }).tap({ timeout: 20_000 });
  await expect(feed(l.page)).toBeVisible({ timeout: 15_000 });
  return l;
}
const feed = (page: Page) => page.getByRole('region', { name: 'Переписка' });
const composer = (page: Page) => page.getByRole('textbox', { name: 'Сообщение для Claude' });
const card = (page: Page) => page.getByRole('group', { name: 'Выбор' });
const pane = () => tmux('capture-pane', '-p', '-t', '=cvg-test-cat:');
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Модель и effort' });

test('«Модель и effort» — нижний лист: модель списком, effort ползунком, свайп вниз закрывает', async () => {
  const { app, page } = await openCat();
  try {
    const btn = page.getByRole('button', { name: 'Модель и effort' });
    await btn.tap();
    await expect(sheet(page)).toBeVisible();
    await sheet(page).getByRole('menuitemradio', { name: /^Sonnet/ }).first().tap({ timeout: 30_000 });
    await expect.poll(pane).toContain('/model sonnet');
    // Effort — шкала: подписи над делениями не ниже 48 px, касание подписи сразу шлёт /effort; ползунок — как раньше
    const labels = sheet(page).locator('.effort-label');
    await expect(labels).toHaveText(['low', 'medium', 'high', 'xhigh', 'max']);
    for (const b of await Promise.all((await labels.all()).map((l) => l.boundingBox()))) expect(b!.height).toBeGreaterThanOrEqual(48);
    await sheet(page).getByRole('button', { name: 'high', exact: true }).tap();
    await expect.poll(pane).toContain('/effort high');
    await sheet(page).getByRole('slider', { name: 'Effort' }).fill('0');
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

test('отправка касанием «Отправить» — сообщение в ленте', async () => {
  const { app, page } = await openFake();
  try {
    await composer(page).tap();
    await composer(page).fill('с телефона');
    await page.getByRole('button', { name: 'Отправить' }).tap();
    await expect(feed(page).getByText('с телефона', { exact: true })).toBeVisible({ timeout: 10_000 });
  } finally {
    await app.close();
  }
});

test('карточка меню: варианты не ниже 48 px, касание отмечает, «Ответить» отправляет', async () => {
  const { app, page } = await openFake();
  try {
    await composer(page).fill('menu');
    await page.getByRole('button', { name: 'Отправить' }).tap();
    const options = card(page).getByRole('radio');
    await expect(options).toHaveCount(3, { timeout: 10_000 });
    for (const box of await Promise.all((await options.all()).map((o) => o.boundingBox()))) expect(box!.height).toBeGreaterThanOrEqual(48);
    await card(page).getByRole('radio', { name: /Да и не спрашивать/ }).tap();
    await expect(card(page).getByRole('radio', { name: /Да и не спрашивать/ })).toHaveAttribute('aria-checked', 'true', { timeout: 300 });
    await card(page).getByRole('button', { name: 'Ответить' }).tap();
    await expect(card(page)).toBeHidden({ timeout: 5000 });
    await expect(feed(page).getByText('выбран 2')).toBeVisible({ timeout: 10_000 });
  } finally {
    await app.close();
  }
});

test('подсказки / открываются и выбираются касанием', async () => {
  const { app, page } = await openFake();
  try {
    await composer(page).tap();
    await composer(page).fill('/mo');
    const option = page.getByRole('listbox', { name: 'Подсказки' }).getByRole('option', { name: /^\/model/ });
    await option.tap({ timeout: 30_000 });
    await expect(composer(page)).toHaveValue('/model ');
  } finally {
    await app.close();
  }
});

test('маленький экран с клавиатурой (360×640 → 360×360): все варианты меню достижимы, поле ввода видно', async () => {
  const { app, page } = await openFake({ width: 360, height: 640 });
  try {
    await composer(page).fill('menu');
    await page.getByRole('button', { name: 'Отправить' }).tap();
    await expect(card(page).getByRole('radio')).toHaveCount(3, { timeout: 10_000 });
    // Экранная клавиатура забирает низ окна (Keyboard resize: native)
    await page.setViewportSize({ width: 360, height: 360 });
    // Терминал спрятан под лентой — его размер не меняется, меню Claude Code не перерисовывается в несколько строк
    await page.waitForTimeout(1500);
    await expect(card(page).getByRole('radio')).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      const o = card(page).getByRole('radio').nth(i);
      await o.scrollIntoViewIfNeeded();
      await expect(o).toBeInViewport({ ratio: 1 });
    }
    const box = (await composer(page).boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(360);
  } finally {
    await app.close();
  }
});

test('📎 — системный выбор файла (галерея, камера, файлы), картинка уходит путём на ВМ', async () => {
  const { app, page } = await openCat();
  try {
    const input = page.locator('.composer input[type="file"]');
    // Без accept и capture — системный выбор любых файлов (галерея и камера в нём остаются)
    expect(await input.getAttribute('accept')).toBeNull();
    expect(await input.getAttribute('capture')).toBeNull();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    await input.setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByText('photo.png')).toBeVisible();
    await page.getByRole('textbox', { name: 'Сообщение для Claude' }).fill('фото');
    await page.getByRole('button', { name: 'Отправить' }).tap();
    // Окно tmux узкое (по телефону) — путь переносится, строки склеиваются
    const flat = () => pane().replace(/\n/g, '');
    await expect.poll(flat, { timeout: 15_000 }).toMatch(/фото \/\S+\/\.cache\/claude-vm-gui\/uploads\/\S+?\.png/);
    const path = /(\/[^\s~]+\/\.cache\/claude-vm-gui\/uploads\/\S+?\.png)/.exec(flat())![1];
    execFileSync('rm', ['-f', path]);
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
