import { describe, expect, it } from 'vitest';
import { loadConfig, saveConfig, validateConfig } from '../../src/core/config';
import type { VmConfig } from '../../src/shared/ipc';
import { fakePrefs, fakeSecrets } from './fakes/platform';

const cfg: VmConfig = { host: '10.0.0.5', port: 22, username: 'root', theme: 'system', keepAlive: true, notifications: true };

describe('loadConfig', () => {
  it('нет конфига — null', async () => expect(await loadConfig(fakePrefs(), fakeSecrets())).toBeNull());

  it('битый JSON — null, без падения', async () =>
    expect(await loadConfig(fakePrefs({ config: '{oops' }), fakeSecrets())).toBeNull());

  it('значения по умолчанию: связь в фоне и уведомления включены', async () => {
    expect(await loadConfig(fakePrefs({ config: JSON.stringify({ host: ' h ' }) }), fakeSecrets())).toEqual({
      host: 'h', port: 22, username: 'root', theme: 'system', keepAlive: true, notifications: true,
    });
  });

  it('сохранённый пароль — hasPassword, не расшифровался — passwordUnreadable', async () => {
    const prefs = fakePrefs({ config: JSON.stringify({ host: 'h' }) });
    const s = fakeSecrets();
    s.store.password = 'x';
    expect(await loadConfig(prefs, s)).toMatchObject({ hasPassword: true });
    s.unreadable.add('password');
    const c = await loadConfig(prefs, s);
    expect(c?.passwordUnreadable).toBe(true);
    expect(c?.hasPassword).toBeUndefined();
  });

  it('импортированный ключ — hasKey и его тип', async () => {
    const prefs = fakePrefs({ config: JSON.stringify({ host: 'h', keyType: 'ed25519' }) });
    const s = fakeSecrets();
    s.store.key = 'KEY';
    expect(await loadConfig(prefs, s)).toMatchObject({ hasKey: true, keyType: 'ed25519' });
    delete s.store.key;
    const c = await loadConfig(prefs, s);
    expect(c?.hasKey).toBeUndefined();
    expect(c?.keyType).toBeUndefined();
  });
});

describe('validateConfig', () => {
  it('ни ключа, ни пароля — просьба импортировать ключ', () =>
    expect(validateConfig(cfg, false)).toBe('Импортируйте SSH-ключ или задайте пароль'));
  it('есть ключ или пароль — ок', () => expect(validateConfig(cfg, true)).toBeNull());
  it('адрес с пробелом', () => expect(validateConfig({ ...cfg, host: 'a b' }, true)).toBe('Укажите адрес ВМ без пробелов'));
});

describe('saveConfig', () => {
  it('ключ уходит в секреты, в настройках — только его тип', async () => {
    const prefs = fakePrefs();
    const s = fakeSecrets();
    expect(await saveConfig(prefs, s, cfg, undefined, { text: 'KEY' })).toEqual({ ok: true, data: undefined });
    expect(s.store.key).toBe('KEY');
    const stored = prefs.data.get('config')!;
    expect(JSON.parse(stored)).toMatchObject({ host: '10.0.0.5', keyType: 'ed25519' });
    expect(stored).not.toContain('KEY');
  });

  it('ключ с парольной фразой без неё — ошибка, ничего не сохранено', async () => {
    const prefs = fakePrefs();
    const s = fakeSecrets();
    const r = await saveConfig(prefs, s, cfg, 'secret', { text: 'ENCRYPTED' });
    expect(r).toEqual({ ok: false, error: { code: 'CONFIG_INVALID', message: 'Ключ защищён парольной фразой' } });
    expect(prefs.data.has('config')).toBe(false);
    expect(s.store.password).toBeUndefined();
  });

  it('ключ с верной фразой сохраняется', async () => {
    const s = fakeSecrets();
    expect((await saveConfig(fakePrefs(), s, cfg, undefined, { text: 'ENCRYPTED', passphrase: 'pw' })).ok).toBe(true);
    expect(s.store.key).toBe('ENCRYPTED');
  });

  it('пароль: строка — сохранить, undefined — не трогать, null и пустая строка — удалить', async () => {
    const prefs = fakePrefs();
    const s = fakeSecrets();
    await saveConfig(prefs, s, cfg, 'secret');
    expect(s.store.password).toBe('secret');
    await saveConfig(prefs, s, cfg, undefined);
    expect(s.store.password).toBe('secret');
    s.store.key = 'KEY';
    await saveConfig(prefs, s, cfg, '');
    expect(s.store.password).toBeUndefined();
    await saveConfig(prefs, s, cfg, 'again');
    await saveConfig(prefs, s, cfg, null);
    expect(s.store.password).toBeUndefined();
  });

  it('пароль в настройки не попадает', async () => {
    const prefs = fakePrefs();
    await saveConfig(prefs, fakeSecrets(), cfg, 'secret');
    expect(prefs.data.get('config')).not.toContain('secret');
  });

  it('удалить ключ без пароля нельзя', async () => {
    const s = fakeSecrets();
    s.store.key = 'KEY';
    const r = await saveConfig(fakePrefs(), s, cfg, undefined, null);
    expect(r).toEqual({ ok: false, error: { code: 'CONFIG_INVALID', message: 'Импортируйте SSH-ключ или задайте пароль' } });
    expect(s.store.key).toBe('KEY');
  });

  it('признаки из интерфейса (hasPassword, hasKey) в настройки не пишутся', async () => {
    const prefs = fakePrefs();
    await saveConfig(prefs, fakeSecrets(), { ...cfg, hasPassword: true, hasKey: true, passwordUnreadable: true }, 'p');
    expect(Object.keys(JSON.parse(prefs.data.get('config')!))).not.toContain('hasPassword');
    expect(Object.keys(JSON.parse(prefs.data.get('config')!))).not.toContain('hasKey');
  });
});
