import { useState } from 'react';
import type { TmuxSession } from '@shared/ipc';
import { killSession, setViewOverride, shortPath } from '../state';
import { useBack } from '../back-stack';
import { ConfirmDialog } from './ConfirmDialog';
import { ContextBadge } from './ContextBadge';
import { IconClose, IconMenu, IconMore } from './icons';
import { UsageLine } from './UsageBox';

/**
 * mode — что сейчас показано; переключатель «Лента | Терминал» — только когда запущен claude.
 * onMenu — телефон: слева ☰ (список сессий), «Завершить сессию» — в меню «⋯».
 */
export function SessionHeader({ session, mode = 'terminal', onMenu }: { session: TmuxSession; mode?: 'chat' | 'terminal'; onMenu?: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [more, setMore] = useState(false);
  useBack(more, () => setMore(false));
  const what = session.claudeRunning ? 'в сессии запущен claude' : `в сессии ${session.command || 'shell'}`;
  const phone = !!onMenu;
  return (
    <header className="session-header">
      {phone ? (
        <button type="button" className="icon-btn" aria-label="Открыть список сессий" onClick={onMenu}>
          <IconMenu />
        </button>
      ) : null}
      <div className="session-title">
        <h1 className="ellipsis">{session.name}</h1>
        <span className="caption ellipsis">
          {shortPath(session.cwd)}
          {phone ? <UsageLine /> : ` · ${what}`}
        </span>
      </div>
      {session.claudeRunning ? <ContextBadge key={session.name} session={session} phone={phone} /> : null}
      {session.claudeRunning ? (
        <div role="group" aria-label="Вид" className="seg">
          <button type="button" aria-pressed={mode === 'chat'} onClick={() => setViewOverride(null)}>Лента</button>
          <button type="button" aria-pressed={mode === 'terminal'} onClick={() => setViewOverride('terminal')}>Терминал</button>
        </div>
      ) : null}
      {phone ? (
        <div className="more-wrap">
          <button type="button" className="icon-btn" aria-label="Ещё" aria-haspopup="menu" aria-expanded={more} onClick={() => setMore(!more)}>
            <IconMore />
          </button>
          {more ? (
            <>
              <div className="menu-scrim" onClick={() => setMore(false)} />
              <ul role="menu" className="popup more-menu">
                <li
                  role="menuitem"
                  tabIndex={-1}
                  className="popup-item danger-item"
                  onClick={() => {
                    setMore(false);
                    setConfirm(true);
                  }}
                >
                  Завершить сессию
                </li>
              </ul>
            </>
          ) : null}
        </div>
      ) : (
        <button type="button" className="btn btn-sm btn-kill" onClick={() => setConfirm(true)}>
          <IconClose />
          Завершить сессию
        </button>
      )}
      {confirm ? (
        <ConfirmDialog
          title={`Завершить сессию ${session.name}?`}
          text="tmux kill-session остановит claude и всё, что запущено в этой сессии."
          confirmLabel="Завершить"
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            void killSession(session.name);
          }}
        />
      ) : null}
    </header>
  );
}
