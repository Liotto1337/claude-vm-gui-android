import { defineConfig } from '@playwright/test';

// Скриншоты для README (npm run screenshots): экран телефона, демо-адрес, фейковый claude с демо-перепиской
export default defineConfig({
  testDir: 'tests/shots',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  webServer: { command: 'npx vite preview --port 4173 --strictPort --host 127.0.0.1', url: 'http://127.0.0.1:4173/', reuseExistingServer: true },
});
