import { useState, useEffect } from 'react';
import * as Mie from '@mielo-ui/mielo-react';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { enable as autostartEnable, isEnabled as autostartIsEnabled, disable as autostartDisable } from '@tauri-apps/plugin-autostart';
import { useTauri } from '../tauri/TauriProvider';

interface SidebarProps {
  onViewChange?: (view: 'dashboard' | 'login') => void;
  onAccountSelect?: (id: string) => void;
}

export function Sidebar({ onViewChange, onAccountSelect }: SidebarProps) {
  const { invoke: invokeFn, listen: listenFn } = useTauri();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedAccount, setSelectedAccount] = useState(-1);
  const [autostartEnabled, setAutostartEnabled] = useState(false);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    // Fetch initial accounts and listen for updates
    async function loadAccounts() {
      try {
        const list: any = await invokeFn('list_accounts');
        if (Array.isArray(list)) {
          setAccounts(list);
          // select first account and notify parent so details component can fetch it
          const first = list[0];
          if (first && (first.id || first.email) && onAccountSelect) {
            onAccountSelect(first.id ?? first.email ?? String(first));
          }
        }
      } catch (e) {
        // ignore in test/SSR
      }
    }

    loadAccounts();
    // Subscribe to 'accounts:changed' events from backend and notify parent
    const accountsChangedHandler = (event: any) => {
      const payload = event.payload ?? event;
      if (Array.isArray(payload)) {
        setAccounts(payload);
        // Let parent (App) know the first account so it can drive AccountDetails
        if (payload.length > 0 && onAccountSelect) {
          onAccountSelect(payload[0].id ?? payload[0].email ?? String(payload[0]));
        }
      }
    };

    // Only call Tauri listen when internals are available; otherwise allow tests to inject a __test_listen__.
    try {
      invokeFn('list_accounts').catch(() => {}); // trigger initial refresh in case backend wants to push accounts
      // subscribe
      listenFn('accounts:changed', accountsChangedHandler).then((u) => (unlisten = u));
    } catch (e) {
      // ignore in tests/SSR
    }

    // Autostart probe
    autostartIsEnabled()
      .then((enabled) => setAutostartEnabled(enabled))
      .catch(() => {
        invokeFn('get_autostart')
          .then((enabled: any) => setAutostartEnabled(!!enabled))
          .catch(() => setAutostartEnabled(false));
      });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleAddAccount = () => {
    if (onViewChange) onViewChange('login');
  };

  const handleAutostartToggle = async (checked: boolean) => {
    try {
      if (checked) {
        await autostartEnable();
      } else {
        await autostartDisable();
      }
      
      // Persist preference
      await invokeFn('set_autostart', { enabled: checked });
      setAutostartEnabled(checked);
    } catch (err) {
      console.error('Autostart toggle failed:', err);
      setAutostartEnabled(!checked); // Revert on error
    }
  };

  return (
    <Mie.L.View f fc>
      <Mie.L.Header p="large">
        <div>
          <div>📁</div>
          <Mie.Header title="Proton Drive" size="tiny" />
          <p style={{ fontSize: '0.8em', opacity: 0.7, margin: 0 }}>WebDAV Bridge</p>
        </div>
      </Mie.L.Header>

      <Mie.L.List id="account-list">
        {accounts.length === 0 ? (
          <Mie.L.Item title="No accounts" />
        ) : (
          accounts.map((account, idx) => (
            <Mie.L.Item
              key={account.id ?? account.email ?? idx}
              title={account.email ?? account.id ?? String(account)}
              active={idx === selectedAccount}
              onClick={() => {
                setSelectedAccount(idx);
                if (onAccountSelect) onAccountSelect(account.id ?? account.email ?? String(account));
              }}
            />
          ))
        )}
      </Mie.L.List>

      <Mie.L.View p="large" gr="small" f fc>
        <Mie.Button onClick={handleAddAccount}>Add account</Mie.Button>

        <Mie.Checkbox
          toggle
          name="autostart"
          label="Autostart"
          checked={autostartEnabled}
          onChange={(e) => handleAutostartToggle(e.target.checked)}
        />
      </Mie.L.View>
    </Mie.L.View>
  );
}
