import { fail, ok, type KeyImport, type Result, type VmConfig } from '@shared/ipc';
import type { Prefs, Secrets } from './platform';

const DEFAULTS: Omit<VmConfig, 'host'> = { port: 22, username: 'root', theme: 'system', keepAlive: true, notifications: true };
const KEY = 'config';

/** Как лежит в Preferences: без признаков секретов, плюс тип импортированного ключа. */
type StoredConfig = Omit<VmConfig, 'hasPassword' | 'passwordUnreadable' | 'hasKey' | 'keyType'> & { keyType?: string };

async function readStored(prefs: Prefs): Promise<Partial<StoredConfig> | null> {
  try {
    const raw = await prefs.get(KEY);
    return raw ? (JSON.parse(raw) as Partial<StoredConfig>) : null;
  } catch {
    return null;
  }
}

/**
 * Настройки подключения. Пароль и ключ сюда не попадают — только признаки hasPassword
 * (или passwordUnreadable, если не расшифровался) и hasKey с типом ключа.
 */
export async function loadConfig(prefs: Prefs, secrets: Secrets): Promise<VmConfig | null> {
  const raw = await readStored(prefs);
  if (!raw || typeof raw.host !== 'string' || raw.host.trim() === '') return null;
  const { keyType, ...rest } = raw;
  const cfg: VmConfig = { ...DEFAULTS, ...rest, host: raw.host.trim() };
  for (const k of ['hasPassword', 'passwordUnreadable', 'hasKey', 'keyType'] as const) delete cfg[k];
  const pwd = await secrets.has('password');
  if (pwd === 'yes') cfg.hasPassword = true;
  else if (pwd === 'unreadable') cfg.passwordUnreadable = true;
  if ((await secrets.has('key')) === 'yes') {
    cfg.hasKey = true;
    if (keyType) cfg.keyType = keyType;
  }
  return cfg;
}

export function validateConfig(c: VmConfig, hasSecret: boolean): string | null {
  if (typeof c.host !== 'string' || c.host.trim() === '' || /\s/.test(c.host.trim())) return 'Укажите адрес ВМ без пробелов';
  if (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535) return 'Порт — число от 1 до 65535';
  if (!/^[a-z_][a-z0-9_-]*$/.test(c.username)) return 'Имя пользователя: латиница в нижнем регистре, цифры, _ и -';
  if (!hasSecret) return 'Импортируйте SSH-ключ или задайте пароль';
  if (!['system', 'light', 'dark'].includes(c.theme)) return 'Неизвестная тема';
  return null;
}

/**
 * Сохраняет настройки. password и key: undefined — не трогать, null (или '' для пароля) — удалить, значение — сохранить.
 * Сначала проверка и ключ (он может не прочитаться), и только потом пароль и настройки — неудача ничего не меняет.
 */
export async function saveConfig(
  prefs: Prefs,
  secrets: Secrets,
  c: VmConfig,
  password?: string | null,
  key?: KeyImport | null,
): Promise<Result<void>> {
  const willHavePassword = password === undefined ? (await secrets.has('password')) === 'yes' : !!password;
  const willHaveKey = key === undefined ? (await secrets.has('key')) === 'yes' : key !== null;
  const err = validateConfig(c, willHavePassword || willHaveKey);
  if (err) return fail('CONFIG_INVALID', err);

  const prev = await readStored(prefs);
  let keyType = prev?.keyType;
  if (key === null) {
    await secrets.save('key', null);
    keyType = undefined;
  } else if (key) {
    const r = await secrets.save('key', key.text, key.passphrase);
    if (!r.ok) return r;
    keyType = r.data.keyType;
  }
  if (password !== undefined) {
    const r = await secrets.save('password', password || null);
    if (!r.ok) return r;
  }
  const { hasPassword: _p, passwordUnreadable: _u, hasKey: _h, keyType: _t, ...rest } = c;
  const stored: StoredConfig = { ...rest, host: c.host.trim(), ...(keyType ? { keyType } : {}) };
  await prefs.set(KEY, JSON.stringify(stored));
  return ok(undefined);
}
