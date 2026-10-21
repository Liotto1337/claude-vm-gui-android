import type { KeyImport } from '@shared/ipc';

/** Режим поля пароля в настройках: 'saved' — сохранён и не меняется, 'edit' — вводится новый, 'deleted' — удалить. */
export type PasswordMode = 'saved' | 'edit' | 'deleted';

/**
 * Что сохранить вместо пароля: undefined — не трогать, null — удалить, строка — новый.
 * Нерасшифрованный пароль (другая учётная запись Windows) с пустым полем удаляется: войти им всё равно нельзя,
 * а оставшись, он навсегда держал бы предупреждение и считался бы заменой ключа.
 */
export function passwordToSave(mode: PasswordMode, password: string, unreadable: boolean): string | null | undefined {
  if (mode === 'saved') return undefined;
  if (password !== '') return password;
  return mode === 'deleted' || unreadable ? null : undefined;
}

/** Что сделать с SSH-ключом: undefined — не трогать, null — удалить, объект — импортировать. Пустое поле ключ не трогает. */
export function keyToSave(mode: PasswordMode, text: string, passphrase: string): KeyImport | null | undefined {
  if (mode === 'saved') return undefined;
  if (mode === 'deleted') return null;
  if (text.trim() === '') return undefined;
  return passphrase ? { text, passphrase } : { text };
}
