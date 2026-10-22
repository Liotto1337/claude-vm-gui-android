import { knobs } from '@core/knobs';
import type { Platform } from '@core/platform';

/**
 * Платформа по месту запуска. В сборке APK (mode android) dev-мост не импортируется вовсе.
 * В браузере: ?bridge=ws://… — адрес моста, ?knobs={json} — тестовые настройки, ?testHooks=1 — хуки E2E.
 * В APK для дымового теста (VITE_TEST_KNOBS=1) — knobs из localStorage['cvg-knobs'].
 */
export async function selectPlatform(): Promise<Platform> {
  if (import.meta.env.MODE === 'android') {
    // Только сборка для дымового теста (VITE_TEST_KNOBS=1): тестовые настройки из localStorage
    if (import.meta.env.VITE_TEST_KNOBS === '1') {
      try {
        Object.assign(knobs, JSON.parse(localStorage.getItem('cvg-knobs') ?? '{}'));
      } catch {
        // нет или битые — без тестовых настроек
      }
    }
    const { androidPlatform } = await import('./android-native');
    return androidPlatform();
  }
  const q = new URLSearchParams(location.search);
  const k = q.get('knobs');
  if (k) Object.assign(knobs, JSON.parse(k));
  const { devPlatform } = await import('./dev');
  return devPlatform(q.get('bridge') ?? 'ws://127.0.0.1:8790', { testHooks: q.get('testHooks') === '1' });
}
