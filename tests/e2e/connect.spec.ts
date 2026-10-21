import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { launchApp, withConfig, tempKnownHostsPath, trustedKnownHosts, TEST_KEY, hasTestKey } from './helpers';

test('без настроек открывается окно «Настройки подключения»', async () => {
  const { app, page } = await launchApp();
  try {
    await expect(page.getByRole('dialog', { name: 'Настройки подключения' })).toBeVisible();
    await expect(page.getByLabel('Адрес ВМ')).toHaveValue('');
    await expect(page.getByLabel('Порт')).toHaveValue('22');
    await expect(page.getByLabel('Пользователь')).toHaveValue('root');
  } finally {
    await app.close();
  }
});

test('ошибки проверки показываются под полями, тема меняется сразу', async () => {
  const { app, page } = await launchApp();
  try {
    const dialog = page.getByRole('dialog', { name: 'Настройки подключения' });
    await page.getByLabel('Адрес ВМ').fill('a b');
    await dialog.getByRole('button', { name: 'Сохранить и подключиться' }).click();
    await expect(dialog.getByText('Укажите адрес ВМ без пробелов')).toBeVisible();
    await page.getByLabel('Тема').selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByLabel('Тема').selectOption('light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  } finally {
    await app.close();
  }
});

test('закрытый порт: TCP — ошибка, SSH пропущен, есть «Повторить» и «Настройки»', async () => {
  const { app, page } = await launchApp();
  try {
    await page.getByLabel('Адрес ВМ').fill('127.0.0.1');
    await page.getByLabel('Порт').fill('1');
    await page.getByLabel('Пароль (необязательно)').fill('x');
    await page.getByRole('button', { name: 'Сохранить и подключиться' }).click();
    await expect(page.getByRole('heading', { name: 'Подключение к ВМ' })).toBeVisible();
    await expect(page.getByText('Не удалось соединиться за 5 с. Проверьте интернет и что ВМ включена')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('TCP, порт 1')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Повторить' })).toBeVisible();
    await page.getByRole('button', { name: 'Настройки подключения' }).click();
    await expect(page.getByRole('dialog', { name: 'Настройки подключения' })).toBeVisible();
    await expect(page.getByLabel('Порт')).toHaveValue('1');
  } finally {
    await app.close();
  }
});

test('неизвестный ключ сервера: показывает отпечаток, после «Доверять» открывается главное окно', async () => {
  test.skip(!hasTestKey, 'нет тестового ключа');
  const userData = withConfig({ host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme: 'light' });
  const { app, page } = await launchApp({ CVG_USER_DATA: userData, CVG_KNOWN_HOSTS: tempKnownHostsPath() });
  try {
    const dialog = page.getByRole('dialog', { name: 'Новый сервер' });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByText(/SHA256:[A-Za-z0-9+/]{43}/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Доверять' }).click();
    await expect(page.getByRole('navigation', { name: 'Сессии' })).toBeVisible({ timeout: 20_000 });
  } finally {
    await app.close();
  }
});

test('отказ доверять ключу — ошибка на шаге SSH', async () => {
  test.skip(!hasTestKey, 'нет тестового ключа');
  const userData = withConfig({ host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme: 'light' });
  const { app, page } = await launchApp({ CVG_USER_DATA: userData, CVG_KNOWN_HOSTS: tempKnownHostsPath() });
  try {
    await page.getByRole('dialog', { name: 'Новый сервер' }).getByRole('button', { name: 'Отмена' }).click();
    await expect(page.getByText('Ключ сервера не принят')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Повторить' })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('без ключа и пароля — просьба импортировать ключ', async () => {
  const { app, page } = await launchApp();
  try {
    await page.getByLabel('Адрес ВМ').fill('127.0.0.1');
    await page.getByRole('button', { name: 'Сохранить и подключиться' }).click();
    await expect(page.getByText('Импортируйте SSH-ключ или задайте пароль')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('ключ импортируется текстом и показывается как импортированный; в настройках его нет', async () => {
  test.skip(!hasTestKey, 'нет тестового ключа');
  const { app, page } = await launchApp({ CVG_KNOWN_HOSTS: trustedKnownHosts() });
  try {
    await page.getByLabel('Адрес ВМ').fill('127.0.0.1');
    await page.getByLabel('SSH-ключ (закрытый, OpenSSH или PEM)').fill(readFileSync(TEST_KEY, 'utf8'));
    await page.getByRole('button', { name: 'Сохранить и подключиться' }).click();
    await expect(page.getByRole('navigation', { name: 'Сессии' })).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => localStorage.getItem('cvg:config'))).not.toContain('PRIVATE KEY');
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem('cvg:config')))!)).toMatchObject({ keyType: 'ed25519' });
    await page.getByRole('button', { name: 'Настройки подключения' }).click();
    await expect(page.getByRole('dialog', { name: 'Настройки подключения' }).getByText('Импортирован (ed25519)')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('мусор вместо ключа — понятная ошибка', async () => {
  const { app, page } = await launchApp();
  try {
    await page.getByLabel('Адрес ВМ').fill('127.0.0.1');
    await page.getByLabel('SSH-ключ (закрытый, OpenSSH или PEM)').fill('не ключ');
    await page.getByRole('button', { name: 'Сохранить и подключиться' }).click();
    await expect(page.getByText('Это не закрытый ключ OpenSSH или PEM')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('пароль сохраняется и показывается как сохранённый, в настройках его нет', async () => {
  const { app, page } = await launchApp();
  try {
    await page.getByLabel('Адрес ВМ').fill('127.0.0.1');
    await page.getByLabel('Порт').fill('1');
    await page.getByLabel('Пароль (необязательно)').fill('секрет-e2e');
    await page.getByRole('button', { name: 'Сохранить и подключиться' }).click();
    await expect(page.getByRole('heading', { name: 'Подключение к ВМ' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('cvg:config'))).not.toContain('секрет-e2e');
    await page.getByRole('button', { name: 'Настройки подключения' }).click();
    const dialog = page.getByRole('dialog', { name: 'Настройки подключения' });
    await expect(dialog.getByText('Пароль сохранён')).toBeVisible();
    await dialog.getByRole('button', { name: 'Удалить пароль' }).click();
    await expect(dialog.getByLabel('Пароль (необязательно)')).toHaveValue('');
  } finally {
    await app.close();
  }
});
