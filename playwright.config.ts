import { defineConfig } from '@playwright/test';

// Интерфейс — собранный dist/ через vite preview; SSH — dev-мост, который запускает каждый тест (tests/e2e/helpers.ts)
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  webServer: { command: 'npx vite preview --port 4173 --strictPort --host 127.0.0.1', url: 'http://127.0.0.1:4173/', reuseExistingServer: true },
});
