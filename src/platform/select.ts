import { knobs } from '@core/knobs';
import type { Platform } from '@core/platform';

/**
 * Платформа по месту запуска. В сборке APK (mode android) dev-мост не импортируется вовсе.
 * В браузере: ?bridge=ws://… — адрес моста, ?knobs={json} — тестовые настройки, ?testHooks=1 — хуки E2E.
 */
export async function selectPlatform(): Promise<Platform> {
  if (import.meta.env.MODE === 'android') {
    const { androidPlatform } = await import('./android');
    return androidPlatform();
  }
  const q = new URLSearchParams(location.search);
  const k = q.get('knobs');
  if (k) Object.assign(knobs, JSON.parse(k));
  const { devPlatform } = await import('./dev');
  return devPlatform(q.get('bridge') ?? 'ws://127.0.0.1:8790', { testHooks: q.get('testHooks') === '1' });
}
