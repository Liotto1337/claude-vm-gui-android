import { useState } from 'react';
import type { PreflightEvent, PreflightStep } from '@shared/ipc';
import { connect, displayHost, openSettings, useAppState } from '../state';
import { api } from '../api';
import { IconCheck, IconCross, IconSpinner, IconWarn } from './icons';
import { ConfirmDialog } from './ConfirmDialog';
import { Logo } from './Logo';

function StepIcon({ e }: { e?: PreflightEvent }) {
  if (!e || e.status === 'running') return e ? <IconSpinner /> : <span className="step-dash" aria-hidden="true" />;
  if (e.status === 'ok') return <IconCheck label="Готово" />;
  if (e.status === 'warn') return <IconWarn />;
  if (e.status === 'fail') return <IconCross />;
  return <span className="step-dash" aria-label="Пропущено">—</span>;
}

export function ConnectScreen() {
  const { config, preflight, connectError } = useAppState();
  // Ключ сервера сменился: забыть сохранённый — только с явным предупреждением о подмене
  const [forget, setForget] = useState(false);
  const port = config?.port ?? 22;
  const steps: { step: PreflightStep; label: string }[] = [
    { step: 'tcp', label: `TCP, порт ${port}` },
    { step: 'ssh', label: 'SSH' },
    { step: 'tmux', label: 'Сессии tmux' },
  ];
  // Ошибка без шага (например, ключ хоста) показывается на шаге SSH
  const sshFailText = connectError && !preflight.ssh?.detail && preflight.tcp?.status === 'ok' ? connectError.message : null;

  return (
    <div className="connect-screen">
      <div className="connect-title">
        <Logo size={30} />
        <h1>Подключение к ВМ</h1>
      </div>
      <section className="card connect-card" aria-label="Подключение">
        <div className="field-caption">
          <span className="caption">Сервер</span>
          <span className="mono">{config ? `${config.username}@${displayHost(config.host)}:${port}` : ''}</span>
        </div>
        <ol className="steps">
          {steps.map(({ step, label }) => {
            const e = preflight[step];
            const detail = step === 'ssh' && sshFailText ? sshFailText : e?.detail;
            return (
              <li key={step} className={e?.status === 'skipped' ? 'step skipped' : 'step'}>
                <StepIcon e={step === 'ssh' && sshFailText ? { step, status: 'fail', detail: sshFailText } : e} />
                <div className="step-text">
                  <span>{label}</span>
                  {detail ? <span className="step-detail">{detail}</span> : null}
                </div>
              </li>
            );
          })}
        </ol>
        {connectError ? (
          <div className="row gap-8">
            <button type="button" className="btn btn-dark" onClick={() => void connect()}>Повторить</button>
            {connectError.code === 'HOSTKEY_MISMATCH' ? (
              <button type="button" className="btn" onClick={() => setForget(true)}>Забыть ключ сервера</button>
            ) : null}
            <button type="button" className="btn" onClick={openSettings}>Настройки подключения</button>
          </div>
        ) : (
          <div className="row">
            <button type="button" className="btn" onClick={() => { void api.connection.disconnect(); openSettings(); }}>Отмена</button>
          </div>
        )}
      </section>
      {forget ? (
        <ConfirmDialog
          title="Забыть ключ сервера?"
          text="Ключ сервера отличается от сохранённого. Так бывает после переустановки ВМ, но так же выглядит и подмена сервера. Забывайте ключ, только если знаете, что его меняли, и сверьте новый отпечаток с выводом ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub на ВМ."
          confirmLabel="Забыть и подключиться"
          onCancel={() => setForget(false)}
          onConfirm={() => {
            setForget(false);
            void api.connection.forgetHostKey().then(() => connect());
          }}
        />
      ) : null}
    </div>
  );
}
