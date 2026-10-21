import { describe, expect, it } from 'vitest';
import type { PreflightEvent, VmConfig } from '../../src/shared/ipc';
import { checkTcp, runPreflight } from '../../bridge/preflight';

const cfg = (port: number): VmConfig => ({ host: '127.0.0.1', port, username: 'root', theme: 'system', keepAlive: true, notifications: true });

describe('checkTcp', () => {
  it('открытый порт 22', async () => expect((await checkTcp('127.0.0.1', 22)).ok).toBe(true));
  it('закрытый порт', async () => expect((await checkTcp('127.0.0.1', 1)).ok).toBe(false));
  it('недоступный адрес — по таймауту', async () => {
    const t = Date.now();
    const r = await checkTcp('203.0.113.10', 22, 1000);
    expect(r.ok).toBe(false);
    expect(Date.now() - t).toBeLessThan(1500);
  });
});

describe('runPreflight', () => {
  it('TCP не прошёл — SSH и tmux пропущены', async () => {
    const events: PreflightEvent[] = [];
    const r = await runPreflight(cfg(1), (e) => events.push(e));
    expect(r.ok).toBe(false);
    expect(events.map((e) => `${e.step}:${e.status}`)).toEqual([
      'tcp:running', 'tcp:fail', 'ssh:skipped', 'tmux:skipped',
    ]);
    expect(events[1].detail).toBe('Не удалось соединиться за 5 с. Проверьте интернет и что ВМ включена');
  });

  it('всё доступно', async () => {
    const r = await runPreflight(cfg(22), () => {});
    expect(r.ok).toBe(true);
  });
});
