import { useState } from 'react';
import * as Mie from '@mielo-ui/mielo-react';
import { Sidebar } from './components/Sidebar.js';
import { Dashboard } from './components/Dashboard.js';
import { AccountDetails } from './components/AccountDetails.js';
import { LoginScreen } from './components/LoginScreen.js';

export function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [currentView, setCurrentView] = useState<'dashboard' | 'login'>('dashboard');
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  return (
    <Mie.L.Window
      data-theme="light"
      split={{
        headerbar: (
          <Mie.HeaderBar
            transparent
            left={
              <Mie.Button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                transparent
              >
                ≡
              </Mie.Button>
            }
            header={<Mie.Header title="Proton Drive WebDAV Bridge" size="tiny" />}
            right={<div id="permissions" title="Background Activity permission" />}
          />
        ),
        sidebar: (
          <Mie.SplitView.Sidebar opened={sidebarOpen} animateStyle="width">
            <Sidebar onViewChange={setCurrentView} onAccountSelect={setSelectedAccountId} />
          </Mie.SplitView.Sidebar>
        ),
      }}
    >
      <Mie.L.View f fc p="large" gr="large">
        <AccountDetails accountId={selectedAccountId} />
        {currentView === 'login' && <LoginScreen />}
        {currentView === 'dashboard' && <Dashboard />}
      </Mie.L.View>
    </Mie.L.Window>
  );
}
