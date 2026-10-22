import { expect, test } from '@playwright/test';
import { launchApp } from './helpers';

test('настройки: «Держать связь в фоне» и «Уведомления» сохраняются в конфиге', async () => {
  const { app, page } = await launchApp();
  try {
    const keep = page.getByRole('checkbox', { name: 'Держать связь в фоне' });
    const notify = page.getByRole('checkbox', { name: 'Уведомления' });
    // По умолчанию оба включены
    await expect(keep).toBeChecked();
    await expect(notify).toBeChecked();
    await page.getByLabel('Адрес ВМ').fill('127.0.0.1');
    await page.getByLabel('Порт').fill('1');
    await page.getByLabel('Пароль (необязательно)').fill('x');
    await keep.uncheck();
    await notify.uncheck();
    await page.getByRole('button', { name: 'Сохранить и подключиться' }).click();
    await expect(page.getByRole('heading', { name: 'Подключение к ВМ' })).toBeVisible();
    const cfg = JSON.parse((await page.evaluate(() => localStorage.getItem('cvg:config')))!);
    expect(cfg).toMatchObject({ keepAlive: false, notifications: false });
    await page.getByRole('button', { name: 'Настройки подключения' }).click();
    await expect(keep).not.toBeChecked();
    await expect(notify).not.toBeChecked();
  } finally {
    await app.close();
  }
});
