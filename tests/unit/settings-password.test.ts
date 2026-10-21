import { describe, expect, it } from 'vitest';
import { keyToSave, passwordToSave } from '../../src/renderer/settings-password';

// undefined — не трогать сохранённый пароль, null — удалить, строка — сохранить новый
describe('passwordToSave', () => {
  it('сохранён и не меняется — не трогать', () => expect(passwordToSave('saved', '', false)).toBeUndefined());
  it('новый пароль — сохранить', () => expect(passwordToSave('edit', 'pw', false)).toBe('pw'));
  it('поле пустое — не трогать (нечего менять)', () => expect(passwordToSave('edit', '', false)).toBeUndefined());
  it('«Удалить пароль» — удалить', () => expect(passwordToSave('deleted', '', false)).toBeNull());
  it('нерасшифрованный и поле пустое — удалить: им всё равно не войти', () => expect(passwordToSave('edit', '', true)).toBeNull());
  it('нерасшифрованный и введён новый — сохранить новый', () => expect(passwordToSave('edit', 'pw', true)).toBe('pw'));
});

describe('keyToSave', () => {
  it('сохранённый ключ не трогается', () => expect(keyToSave('saved', 'x', '')).toBeUndefined());
  it('удалить — null', () => expect(keyToSave('deleted', '', '')).toBeNull());
  it('пустое поле — не трогать', () => expect(keyToSave('edit', '  \n', '')).toBeUndefined());
  it('текст ключа без фразы', () => expect(keyToSave('edit', 'KEY\n', '')).toEqual({ text: 'KEY\n' }));
  it('текст ключа с фразой', () => expect(keyToSave('edit', 'KEY', 'pw')).toEqual({ text: 'KEY', passphrase: 'pw' }));
});
