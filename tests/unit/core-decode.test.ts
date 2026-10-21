import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { SshTransport } from '../../src/core/transport';
import { TerminalService } from '../../src/core/terminal';
import type { TmuxService } from '../../src/core/tmux';

// Байты из SSH приходят пачками как попало: многобайтовый символ может оказаться разрезан между пачками
describe('TerminalService: UTF-8 на границе пачек', () => {
  it('«ё» и эмодзи, разрезанные по байтам, собираются без «�»', async () => {
    const stream = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), write: () => {}, setWindow: () => {}, close: () => {} });
    const conn = Object.assign(new EventEmitter(), { connected: true, openPty: async () => stream });
    const term = new TerminalService(conn as unknown as SshTransport, {} as TmuxService);
    let text = '';
    term.on('data', (d: string) => (text += d));
    expect((await term.open('s', 80, 24)).ok).toBe(true);
    const bytes = new TextEncoder().encode('ё😀');
    for (const b of bytes) stream.emit('data', new Uint8Array([b]));
    expect(text).toBe('ё😀');
  });
});
