import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyScreen } from '../../src/shared/screen-parse';

// Экраны настоящего Claude Code 2.1.307 шириной 45 колонок — как в терминале телефона (tmux сужает окно под клиента)
const screen = (name: string) => classifyScreen(readFileSync(`tests/fixtures/screens/narrow-${name}.ans`, 'utf8'));

describe('экран Claude Code в узком окне телефона', () => {
  it('пустое поле ввода', () => expect(screen('prompt-empty')).toMatchObject({ kind: 'prompt', input: '' }));
  it('поле с текстом', () => expect(screen('prompt-text')).toMatchObject({ kind: 'prompt', input: 'привет из узкого окна' }));
  it('работает — статус есть', () => {
    const s = screen('busy');
    expect(s.kind).toBe('prompt');
    expect(s.kind === 'prompt' && s.status).toBeTruthy();
  });
  it('запрос Bash: четыре варианта, перенесённые строки склеены', () => {
    const s = screen('permission-bash');
    expect(s.kind).toBe('menu');
    if (s.kind !== 'menu') return;
    expect(s.menu.options.map((o) => o.n)).toEqual([1, 2, 3, 4]);
    expect(s.menu.options[1].label).toBe('Yes, allow reading from /tmp from this project');
    expect(s.menu.options[3].label).toBe('No');
    expect(s.menu.context).toContain('ls -la /tmp');
  });
  it('доверие папке: два варианта', () => {
    const s = screen('trust');
    expect(s.kind).toBe('menu');
    if (s.kind === 'menu') expect(s.menu.options.map((o) => o.label)).toEqual(['No, exit', 'Yes, I trust this folder']);
  });
});
