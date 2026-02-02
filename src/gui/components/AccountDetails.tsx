import { useEffect, useState } from 'react';
import * as Mie from '@mielo-ui/mielo-react';
import { useTauri } from '../tauri/TauriProvider';

export function AccountDetails({ accountId }: { accountId?: string | null }) {
  const [account, setAccount] = useState<any | null>(null);
  const { invoke, listen } = useTauri();

  useEffect(() => {
    let unlisten: any;
    async function load() {
      console.log('[AccountDetails] accountId changed to:', accountId);
      if (!accountId) {
        console.log('[AccountDetails] No accountId, clearing account');
        setAccount(null);
        return;
      }
      try {
        console.log('[AccountDetails] Calling get_account with id:', accountId);
        const acc: any = await invoke('get_account', { id: accountId }).catch(() => null);
        console.log('[AccountDetails] get_account returned:', acc);
        setAccount(acc);
      } catch (e) {
        console.error('[AccountDetails] Error getting account:', e);
        setAccount(null);
      }
    }

    load();

    // Listen for updates to this account
    const handler = (e: any) => {
      const payload = e.payload ?? e;
      if (payload && payload.id && payload.id === accountId) setAccount(payload);
    };

    try {
      listen('account:updated', handler)
        .then((u) => (unlisten = u))
        .catch(() => {});
    } catch (e) {
      // ignore in test/SSR
    }

    return () => {
      if (unlisten) unlisten();
    };
  }, [accountId]);

  return (
    <Mie.L.View p="large" gr="medium" f fc>
      <Mie.Header title={account ? (account.email ?? account.id) : 'Account'} />
      <div id="account-status-text">{account ? (account.status ?? 'Live status: N/A') : '—'}</div>
    </Mie.L.View>
  );
}
