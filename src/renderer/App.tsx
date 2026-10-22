import { useEffect } from 'react';
import { ConnectScreen } from './components/ConnectScreen';
import { HostKeyDialog } from './components/HostKeyDialog';
import { MainView } from './components/MainView';
import { SettingsDialog } from './components/SettingsDialog';
import { api } from './api';
import { backPressed } from './back-stack';
import { init, openFromNotification, useAppState } from './state';

export function App() {
  const { view, hostKey } = useAppState();
  useEffect(() => {
    void init();
  }, []);
  useEffect(() => api.platform.onBack(() => backPressed(() => api.platform.minimize())), []);
  useEffect(() => api.platform.onOpenSession(openFromNotification), []);

  return (
    <>
      {view === 'main' ? <MainView /> : null}
      {view === 'connect' || view === 'settings' ? <ConnectScreen /> : null}
      {view === 'settings' ? <SettingsDialog /> : null}
      {hostKey ? <HostKeyDialog prompt={hostKey} /> : null}
    </>
  );
}
