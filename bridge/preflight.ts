import { connect } from 'node:net';
import type { PreflightEvent, VmConfig } from '@shared/ipc';

const TEXT = {
  tcpFail: 'Не удалось соединиться за 5 с. Проверьте интернет и что ВМ включена',
  skipped: 'Пропущено',
};

export function checkTcp(host: string, port: number, timeoutMs = 5000): Promise<{ ok: boolean; ms: number | null; error?: string }> {
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (ok: boolean, error?: string) => {
      socket.destroy();
      resolve({ ok, ms: ok ? Date.now() - started : null, error });
    };
    socket.setTimeout(timeoutMs, () => done(false, 'timeout'));
    socket.once('connect', () => done(true));
    socket.once('error', (e) => done(false, e.message));
  });
}

/** TCP до SSH (ping на Android без root ненадёжен — убран). При неудаче TCP шаги SSH и tmux пропускаются. */
export async function runPreflight(
  cfg: VmConfig,
  emit: (e: PreflightEvent) => void,
  opts: { tcpTimeoutMs?: number } = {},
): Promise<{ ok: boolean }> {
  emit({ step: 'tcp', status: 'running', detail: '' });
  const tcp = await checkTcp(cfg.host, cfg.port, opts.tcpTimeoutMs);
  if (!tcp.ok) {
    emit({ step: 'tcp', status: 'fail', detail: TEXT.tcpFail });
    emit({ step: 'ssh', status: 'skipped', detail: TEXT.skipped });
    emit({ step: 'tmux', status: 'skipped', detail: TEXT.skipped });
    return { ok: false };
  }
  emit({ step: 'tcp', status: 'ok', detail: `Порт открыт, соединение за ${tcp.ms} мс` });
  return { ok: true };
}
