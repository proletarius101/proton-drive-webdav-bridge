import { useEffect } from 'react';
import { useElectron } from '../electron/ElectronProvider.js';
import { ServiceBadge } from './ServiceBadge.js';
import { NetworkSettings } from './NetworkSettings.js';
import { LogViewer } from './LogViewer.js';
import { AutostartToggle } from './AutostartToggle.js';

/**
 * Main control panel component
 * Aggregates all dashboard functionality for Electron
 */
export function ControlPanel() {
  const electron = useElectron();

  // Start WebDAV server on load if not running
  useEffect(() => {
    const startWebDAV = async () => {
      try {
        const status: any = await electron.invoke('webdav:getStatus');
        if (!status?.running) {
          try {
            await electron.invoke('webdav:start');
            console.log('WebDAV server started');
          } catch (err) {
            const msg = String((err as any)?.message ?? err ?? '');
            if (!msg.toLowerCase().includes('already')) {
              console.error('Failed to start WebDAV:', err);
            } else {
              console.debug('WebDAV already running');
            }
          }
        }
      } catch (err) {
        console.error('Failed to check WebDAV status:', err);
      }
    };

    startWebDAV();
  }, [electron]);

  const handleOpenFiles = async () => {
    try {
      // This would require a specific IPC handler to open the WebDAV location
      console.log('Opening files in system file manager');
    } catch (err) {
      console.error('Failed to open files:', err);
    }
  };

  const handlePurgeCache = async () => {
    try {
      await electron.invoke('config:update', { key: 'cache.purge', value: true });
      console.log('Cache purged');
    } catch (err) {
      console.error('Failed to purge cache:', err);
    }
  };

  const handleLogout = async () => {
    try {
      await electron.invoke('auth:logout');
    } catch (err) {
      console.error('Failed to logout:', err);
    }
  };

  return (
    <div style={{ padding: '16px', maxWidth: '600px', margin: '0 auto' }}>
      <h1>Proton Drive WebDAV Bridge</h1>

      {/* Status Section */}
      <div style={{ marginBottom: '16px' }}>
        <h2 style={{ marginBottom: '8px' }}>Status</h2>
        <ServiceBadge />
      </div>

      {/* Storage Section */}
      <div style={{ marginBottom: '16px' }}>
        <h2 style={{ marginBottom: '8px' }}>Storage</h2>
      </div>

      {/* Controls Section */}
      <div style={{ marginBottom: '16px' }}>
        <h2 style={{ marginBottom: '8px' }}>Controls</h2>
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
          onClick={handleOpenFiles}
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
          onClick={handlePurgeCache}
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
          onClick={handleLogout}
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

