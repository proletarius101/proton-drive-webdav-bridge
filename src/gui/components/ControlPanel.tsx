import { useEffect } from 'react';
import { useTauri } from '../tauri/TauriProvider.js';
import { ServiceBadge } from './ServiceBadge.js';
import { StorageQuota } from './StorageQuota.js';
import { MountControl } from './MountControl.js';
import { NetworkSettings } from './NetworkSettings.js';
import { LogViewer } from './LogViewer.js';
import { AutostartToggle } from './AutostartToggle.js';

/**
 * Main control panel component
 * Aggregates all dashboard functionality from vanilla main.ts
 */
export function ControlPanel() {
  const { invoke } = useTauri();

  // Start sidecar on load if not running
  useEffect(() => {
    const startSidecar = async () => {
      try {
        const status: any = await invoke('get_status');
        if (!status || !(status?.server?.running ?? status?.running)) {
          try {
            await invoke('start_sidecar');
            console.log('Sidecar started');
          } catch (err) {
            const msg = String((err as any)?.message ?? err ?? '');
            if (!msg.toLowerCase().includes('already')) {
              console.error('Failed to start sidecar:', err);
            } else {
              console.debug('Sidecar already running');
            }
          }
        }
      } catch (err) {
        console.error('Failed to check sidecar status:', err);
      }
    };

    startSidecar();
  }, [invoke]);

  return (
    <div style={{ padding: '16px', maxWidth: '600px', margin: '0 auto' }}>
      <h1>Proton Drive WebDAV Bridge</h1>

      {/* Status Section */}
      <div style={{ marginBottom: '16px' }}>
        <h2 style={{ marginBottom: '8px' }}>Status</h2>
        <ServiceBadge />
        <div id="live-status" style={{ marginTop: '8px', fontSize: '14px' }}>
          Live status: loading...
        </div>
      </div>

      {/* Storage Section */}
      <div style={{ marginBottom: '16px' }}>
        <h2 style={{ marginBottom: '8px' }}>Storage</h2>
        <StorageQuota />
      </div>

      {/* Controls Section */}
      <div style={{ marginBottom: '16px' }}>
        <h2 style={{ marginBottom: '8px' }}>Controls</h2>
        <MountControl />
        <AutostartToggle />
      </div>

      {/* Network Section */}
      <div style={{ marginBottom: '16px' }}>
        <h2 style={{ marginBottom: '8px' }}>Network</h2>
        <NetworkSettings />
      </div>

      {/* Actions Section */}
      <div
        style={{
          marginBottom: '16px',
          display: 'flex',
          gap: '8px',
          flexWrap: 'wrap',
        }}
      >
        <button
          id="open-files"
          onClick={() => invoke('open_in_files')}
          style={{
            padding: '8px 12px',
            borderRadius: '4px',
            border: 'none',
            backgroundColor: '#2196F3',
            color: 'white',
            cursor: 'pointer',
          }}
        >
          Open in Files
        </button>
        <button
          id="purge-cache"
          onClick={() => invoke('purge_cache')}
          style={{
            padding: '8px 12px',
            borderRadius: '4px',
            border: 'none',
            backgroundColor: '#FF9800',
            color: 'white',
            cursor: 'pointer',
          }}
        >
          Purge Cache
        </button>
        <button
          id="logout"
          onClick={() => invoke('logout')}
          style={{
            padding: '8px 12px',
            borderRadius: '4px',
            border: 'none',
            backgroundColor: '#F44336',
            color: 'white',
            cursor: 'pointer',
          }}
        >
          Logout
        </button>
      </div>

      {/* Logs Section */}
      <div>
        <h2 style={{ marginBottom: '8px' }}>Diagnostics</h2>
        <LogViewer />
      </div>
    </div>
  );
}
