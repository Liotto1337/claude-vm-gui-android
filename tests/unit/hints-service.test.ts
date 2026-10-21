import { describe, expect, it } from 'vitest';
import { HintsService } from '../../src/core/hints';
import type { SshTransport } from '../../src/core/transport';

describe('HintsService.get', () => {
  it('claude ищется и в ~/.local/bin: туда его ставит установщик, а PATH из .bashrc в bash -lc не попадает', async () => {
    const cmds: string[] = [];
    const conn = { connected: true, on: () => () => {}, exec: async (c: string) => (cmds.push(c), { code: 0, stdout: '', stderr: '' }) };
    await new HintsService(conn as unknown as SshTransport).get('~');
    expect(cmds[0]).toContain('PATH="$HOME/.local/bin:$PATH"');
  });
});
