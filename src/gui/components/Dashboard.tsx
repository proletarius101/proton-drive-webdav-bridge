import { useState, useEffect } from 'react';
import * as Mie from '@mielo-ui/mielo-react';
import { useTauri } from '../tauri/TauriProvider';
import type { UnlistenFn } from '@tauri-apps/api/event';

export function Dashboard() {
  const { invoke, listen: tauriListen } = useTauri();
  const [mounted, setMounted] = useState(false);
  const [port, setPort] = useState('12345');
  const [address, setAddress] = useState('dav://127.0.0.1:12345');
  const [logsVisible, setLogsVisible] = useState(false);
  const [logs, setLogs] = useState('');
  const [storageQuota, setStorageQuota] = useState({ used: 0, total: 0, percent: 0 });

  useEffect(() => {
    let unlistenLogs: UnlistenFn | undefined;
    let unlistenMountStatus: UnlistenFn | undefined;

    // Listen to sidecar logs (guarded)
    try {
      tauriListen('sidecar:log', (event: any) => {
        const { level, message } = event.payload ?? event;
        setLogs((prev) => `${prev}[${level}] ${message}\n`);
      }).then((unlisten) => {
        unlistenLogs = unlisten;
      });

      // Listen to mount status changes
      tauriListen('mount:status', (event: any) => {
        console.log('Mount status:', event.payload ?? event);
      }).then((unlisten) => {
        unlistenMountStatus = unlisten;
      });
    } catch (e) {
      // ignore in SSR/tests
    }

    // Fetch initial status
    invoke('get_status')
      .then((status: any) => {
        const portVal = status?.config?.webdav?.port || status?.port || 12345;
        const host = status?.config?.webdav?.host || 'localhost';
        setPort(String(portVal));
        setAddress(`dav://${host}:${portVal}`);

        if (status?.storage) {
          const used = status.storage.used || 0;
          const total = status.storage.total || 0;
          const percent = total > 0 ? Math.round((used / total) * 100) : 0;
          setStorageQuota({ used, total, percent });
        }
      })
      .catch((err: any) => console.error('Failed to get initial status:', err));

    // Check initial mount status
    invoke('check_mount_status')
      .then((mountStatus: any) => {
        setMounted(mountStatus !== null);
      })
      .catch(() => setMounted(false));

    return () => {
      unlistenLogs?.();
      unlistenMountStatus?.();
    };
  }, []);

  const handleMountToggle = async (checked: boolean) => {
    try {
      await invoke(checked ? 'mount_drive' : 'unmount_drive');
      // Verify actual mount status after operation
      const mountStatus: any = await invoke('check_mount_status');
      setMounted(mountStatus !== null);
    } catch (err) {
      console.error('Mount operation failed:', err);
      setMounted(!checked); // Revert on error
    }
  };

  const handleOpenFiles = async () => {
    try {
      await invoke('open_in_files');
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
      await invoke('set_network_port', { port: Number(port) });
      // Refresh status to get updated address
      const status: any = await invoke('get_status');
      const newPort = status?.config?.webdav?.port || port;
      const host = status?.config?.webdav?.host || 'localhost';
      setAddress(`dav://${host}:${newPort}`);
    } catch (err) {
      console.error('Failed to set port:', err);
    }
  };

  const handlePurgeCache = async () => {
    try {
      await invoke('purge_cache');
    } catch (err) {
      console.error('Failed to purge cache:', err);
    }
  };

  const handleLogout = async () => {
    try {
      await invoke('logout');
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
      {/* Service Status */}
      <Mie.Message>Active</Mie.Message>

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
          description="Mount the WebDAV share to your file manager"
          activatable
          side={
            <Mie.Checkbox
              toggle
              name="mount-toggle"
              checked={mounted}
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
          <pre
            id="log-area"
            className="log-area"
          >
            {logs || 'No logs yet'}
          </pre>
        )}
      </Mie.L.View>
    </Mie.L.View>
  );
}
