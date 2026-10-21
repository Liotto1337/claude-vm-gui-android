import type { ConnectionState } from '@shared/ipc';

export interface ExecResult { code: number; stdout: string; stderr: string }

/** Канал SSH (exec с PTY или без): то, что сервисам нужно от ClientChannel ssh2. */
export interface Channel {
  on(e: 'data', cb: (d: Uint8Array) => void): void;
  on(e: 'close' | 'error', cb: () => void): void;
  stderr: { on(e: 'data', cb: (d: Uint8Array) => void): void };
  write(data: string): void;
  end(): void;
  close(): void;
  /** Только для PTY */
  setWindow(rows: number, cols: number): void;
}

/**
 * SSH-соединение с ВМ, как его видят сервисы. Реализации: Android-плагин и Node (ssh2) в dev-мосте.
 * События: `state`, `lost` (неожиданный обрыв), `reconnected` (связь восстановлена сама).
 */
export interface SshTransport {
  readonly connected: boolean;
  exec(cmd: string, opts?: { stdin?: string; timeoutMs?: number }): Promise<ExecResult>;
  /** Долгая команда без PTY: вывод читается по мере появления */
  stream(cmd: string): Promise<Channel>;
  openPty(cmd: string, cols: number, rows: number): Promise<Channel>;
  /** Запись файла по SFTP с правами 0600; onProgress — сколько байт отправлено */
  writeFile(path: string, bytes: Uint8Array, onProgress: (sent: number) => void): Promise<void>;
  on(e: 'state', cb: (s: ConnectionState) => void): () => void;
  on(e: 'lost' | 'reconnected', cb: () => void): () => void;
}
