import { fail, ok, type Result } from '../../../src/shared/ipc';
import type { Prefs, Secrets } from '../../../src/core/platform';

/** Preferences в памяти. */
export function fakePrefs(init: Record<string, string> = {}): Prefs & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
  };
}

/** Секреты в памяти. Ключ с текстом 'ENCRYPTED' требует парольную фразу 'pw'. */
export function fakeSecrets(): Secrets & { store: Partial<Record<'password' | 'key', string>>; unreadable: Set<string> } {
  const store: Partial<Record<'password' | 'key', string>> = {};
  const unreadable = new Set<string>();
  return {
    store,
    unreadable,
    save: async (name, value, passphrase): Promise<Result<{ keyType?: string }>> => {
      unreadable.delete(name);
      if (value === null || value === '') {
        delete store[name];
        return ok({});
      }
      if (name === 'key' && value === 'ENCRYPTED' && passphrase !== 'pw')
        return fail('CONFIG_INVALID', passphrase ? 'Неверная парольная фраза' : 'Ключ защищён парольной фразой');
      if (name === 'key' && value === 'garbage') return fail('CONFIG_INVALID', 'Это не закрытый ключ OpenSSH или PEM');
      store[name] = value;
      return ok(name === 'key' ? { keyType: 'ed25519' } : {});
    },
    has: async (name) => (unreadable.has(name) ? 'unreadable' : store[name] ? 'yes' : 'no'),
  };
}
