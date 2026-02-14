import { useState, useEffect } from 'react';
import * as Mie from '@mielo-ui/mielo-react';
import { useElectron } from '../electron/ElectronProvider';

interface WebDAVStatus {
  running?: boolean;
  config?: {
    webdav?: {
      port?: number;
      host?: string;
    };
  };
}

export function Dashboard() {
  const electron = useElectron();
  // const [mounted, setMounted] = useState(false);
  const [port, setPort] = useState('12345');
  const [address, setAddress] = useState('dav://127.0.0.1:12345');
  const [logsVisible, setLogsVisible] = useState(false);
  const [logs, setLogs] = useState('');
  const [storageQuota, setStorageQuota] = useState({ used: 0, total: 0, percent: 0 });
  const [webdavStatus, setWebdavStatus] = useState<WebDAVStatus | null>(null);

  useEffect(() => {
    let unsubscribeLogs: (() => void) | undefined;
    let unsubscribeStarted: (() => void) | undefined;
    let unsubscribeStopped: (() => void) | undefined;
    let unsubscribeError: (() => void) | undefined;

    const initializeStatus = async () => {
      try {
        // Get WebDAV server status
        const status = await electron.invoke<'webdav:getStatus'>('webdav:getStatus');
        setWebdavStatus(status);

        if (status?.config?.webdav) {
          const portVal = status.config.webdav.port || 12345;
          const host = status.config.webdav.host || 'localhost';
          setPort(String(portVal));
          setAddress(`dav://${host}:${portVal}`);
        }

        // Get storage quota
        const quota = (await electron.invoke<'config:get'>('config:get', { key: 'storage' })) as
          | { used?: number; total?: number }
          | null
          | undefined;
        if (quota) {
          const used = quota.used || 0;
          const total = quota.total || 0;
          const percent = total > 0 ? Math.round((used / total) * 100) : 0;
          setStorageQuota({ used, total, percent });
        }
      } catch (err) {
        console.error('Failed to initialize dashboard:', err);
      }
    };

    initializeStatus();

    // Subscribe to event listeners
    try {
      unsubscribeLogs = electron.on('app:log', (data: unknown) => {
        if (data && typeof data === 'object' && 'level' in data && 'message' in data) {
          setLogs((prev) => `${prev}[${data.level}] ${data.message}\n`);
        }
      });

      unsubscribeStarted = electron.on('webdav:started', () => {
        console.log('WebDAV server started');
        setWebdavStatus((prev: unknown) => {
          if (prev && typeof prev === 'object') {
            return { ...prev, running: true };
          }
          return { running: true };
        });
      });

      unsubscribeStopped = electron.on('webdav:stopped', () => {
        console.log('WebDAV server stopped');
        setWebdavStatus((prev: unknown) => {
          if (prev && typeof prev === 'object') {
            return { ...prev, running: false };
          }
          return { running: false };
        });
      });

      unsubscribeError = electron.on('webdav:error', (error: unknown) => {
        console.error('WebDAV error:', error);
        const message =
          error && typeof error === 'object' && 'message' in error
            ? String(error.message)
            : 'Unknown error';
        setLogs((prev) => `${prev}[ERROR] ${message}\n`);
      });
    } catch (e) {
      console.error('Failed to subscribe to events:', e);
    }

    return () => {
      unsubscribeLogs?.();
      unsubscribeStarted?.();
      unsubscribeStopped?.();
      unsubscribeError?.();
    };
  }, [electron]);

  const handleMountToggle = async (checked: boolean) => {
    try {
      if (checked) {
        await electron.invoke<'webdav:start'>('webdav:start');
      } else {
        await electron.invoke<'webdav:stop'>('webdav:stop');
      }
      // Status update will come from event listener
    } catch (err) {
      console.error('WebDAV operation failed:', err);
    }
  };

  const handleOpenFiles = async () => {
    try {
      // This may not be directly available; could use system open command
      // For now, just log the address
      console.log('Would open WebDAV location:', address);
    } catch (err) {
      console.error('Failed to open files:', err);
    }
  };

  const handleCopyAddress = async () => {
    if (navigator?.clipboard) {
      await navigator.clipboard.writeText(address);
    }
  };

  const handleApplyPort = async () => {
    try {
      await electron.invoke<'config:update'>('config:update', {
        key: 'webdav.port',
        value: Number(port),
      });
      // Refresh status
      const status = await electron.invoke<'webdav:getStatus'>('webdav:getStatus');
      if (status?.config?.webdav) {
        const newPort = status.config.webdav.port || port;
        const host = status.config.webdav.host || 'localhost';
        setAddress(`dav://${host}:${newPort}`);
        setPort(String(newPort));
      }
    } catch (err) {
      console.error('Failed to set port:', err);
    }
  };

  const handlePurgeCache = async () => {
    try {
      await electron.invoke<'config:update'>('config:update', {
        key: 'cache.purge',
        value: true,
      });
      setLogs((prev) => `${prev}[INFO] Cache purged\n`);
    } catch (err) {
      console.error('Failed to purge cache:', err);
    }
  };

  const handleLogout = async () => {
    try {
      await electron.invoke<'auth:logout'>('auth:logout');
      // Component will re-render via context when auth state changes
    } catch (err) {
      console.error('Failed to logout:', err);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  };

  return (
    <Mie.L.View f fc p="large" gr="large">
      {/* Storage Quota */}
      <Mie.L.View f fc gr="small">
        <Mie.Header title="Storage Quota" />
        <Mie.Progress>
          <Mie.Progress.Bar progress={storageQuota.percent} progressVisible />
        </Mie.Progress>
        <Mie.L.Text>
          {formatBytes(storageQuota.used)} / {formatBytes(storageQuota.total)} used
        </Mie.L.Text>
      </Mie.L.View>

      <Mie.L.View f fc gr="small">
        <Mie.Header title="Settings" />
        {/* Settings Rows */}
        <Mie.L.Rows shadow r>
          <Mie.L.Rows.Row
            title="Files"
            description="Open your Proton Drive folder in the system file manager"
            activatable
            side={
              <Mie.Button id="open-files" onClick={handleOpenFiles}>
                Open in File Manager
              </Mie.Button>
            }
          />

          <Mie.L.Rows.Row
            title="Mount"
            description="Toggle WebDAV server"
            activatable
            side={
              <Mie.Checkbox
                toggle
                name="mount-toggle"
                checked={webdavStatus?.running || false}
                onChange={(e) => handleMountToggle(e.target.checked)}
              />
            }
          />

          <Mie.L.Rows.Row
            title="Address"
            description="Local WebDAV address"
            activatable
            side={
              <Mie.L.View f>
                <Mie.L.Entry id="dav-url" readOnly value={address} size="small" r />
                <Mie.Button id="copy-url" onClick={handleCopyAddress} size="small">
                  Copy
                </Mie.Button>
              </Mie.L.View>
            }
            rb
          />
        </Mie.L.Rows>
      </Mie.L.View>
      {/* Advanced Section */}
      <Mie.Collapsible title="Advanced / Troubleshoot">
        <Mie.L.Rows shadow r mt="medium">
          <Mie.L.Rows.Row
            title="Network Port"
            description="Set local WebDAV listening port"
            activatable
            side={
              /* compact horizontal layout for port input + apply button */
              <Mie.L.View r fai="center" gr="small">
                <Mie.L.Rows.Entry
                  id="network-port"
                  type="number"
                  min="1024"
                  max="65535"
                  value={port}
                  onChange={(e) => setPort(e.currentTarget.value)}
                  r
                />
                <Mie.Button id="apply-port" onClick={handleApplyPort} size="small">
                  Apply
                </Mie.Button>
              </Mie.L.View>
            }
            rb
          />
        </Mie.L.Rows>

        <Mie.L.View f gr="small" mt="medium">
          <Mie.Button id="purge-cache" onClick={handlePurgeCache}>
            Purge Cache
          </Mie.Button>
          <Mie.Button id="logout" onClick={handleLogout} className="destructive">
            Logout / Reset Auth
          </Mie.Button>
        </Mie.L.View>
      </Mie.Collapsible>

      {/* Logs */}
      <Mie.L.View f fc gr="small">
        <Mie.Button id="toggle-log" onClick={() => setLogsVisible(!logsVisible)}>
          {logsVisible ? 'Hide Logs' : 'Show Logs'}
        </Mie.Button>
        {logsVisible && (
          <pre id="log-area" className="log-area">
            {logs || 'No logs yet'}
          </pre>
        )}
      </Mie.L.View>
    </Mie.L.View>
  );
}
