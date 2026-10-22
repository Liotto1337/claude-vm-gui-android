import { defineConfig } from '@playwright/test';

// Дымовой тест настоящего APK на эмуляторе (scripts/smoke-android.sh готовит эмулятор, APK и сессию)
export default defineConfig({
  testDir: 'tests/smoke',
  timeout: 300_000,
  workers: 1,
  reporter: [['list']],
});
