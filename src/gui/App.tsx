import { useState } from 'react';
import * as Mie from '@mielo-ui/mielo-react';
import { Sidebar } from './components/Sidebar.js';
import { Dashboard } from './components/Dashboard.js';
import { AccountDetails } from './components/AccountDetails.js';
import { LoginScreen } from './components/LoginScreen.js';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useMediaQuery } from 'usehooks-ts';
import { useCallback } from 'react';

export function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [currentView, setCurrentView] = useState<'dashboard' | 'login'>('dashboard');
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const isMobile = useMediaQuery('(max-width: 768px)');

  function callWindowControl(action: string) {
    const appWindow = (window as any).__TAURI_INTERNALS__ && getCurrentWindow();
    appWindow?.[action]?.();
  }

  const onClickControl = useCallback(
    (_event: React.MouseEvent<HTMLButtonElement>, controlType: Mie.WindowControlType) => {
      callWindowControl(controlType);
    },
    []
  );

  const windowControls = !isMobile && (
    <Mie.Window.Controls onClickControl={onClickControl} controls={['close']} />
  );

  return (
    <Mie.L.Window
      data-theme="light"
      split={{
        headerbar: (
          <Mie.L.HeaderBar
            transparent
            controls={windowControls}
            data-desktop-drag={true}
            left={
              <Mie.Button onClick={() => setSidebarOpen(!sidebarOpen)} transparent>
                ≡
              </Mie.Button>
            }
            header={<Mie.Header title="Proton Drive WebDAV Bridge" size="tiny" />}
            right={<div id="permissions" title="Background Activity permission" />}
          />
        ),
        sidebar: (
          <Sidebar opened={sidebarOpen} animateStyle="width" onViewChange={setCurrentView} onAccountSelect={setSelectedAccountId} />
        ),
      }}
    >
      <Mie.L.View f fc>
        <AccountDetails accountId={selectedAccountId} />
        {currentView === 'login' && <LoginScreen />}
        {currentView === 'dashboard' && <Dashboard />}
      </Mie.L.View>
    </Mie.L.Window>
  );
}
