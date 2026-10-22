import { expect, test, type BrowserContext } from '@playwright/test';
import { hasTestKey, launchApp, TEST_KEY, trustedKnownHosts, withConfig } from './helpers';
import pkg from '../../package.json' with { type: 'json' };

// Ответ GitHub подменяется перехватом запроса (CSP пускает только api.github.com)
test.skip(!hasTestKey, 'нет тестового ключа');

const RELEASE = 'https://github.com/Liotto1337/claude-vm-gui-android/releases/tag/v9.9.9';
const route = (context: BrowserContext, tag: string, url: string) =>
  context.route('https://api.github.com/repos/Liotto1337/claude-vm-gui-android/releases/latest', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ tag_name: tag, html_url: url }) }),
  );

async function open(userData: string, tag: string, url: string) {
  const l = await launchApp({ CVG_USER_DATA: userData, CVG_KNOWN_HOSTS: trustedKnownHosts(), CVG_TEST_HOOKS: '1' });
  await route(l.context, tag, url);
  await l.page.reload();
  await expect(l.page.getByRole('navigation', { name: 'Сессии' })).toBeVisible({ timeout: 20_000 });
  return l;
}

test('баннер «Доступно обновление»: ссылка на релиз, крестик скрывает эту версию', async () => {
  const userData = withConfig({ host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme: 'light' });
  let l = await open(userData, 'v9.9.9', RELEASE);
  try {
    const banner = l.page.getByRole('status').filter({ hasText: 'Доступно обновление 9.9.9' });
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await banner.getByRole('button', { name: /Доступно обновление/ }).click();
    await expect.poll(() => l.page.evaluate(() => (globalThis as unknown as { __cvg: { lastLink?: string } }).__cvg.lastLink)).toBe(RELEASE);
    await banner.getByRole('button', { name: 'Закрыть' }).click();
    await expect(banner).toBeHidden();
  } finally {
    await l.app.close();
  }
  l = await open(userData, 'v9.9.9', RELEASE);
  try {
    await l.page.waitForTimeout(7000);
    await expect(l.page.getByText('Доступно обновление')).toHaveCount(0);
  } finally {
    await l.app.close();
  }
});

test('последняя версия уже стоит — баннера нет', async () => {
  const userData = withConfig({ host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme: 'light' });
  const l = await open(userData, `v${pkg.version}`, `https://github.com/Liotto1337/claude-vm-gui-android/releases/tag/v${pkg.version}`);
  try {
    await l.page.waitForTimeout(7000);
    await expect(l.page.getByText('Доступно обновление')).toHaveCount(0);
  } finally {
    await l.app.close();
  }
});
