import { describe, expect, it } from 'vitest';
import { Terminal } from '@xterm/headless';
import { muteDeviceAttributes } from '../../src/renderer/terminal-reports';

/** Что терминал отправил бы «с клавиатуры» в ответ на вывод. */
async function replies(out: string, mute: boolean): Promise<string> {
  const term = new Terminal({ allowProposedApi: true });
  if (mute) muteDeviceAttributes(term);
  let sent = '';
  term.onData((d) => (sent += d));
  await new Promise<void>((r) => term.write(out, r));
  term.dispose();
  return sent;
}

describe('ответы терминала на запросы DA', () => {
  it('без заглушки xterm отвечает на DA2 — ответ, пришедший tmux поздно, попадает в оболочку как ввод', async () =>
    expect(await replies('\x1b[>c', false)).toMatch(/^\x1b\[>\d+;\d+;\d+c$/));
  it('DA2 (ESC [ > c) — без ответа', async () => expect(await replies('\x1b[>c', true)).toBe(''));
  it('DA1 (ESC [ c) — без ответа', async () => expect(await replies('\x1b[c', true)).toBe(''));
  it('остальные запросы (позиция курсора) работают', async () => expect(await replies('\x1b[6n', true)).toBe('\x1b[1;1R'));
});
