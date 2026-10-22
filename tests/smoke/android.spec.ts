import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { _android, expect, test, type AndroidDevice, type Page } from '@playwright/test';

// Настоящий APK на эмуляторе (scripts/smoke-android.sh): настройки → подключение к ВМ (10.0.2.2) → ключ хоста →
// лента фейкового claude → поворот → свернуть → меню в claude → уведомление «ждёт ответа» → его намерение открывает сессию
const PKG = 'io.github.liotto1337.claudevm';
const SESSION = 'cvg-smoke-claude';
const tmux = (...args: string[]) => execFileSync('tmux', ['-L', 'cvg-smoke', ...args]);

async function appPage(device: AndroidDevice): Promise<Page> {
  const wv = await device.webView({ pkg: PKG }, { timeout: 120_000 });
  return wv.page();
}

/**
 * Действие со страницей приложения. Первый запуск после установки система может пересоздать Activity
 * (оверлей темы) — тогда WebView закрывается посреди действия: берём новую страницу и повторяем.
 */
async function withPage<T>(device: AndroidDevice, fn: (page: Page) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const page = await appPage(device);
    try {
      return await fn(page);
    } catch (e) {
      if (attempt >= 4 || !/closed|detached|destroyed/i.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

/** Текст всех уведомлений в шторке. */
const notifications = async (device: AndroidDevice) => (await device.shell('dumpsys notification --noredact')).toString();

/**
 * «Касание» уведомления о сессии: то же намерение, что в его PendingIntent (Notifications.openApp) —
 * шторку эмулятора без окна uiautomator раскрывает ненадёжно, а уведомления приложения Android группирует.
 */
const openFromNotification = (device: AndroidDevice, session: string) =>
  device.shell(`am start -n ${PKG}/.MainActivity -f 0x24000000 --es session ${session}`);

test('APK: подключение, лента, поворот, уведомление «ждёт ответа» и переход по нему', async () => {
  const [device] = await _android.devices();
  expect(device, 'эмулятор не найден').toBeTruthy();
  try {
    await device.shell(`am start -n ${PKG}/.MainActivity`);
    // Тестовые настройки: свой сервер tmux и каталог журналов фейкового claude
    const knobs = { tmuxSocket: 'cvg-smoke', claudeDir: process.env.CVG_SMOKE_CLAUDE_DIR };
    await withPage(device, async (p) => {
      // Первый запуск после pm clear на нагруженной ВМ бывает долгим
      await p.getByLabel('Адрес ВМ').waitFor({ timeout: 240_000 });
      await p.evaluate((k) => localStorage.setItem('cvg-knobs', k), JSON.stringify(knobs));
      await p.reload();
      await p.getByLabel('Адрес ВМ').waitFor({ timeout: 60_000 });
    });
    let page = await appPage(device);

    await page.getByLabel('Адрес ВМ').fill('10.0.2.2', { timeout: 60_000 });
    await page.getByLabel('SSH-ключ (закрытый, OpenSSH или PEM)').fill(readFileSync(join(homedir(), '.ssh', 'cvg_test_ed25519'), 'utf8'));
    await page.getByRole('button', { name: 'Сохранить и подключиться' }).click();
    // Первый запуск: система может пересоздать Activity посреди подключения — новый интерфейс спросит ключ заново
    await withPage(device, (p) => p.getByRole('dialog', { name: 'Новый сервер' }).getByRole('button', { name: 'Доверять' }).click({ timeout: 120_000 }));
    page = await appPage(device);

    await page.getByRole('navigation', { name: 'Сессии' }).getByRole('button', { name: new RegExp(`^${SESSION}`) }).click({ timeout: 90_000 });
    const feed = page.getByRole('region', { name: 'Переписка' });
    await expect(feed).toBeVisible({ timeout: 60_000 });
    const composer = page.getByRole('textbox', { name: 'Сообщение для Claude' });
    await composer.fill('привет с эмулятора');
    await page.getByRole('button', { name: 'Отправить' }).click();
    await expect(feed.getByText('привет с эмулятора', { exact: true })).toBeVisible({ timeout: 30_000 });

    // Поворот: связь и сессия на месте (Review Focus 1)
    await device.shell('settings put system user_rotation 1');
    await new Promise((r) => setTimeout(r, 6000));
    page = await appPage(device);
    await expect(page.getByRole('heading', { name: SESSION })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Связь потеряна')).toHaveCount(0);
    await device.shell('settings put system user_rotation 0');
    await new Promise((r) => setTimeout(r, 4000));

    // Свернуть; первая выборка опроса молчит — потом меню в claude
    await device.shell('input keyevent KEYCODE_HOME');
    await new Promise((r) => setTimeout(r, 8000));
    tmux('send-keys', '-t', `=${SESSION}:`, '-l', 'menu');
    tmux('send-keys', '-t', `=${SESSION}:`, 'Enter');
    await expect.poll(() => notifications(device), { timeout: 30_000, intervals: [2000] }).toContain(`android.title=String (${SESSION}: Claude ждёт ответа)`);
    expect(await notifications(device)).toContain('android.text=String (Выбор)');

    await openFromNotification(device, SESSION);
    page = await appPage(device);
    await expect(page.getByRole('heading', { name: SESSION })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('group', { name: 'Выбор' })).toBeVisible({ timeout: 30_000 });
    // Сессию открыли — её уведомление снято
    await expect.poll(() => notifications(device), { timeout: 20_000, intervals: [2000] }).not.toContain('ждёт ответа');
  } finally {
    await device?.close();
  }
});
