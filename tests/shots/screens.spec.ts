import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, TEST_KEY, trustedKnownHosts, withConfig } from '../e2e/helpers';

const OUT = join(__dirname, '../../docs/screenshots');
const SOCK = 'cvg-shots';
const tmux = (...a: string[]) => execFileSync('tmux', ['-L', SOCK, ...a], { stdio: ['ignore', 'pipe', 'ignore'] });
const PHONE = { viewport: { width: 393, height: 851 }, mobile: true };

test('скриншоты для README', async () => {
  const claudeDir = mkdtempSync(join(tmpdir(), 'cvg-cd-'));
  const seed = join(claudeDir, 'seed.jsonl');
  writeFileSync(seed, readFileSync(join(__dirname, '../fixtures/transcript.jsonl'), 'utf8'));
  const fake = join(__dirname, '../fixtures/fake-claude.mjs');
  try {
    tmux('kill-server');
  } catch {}
  tmux('new-session', '-d', '-s', 'web-app', '-x', '60', '-y', '40', `CVG_CLAUDE_DIR=${claudeDir} CVG_FAKE_SEED=${seed} node ${fake}`);
  tmux('new-session', '-d', '-s', 'api', '-x', '60', '-y', '40', `CVG_CLAUDE_DIR=${claudeDir} node ${fake}`);
  tmux('new-session', '-d', '-s', 'notes');
  const shot = (page: Page, name: string) => page.screenshot({ path: join(OUT, name) });
  for (const theme of ['light', 'dark'] as const) {
    const userData = withConfig({ host: '127.0.0.1', port: 22, username: 'root', keyPath: TEST_KEY, theme });
    const { app, page } = await launchApp(
      { CVG_USER_DATA: userData, CVG_KNOWN_HOSTS: trustedKnownHosts(), CVG_TMUX_SOCKET: SOCK, CVG_CLAUDE_DIR: claudeDir, CVG_DEMO_HOST: '203.0.113.10' },
      PHONE,
    );
    try {
      const nav = page.getByRole('navigation', { name: 'Сессии' });
      await expect(nav.getByRole('button', { name: /^web-app/ })).toBeInViewport({ timeout: 20_000 });
      if (theme === 'light') await shot(page, '01-sessions.png');
      await nav.getByRole('button', { name: /^web-app/ }).tap();
      await expect(page.getByRole('region', { name: 'Переписка' }).getByText('Сейчас посмотрю.')).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(800);
      await shot(page, theme === 'light' ? '02-chat.png' : '05-chat-dark.png');
      if (theme === 'dark') continue;
      await page.getByRole('textbox', { name: 'Сообщение для Claude' }).fill('menu');
      await page.getByRole('button', { name: 'Отправить' }).tap();
      await expect(page.getByRole('group', { name: 'Выбор' })).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(500);
      await shot(page, '03-menu.png');
      await page.getByRole('group', { name: 'Выбор' }).getByRole('option', { name: /Нет/ }).tap();
      await page.getByRole('button', { name: 'Открыть список сессий' }).tap();
      await nav.getByRole('button', { name: 'Сервер' }).tap();
      await expect(page.getByRole('dialog', { name: 'Сервер' }).getByText('Ядро')).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(5000);
      await shot(page, '04-server.png');
      await page.getByRole('dialog', { name: 'Сервер' }).getByRole('button', { name: 'Назад' }).tap();
      // «Сервер» открывали из списка — он так и остался открытым
      if (!(await nav.isVisible()) || !(await nav.getByRole('button', { name: /^notes/ }).isVisible())) await page.getByRole('button', { name: 'Открыть список сессий' }).tap();
      await nav.getByRole('button', { name: /^notes/ }).tap();
      await expect(page.getByRole('toolbar', { name: 'Клавиши терминала' })).toBeVisible();
      await page.locator('.xterm').tap();
      await page.keyboard.type('ls ~\r');
      await page.waitForTimeout(1500);
      await shot(page, '06-terminal.png');
    } finally {
      await app.close();
    }
  }
  tmux('kill-server');
});
