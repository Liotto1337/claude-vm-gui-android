import { timingSafeEqual } from 'node:crypto';

/**
 * Пускать ли подключение к dev-мосту. Без этой проверки любая страница в браузере разработчика
 * (для WebSocket CORS не действует) выполняла бы команды на ВМ через мост. Нужны страница с 127.0.0.1
 * или localhost и случайный токен моста в адресе (?token=…).
 */
export function bridgeAllowed(origin: string | undefined, url: string | undefined, token: string): boolean {
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  if (host !== '127.0.0.1' && host !== 'localhost') return false;
  const got = new URL(url ?? '/', 'ws://bridge').searchParams.get('token') ?? '';
  const a = Buffer.from(got);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
