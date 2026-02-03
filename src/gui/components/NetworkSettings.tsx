import { useState, useCallback } from 'react';
import { useServiceStatus } from '../hooks/useServiceStatus.js';
import { useTauri } from '../tauri/TauriProvider.js';

/**
 * Network settings component
 * Manages WebDAV URL and network port configuration
 */
export function NetworkSettings() {
  const { status, refetch: refetchStatus } = useServiceStatus();
  const { invoke } = useTauri();
  const [localPort, setLocalPort] = useState('');
  const [isApplying, setIsApplying] = useState(false);

  // Initialize port from status
  const currentPort = status?.config?.webdav?.port ?? status?.port ?? 12345;
  const currentHost = status?.config?.webdav?.host ?? 'localhost';
  const davUrl = status?.server?.url ?? `dav://${currentHost}:${currentPort}`;

  // Sync local port when status updates
  useState(() => {
    if (!localPort) {
      setLocalPort(String(currentPort));
    }
  });

  const handleCopyUrl = useCallback(async () => {
    if (davUrl && navigator?.clipboard) {
      try {
        await navigator.clipboard.writeText(davUrl);
        console.log('URL copied to clipboard');
      } catch (err) {
        console.error('Failed to copy URL:', err);
      }
    }
  }, [davUrl]);

  const handleApplyPort = useCallback(async () => {
    const port = Number(localPort);
    if (isNaN(port) || port <= 0) {
      console.error('Invalid port number');
      return;
    }

    try {
      setIsApplying(true);
      await invoke('set_network_port', { port });
      await refetchStatus();
      console.log('Port updated successfully');
    } catch (err) {
      console.error('Failed to set port:', err);
    } finally {
      setIsApplying(false);
    }
  }, [localPort, invoke, refetchStatus]);

  return (
    <div style={{ marginTop: '16px', padding: '12px', borderRadius: '4px', backgroundColor: '#f5f5f5' }}>
      <div style={{ marginBottom: '12px' }}>
        <label htmlFor="dav-url" style={{ display: 'block', marginBottom: '4px' }}>
          WebDAV URL
        </label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            id="dav-url"
            type="text"
            value={davUrl}
            readOnly
            style={{
              flex: 1,
              padding: '6px 8px',
              borderRadius: '4px',
              border: '1px solid #ccc',
              fontFamily: 'monospace',
            }}
          />
          <button
            id="copy-url"
            onClick={handleCopyUrl}
            style={{
              padding: '6px 12px',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: '#2196F3',
              color: 'white',
              cursor: 'pointer',
            }}
          >
            Copy
          </button>
        </div>
      </div>

      <div>
        <label htmlFor="network-port" style={{ display: 'block', marginBottom: '4px' }}>
          Network Port
        </label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            id="network-port"
            type="number"
            value={localPort}
            onChange={(e) => setLocalPort(e.target.value)}
            disabled={isApplying}
            style={{
              flex: 1,
              padding: '6px 8px',
              borderRadius: '4px',
              border: '1px solid #ccc',
            }}
          />
          <button
            id="apply-port"
            onClick={handleApplyPort}
            disabled={isApplying || String(localPort) === String(currentPort)}
            style={{
              padding: '6px 12px',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: '#4CAF50',
              color: 'white',
              cursor: 'pointer',
              opacity: isApplying || String(localPort) === String(currentPort) ? 0.5 : 1,
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
