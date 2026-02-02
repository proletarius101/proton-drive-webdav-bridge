import { useState, useEffect } from 'react';
import * as Mie from '@mielo-ui/mielo-react';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { enable as autostartEnable, isEnabled as autostartIsEnabled, disable as autostartDisable } from '@tauri-apps/plugin-autostart';
import { useTauri } from '../tauri/TauriProvider';

interface SidebarProps {
  onViewChange?: (view: 'dashboard' | 'login') => void;
  onAccountSelect?: (id: string) => void;
  opened?: boolean;
  animateStyle?: 'shift' | 'width' | 'overlap';
}

export function Sidebar({ onViewChange: _onViewChange, onAccountSelect, opened = true, animateStyle = 'width' }: SidebarProps) {
  const { invoke: invokeFn, listen: listenFn } = useTauri();
  const [, setAccounts] = useState<any[]>([]);
  const [autostartEnabled, setAutostartEnabled] = useState(false);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    // Fetch initial accounts and listen for updates
    async function loadAccounts() {
      try {
        console.log('[Sidebar] Calling list_accounts...');
        const list: any = await invokeFn('list_accounts');
        console.log('[Sidebar] list_accounts returned:', list);
        if (Array.isArray(list)) {
          setAccounts(list);
          console.log('[Sidebar] Set accounts state:', list);
          // select first account and notify parent so details component can fetch it
          const first = list[0];
          if (first && (first.id || first.email) && onAccountSelect) {
            const accountId = first.id ?? first.email ?? String(first);
            console.log('[Sidebar] Calling onAccountSelect with:', accountId);
            onAccountSelect(accountId);
          } else {
            console.log('[Sidebar] No first account to select or no onAccountSelect callback');
          }
        } else {
          console.log('[Sidebar] list_accounts did not return an array');
        }
      } catch (e) {
        console.error('[Sidebar] Error loading accounts:', e);
      }
    }

    loadAccounts();
    // Subscribe to 'accounts:changed' events from backend and notify parent
    const accountsChangedHandler = (event: any) => {
      const payload = event.payload ?? event;
      if (Array.isArray(payload)) {
        setAccounts(payload);
        // Let parent (App) know the first account
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
    <Mie.SplitView.Sidebar opened={opened} animateStyle={animateStyle} headerbar={
      <Mie.HeaderBar
        header={
          <Mie.Header
            title="Proton Drive"
            subtitle="WebDAV Bridge"
            size="tiny"
            center
          />
        }
        transparent
      />
    }>
      <Mie.L.View f fc>
        <Mie.L.Header p="large">
          <div>
            <div>📁</div>
            <Mie.Header title="Proton Drive" />
            <p style={{ fontSize: '0.8em', opacity: 0.7, margin: 0 }}>WebDAV Bridge</p>
          </div>
        </Mie.L.Header>

        <Mie.L.View p="large" gr="small" f fc>
          <Mie.Checkbox
            toggle
            name="autostart"
            label="Autostart"
            checked={autostartEnabled}
            onChange={(e) => handleAutostartToggle(e.target.checked)}
          />
        </Mie.L.View>
      </Mie.L.View>
    </Mie.SplitView.Sidebar>
  );
}

Sidebar.displayName = "Mie.SplitView.Sidebar";
