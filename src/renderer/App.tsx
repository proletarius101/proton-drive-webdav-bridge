import { useCallback, useEffect, useState } from 'react';
import * as Mie from '@mielo-ui/mielo-react';
import { Sidebar } from './components/Sidebar.js';
import { Dashboard } from './components/Dashboard.js';
import { LoginScreen } from './components/LoginScreen.js';
import { useMediaQuery } from 'usehooks-ts';
import { ElectronProvider, useElectron } from './electron/ElectronProvider.js';

interface AccountSummary {
  id?: string;
  email?: string;
  status?: string;
}

function AppContent() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [currentView, setCurrentView] = useState<'dashboard' | 'login'>('login');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const electron = useElectron();

  // Check authentication status on mount
  useEffect(() => {
    const checkAuthStatus = async () => {
      try {
        const status = await electron.invoke<'auth:getStatus'>('auth:getStatus');
        if (status?.authenticated) {
          setIsAuthenticated(true);
          setCurrentView('dashboard');
        } else {
          setIsAuthenticated(false);
          setCurrentView('login');
        }
      } catch (err) {
        console.error('Failed to check auth status:', err);
        setCurrentView('login');
      } finally {
        setLoading(false);
      }
    };

    checkAuthStatus();

    // Listen for auth state changes
    const unsubscribeLogin = electron.on('auth:login-success', (data: any) => {
      setIsAuthenticated(true);
      setCurrentView('dashboard');
      setAccount({ email: data?.email, status: 'Authenticated' });
    });

    const unsubscribeLogout = electron.on('auth:logout-success', () => {
      setIsAuthenticated(false);
      setCurrentView('login');
      setAccount(null);
    });

    return () => {
      unsubscribeLogin?.();
      unsubscribeLogout?.();
    };
  }, [electron]);

  function callWindowControl(action: string) {
    // Window controls not directly exposed in Electron preload for security
    // These are handled by the Mielo Window.Controls component which uses native menus
    switch (action) {
      case 'minimize':
        // window.electron.window.minimize();
        break;
      case 'maximize':
        // window.electron.window.maximize();
        break;
      case 'close':
        // window.electron.window.close();
        break;
    }
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

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    async function load() {
      console.log('[App] accountId changed to:', selectedAccountId);
      if (!selectedAccountId) {
        console.log('[App] No accountId, clearing account');
        setAccount(null);
        return;
      }
      try {
            console.log('[App] Calling auth:getAccount with id:', selectedAccountId);
        // In Electron, we would invoke via IPC
        // For now, this is a placeholder - actual account data would come from WebDAV or Drive API
        setAccount({ id: selectedAccountId });
      } catch (error) {
            console.error('[App] Error calling auth:getAccount:', error);
        setAccount(null);
      }
    }

    load();

    // Listen for account updates via Electron events
    const handleAccountUpdate = (data: AccountSummary) => {
      if (data?.id && data.id === selectedAccountId) setAccount(data);
    };

    try {
      unsubscribe = electron.on('account:updated', handleAccountUpdate);
    } catch (error) {
      // ignore in test/SSR
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [selectedAccountId, electron]);

  const accountTitle = account ? (account.email ?? account.id ?? 'Account') : 'Account';
  const accountStatus = account ? (account.status ?? 'Live status: N/A') : '—';

  if (loading) {
    return (
      <Mie.L.Window data-theme="light">
        <Mie.L.View f fc p="large" style={{ alignItems: 'center', justifyContent: 'center' }}>
          <Mie.L.Text>Loading...</Mie.L.Text>
        </Mie.L.View>
      </Mie.L.Window>
    );
  }

  if (!isAuthenticated) {
    return (
      <Mie.L.Window data-theme="light">
        <LoginScreen />
      </Mie.L.Window>
    );
  }

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
            header={
              <div id="app-header">
                <Mie.Header title={accountTitle} subtitle={accountStatus} size="tiny" />
              </div>
            }
            right={<div id="permissions" title="Background Activity permission" />}
          />
        ),
        sidebar: (
          <Sidebar
            opened={sidebarOpen}
            animateStyle="width"
            onViewChange={setCurrentView}
            onAccountSelect={setSelectedAccountId}
          />
        ),
      }}
    >
      <Mie.L.View f fc>
        {currentView === 'login' && <LoginScreen />}
        {currentView === 'dashboard' && <Dashboard />}
      </Mie.L.View>
    </Mie.L.Window>
  );
}

export function App() {
  return (
    <ElectronProvider>
      <AppContent />
    </ElectronProvider>
  );
}
