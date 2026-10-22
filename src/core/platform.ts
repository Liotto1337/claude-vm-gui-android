import type { Result } from '@shared/ipc';
import type { ConnectableTransport } from './transport';

/** Небольшое хранилище настроек (Capacitor Preferences на Android, localStorage в браузере). */
export interface Prefs {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

/** Пароль и закрытый ключ: хранятся на стороне платформы и в JS не возвращаются. */
export interface Secrets {
  /** value null или '' — удалить. Для ключа возвращает его тип; ключ с фразой без неё — CONFIG_INVALID */
  save(name: 'password' | 'key', value: string | null, passphrase?: string): Promise<Result<{ keyType?: string }>>;
  has(name: 'password' | 'key'): Promise<'yes' | 'no' | 'unreadable'>;
}

/** Всё, что приложению нужно от устройства. */
export interface Platform {
  ssh: ConnectableTransport;
  prefs: Prefs;
  secrets: Secrets;
  clipboard: { read(): Promise<string>; write(text: string): Promise<void> };
  openExternal(url: string): Promise<void>;
  /** Кнопка «Назад» (Android) */
  onBack?(cb: () => void): () => void;
  /** Свернуть приложение (Android) */
  minimize?(): void;
  /** Приложение на экране или свёрнуто (Android: WebView в фоне остаётся «visible», document об этом не узнаёт) */
  onVisibility?(cb: (visible: boolean) => void): () => void;
  /** Работа в фоне (Android): foreground-сервис, уведомления о сессиях, переход по уведомлению */
  background?: {
    set(o: { keepAlive: boolean; notifications: boolean; tmux: string; sessions: number }): void;
    onOpenSession(cb: (name: string) => void): () => void;
    /** Сессию открыли в приложении — снять её уведомление */
    sessionOpened(name: string): void;
    /** Разрешение на уведомления (Android 13+): true — можно */
    requestNotifications(): Promise<boolean>;
  };
}
