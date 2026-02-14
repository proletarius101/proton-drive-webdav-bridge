import { useEffect } from 'react';
import * as Mie from '@mielo-ui/mielo-react';
import { useElectron } from '../electron/ElectronProvider.js';
import { useAutostart } from '../hooks/useAutostart.js';

interface SidebarProps {
  onViewChange?: (view: 'dashboard' | 'login') => void;
  onAccountSelect?: (id: string) => void;
  opened?: boolean;
  animateStyle?: 'shift' | 'width' | 'overlap';
}

export function Sidebar({
  onViewChange: _onViewChange,
  onAccountSelect,
  opened = true,
  animateStyle = 'width',
}: SidebarProps) {
  const electron = useElectron();
  const { isEnabled: autostartEnabled, setAutostart } = useAutostart();
  // const [accounts, setAccounts] = useState<any[]>([]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    // Fetch initial accounts and listen for updates
    async function loadAccounts() {
      try {
        console.log('[Sidebar] Calling auth:getStatus...');
        const status = await electron.invoke<'auth:getStatus'>('auth:getStatus');
        console.log('[Sidebar] auth:getStatus returned:', status);
        if (status?.email && onAccountSelect) {
          onAccountSelect(status.email);
        }
      } catch (e) {
        console.error('[Sidebar] Error loading accounts:', e);
      }
    }

    loadAccounts();

    // Listen for auth state changes
    try {
      unsubscribe = electron.on('auth:login-success', (data: unknown) => {
        if (data && typeof data === 'object' && 'email' in data && onAccountSelect) {
          onAccountSelect(String(data.email));
        }
      });
    } catch {
      // ignore in tests/SSR
    }

    return () => {
      unsubscribe?.();
    };
  }, [electron, onAccountSelect]);

  const handleAutostartToggle = async (checked: boolean) => {
    try {
      await setAutostart(checked);
    } catch (err) {
      console.error('Autostart toggle failed:', err);
    }
  };

  return (
    <Mie.SplitView.Sidebar
      opened={opened}
      animateStyle={animateStyle}
      headerbar={
        <Mie.HeaderBar
          header={<Mie.Header title="Proton Drive" subtitle="WebDAV Bridge" size="tiny" center />}
          transparent
        />
      }
    >
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

Sidebar.displayName = 'Mie.SplitView.Sidebar';
