import { useCallback, useEffect, useState } from 'react';
import { useAppState } from '../state';
import { viewMode } from '../view-mode';
import { Banner } from './Banner';
import { ChatView } from './ChatView';
import { Composer } from './Composer';
import { UpdateBanner } from './UpdateBanner';
import { NewSessionDialog } from './NewSessionDialog';
import { SessionHeader } from './SessionHeader';
import { ServerPanel } from './ServerPanel';
import { Sidebar } from './Sidebar';
import { TerminalView } from './TerminalView';
import { Drawer } from './Drawer';
import { usePhone } from '../use-phone';
import { useBackContext } from '../back-stack';
import { api } from '../api';
import { setServerOpen } from '../state';

export function MainView() {
  const { sessions, current, chat, viewOverride, serverOpen, picked } = useAppState();
  // Диалог новой сессии; group — сразу положить её в эту группу
  const [newSession, setNewSession] = useState<{ group?: string } | null>(null);
  const session = sessions.find((s) => s.name === current) ?? null;
  const c = session ? chat[session.name] : undefined;
  // Пока claude работает — лента; терминал — без claude, на незнакомом экране или по выбору
  const mode = session
    ? viewMode({ claudeRunning: session.claudeRunning, screen: c?.screen ?? null, unavailable: !!c?.unavailable, override: viewOverride })
    : 'terminal';
  const menu = mode === 'chat' && c?.screen?.kind === 'menu' ? c.screen.menu : null;
  // Телефон: список сессий — выдвижная панель; открыта, пока сессия не выбрана, выбор её закрывает
  const phone = usePhone();
  const [drawerOpen, setDrawerOpen] = useState(!current);
  useEffect(() => setDrawerOpen(!current), [current, picked]);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => current && setDrawerOpen(false), [current]);
  useBackContext({
    serverOpen,
    closeServer: () => setServerOpen(false),
    drawerOpen: !phone || drawerOpen,
    openDrawer,
    exit: () => api.platform.minimize(),
  });
  const sidebar = <Sidebar onNewSession={(group) => setNewSession({ group })} />;

  return (
    <div className="main-layout">
      {phone ? (
        <Drawer open={drawerOpen} onOpen={openDrawer} onClose={closeDrawer}>
          {sidebar}
        </Drawer>
      ) : (
        sidebar
      )}
      <main className="main-column">
        <UpdateBanner />
        <Banner />
        {session ? (
          <>
            <SessionHeader session={session} mode={mode} onMenu={phone ? openDrawer : undefined} />
            {session.claudeRunning && c?.unavailable ? (
              <div className="banner" role="status">Не удалось прочитать переписку — показан терминал</div>
            ) : null}
            <div className="view-stack">
              <TerminalView key={session.name} name={session.name} hidden={mode === 'chat'} />
              {mode === 'chat' ? <ChatView session={session.name} /> : null}
            </div>
            <Composer key={`c-${session.name}`} session={session} menu={menu} working={!!c?.busy} chatMode={mode === 'chat'} />
          </>
        ) : current ? (
          <>
            <div className="session-header" />
            <TerminalView key={current} name={current} />
          </>
        ) : (
          <div className="empty-state">Выберите сессию слева или создайте новую</div>
        )}
      </main>
      {serverOpen ? <ServerPanel /> : null}
      {newSession ? <NewSessionDialog group={newSession.group} onClose={() => setNewSession(null)} /> : null}
    </div>
  );
}
