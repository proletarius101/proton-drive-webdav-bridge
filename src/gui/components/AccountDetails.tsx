import { useEffect, useState } from 'react';
import * as Mie from '@mielo-ui/mielo-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export function AccountDetails({ accountId }: { accountId?: string | null }) {
  const [account, setAccount] = useState<any | null>(null);

  useEffect(() => {
    let unlisten: any;
    async function load() {
      if (!accountId) {
        setAccount(null);
        return;
      }
      try {
        const coreInvoke: any = (globalThis as any).__test_invoke__ ?? invoke;
        // test hook capture
        try { if ((globalThis as any).__test_hook_calls) (globalThis as any).__test_hook_calls.push(`fetchAccountDetails:${accountId}`); } catch (e) {}
        const acc: any = await coreInvoke('get_account', { id: accountId }).catch(() => null);
        setAccount(acc);
      } catch (e) {
        setAccount(null);
      }
    }

    load();

    // Listen for updates to this account
    const handler = (e: any) => {
      const payload = e.payload ?? e;
      if (payload && payload.id && payload.id === accountId) setAccount(payload);
    };

    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      listen('account:updated', handler).then((u) => (unlisten = u)).catch(() => {});
    } else if ((globalThis as any).__test_listen__) {
      // test harness may provide a mock listen
      (globalThis as any).__test_listen__('account:updated', handler).then((u: any) => (unlisten = u)).catch(() => {});
    }

    return () => {
      if (unlisten) unlisten();
    };
  }, [accountId]);

  return (
    <Mie.L.View p="large" gr="medium" f fc>
      <Mie.Header title="Account" />
      <div id="account-email" style={{ fontWeight: 'bold' }}>{account ? account.email ?? account.id : 'No account selected'}</div>
      <div id="account-status-text">{account ? account.status ?? 'Live status: N/A' : '—'}</div>
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <input id="account-dav-url" type="text" value={account?.address ?? ''} readOnly />
        <input id="account-network-port" type="text" value={account?.port ? String(account.port) : ''} readOnly />
      </div>
      <div style={{ marginTop: '8px' }}>
        <label htmlFor="account-mount-toggle">Mounted</label>
        <input id="account-mount-toggle" type="checkbox" checked={!!account?.mounted} readOnly />
      </div>
    </Mie.L.View>
  );
}
