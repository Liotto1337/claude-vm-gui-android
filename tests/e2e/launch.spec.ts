import { expect, test } from '@playwright/test';
import { launchApp } from './helpers';

test('страница открывается, window.api работает без подключения', async () => {
  const { app, page } = await launchApp();
  try {
    await expect(page).toHaveTitle('Claude VM');
    expect(await page.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined');
    const api = await page.evaluate(async () => {
      const w = globalThis as unknown as { api: { platform: { theme(): Promise<string> }; tmux: { list(): Promise<{ ok: boolean; error?: { code: string } }> } } };
      return { theme: await w.api.platform.theme(), tmux: await w.api.tmux.list() };
    });
    expect(['light', 'dark']).toContain(api.theme);
    expect(api.tmux).toMatchObject({ ok: false, error: { code: 'NOT_CONNECTED' } });
  } finally {
    await app.close();
  }
});
