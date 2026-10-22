// Протокол dev-моста: браузер ↔ Node-сервер (bridge/server.ts) по WebSocket, JSON, байты — base64.
import type { ConnectionState, HostKeyPrompt, PreflightEvent, Result, VmConfig } from '@shared/ipc';

export type BridgeRequest =
  | { op: 'connect'; cfg: VmConfig }
  | { op: 'disconnect' }
  | { op: 'exec'; cmd: string; stdin?: string; timeoutMs?: number }
  | { op: 'stream'; cmd: string }
  | { op: 'pty'; cmd: string; cols: number; rows: number }
  | { op: 'write'; ch: number; data: string }
  | { op: 'end'; ch: number }
  | { op: 'close'; ch: number }
  | { op: 'resize'; ch: number; rows: number; cols: number }
  | { op: 'writeFile'; path: string; b64: string }
  | { op: 'answerHostKey'; trust: boolean }
  | { op: 'forgetHostKey'; host: string; port: number }
  | { op: 'tcp'; host: string; port: number }
  | { op: 'secrets.save'; name: 'password' | 'key'; value: string | null; passphrase?: string }
  | { op: 'secrets.has'; name: 'password' | 'key' }
  /** Только для E2E: обрыв SSH, как при потере сети */
  | { op: '__drop' };

export type BridgeResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { code: string; message: string } };

export type BridgeEvent =
  | { ev: 'state'; state: ConnectionState }
  | { ev: 'lost' }
  | { ev: 'reconnected' }
  | { ev: 'hostkey'; prompt: HostKeyPrompt }
  | { ev: 'preflight'; event: PreflightEvent }
  /** Пачки канала нумеруются с 0 подряд */
  | { ev: 'data' | 'stderr'; ch: number; seq: number; b64: string }
  | { ev: 'close'; ch: number }
  /** Прогресс writeFile: id — номер запроса */
  | { ev: 'progress'; id: number; sent: number };

export type ConnectResult = Result<void>;
