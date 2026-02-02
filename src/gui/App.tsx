import { useCallback, useEffect, useState } from 'react';
import * as Mie from '@mielo-ui/mielo-react';
import { Sidebar } from './components/Sidebar.js';
import { Dashboard } from './components/Dashboard.js';
import { LoginScreen } from './components/LoginScreen.js';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useMediaQuery } from 'usehooks-ts';
import { useTauri } from './tauri/TauriProvider.js';

interface AccountSummary {
  id?: string;
  email?: string;
  status?: string;
}

export function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [currentView, setCurrentView] = useState<'dashboard' | 'login'>('dashboard');
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const { invoke, listen } = useTauri();

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

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    async function load() {
      console.log('[App] accountId changed to:', selectedAccountId);
      if (!selectedAccountId) {
        console.log('[App] No accountId, clearing account');
        setAccount(null);
        return;
      }
      try {
        console.log('[App] Calling get_account with id:', selectedAccountId);
        const acc = await invoke<AccountSummary | null>('get_account', {
          id: selectedAccountId,
        }).catch(() => null);
        console.log('[App] get_account returned:', acc);
        setAccount(acc);
      } catch (error) {
        console.error('[App] Error getting account:', error);
        setAccount(null);
      }
    }

    load();

    const handler = (event: { payload: AccountSummary }) => {
      const payload = event?.payload;
      if (payload?.id && payload.id === selectedAccountId) setAccount(payload);
    };

    try {
      listen<AccountSummary>('account:updated', handler)
        .then((u) => {
          unlisten = u;
        })
        .catch(() => {});
    } catch (error) {
      // ignore in test/SSR
    }

    return () => {
      if (unlisten) unlisten();
    };
  }, [selectedAccountId, invoke, listen]);

  const accountTitle = account ? (account.email ?? account.id ?? 'Account') : 'Account';
  const accountStatus = account ? (account.status ?? 'Live status: N/A') : '—';

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
