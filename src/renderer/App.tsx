import { useEffect, useEffectEvent, useState } from 'react';
import { BugReportDialog } from './components/BugReportDialog';
import { ConnectScreen } from './components/ConnectScreen';
import { HostKeyDialog } from './components/HostKeyDialog';
import { MainView } from './components/MainView';
import { SettingsDialog } from './components/SettingsDialog';
import { api } from './api';
import { backPressed } from './back-stack';
import { init, openFromNotification, useAppState } from './state';

export function App() {
  const [reportOpen, setReportOpen] = useState(false);
  const openReport = () => setReportOpen(true);
  const { view, hostKey } = useAppState();
  useEffect(() => {
    void init();
  }, []);
  const handleBack = useEffectEvent(() => {
    if (!reportOpen) backPressed(() => api.platform.minimize());
  });
  const handleOpenSession = useEffectEvent((name: string) => {
    if (!reportOpen) openFromNotification(name);
  });
  useEffect(() => api.platform.onBack(() => handleBack()), []);
  useEffect(() => api.platform.onOpenSession((name) => handleOpenSession(name)), []);

  return (
    <>
      {view === 'main' ? <MainView onReport={openReport} reportOpen={reportOpen} /> : null}
      {view === 'connect' || view === 'settings' ? <ConnectScreen onReport={openReport} /> : null}
      {view === 'settings' ? <SettingsDialog onReport={openReport} /> : null}
      {hostKey ? <HostKeyDialog prompt={hostKey} /> : null}
      {reportOpen ? <BugReportDialog onClose={() => setReportOpen(false)} /> : null}
    </>
  );
}
