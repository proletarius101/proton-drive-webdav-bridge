import { useState, useCallback, useEffect, type ChangeEvent } from 'react';
import { useElectron } from '../electron/ElectronProvider.js';

/**
 * Network settings component
 * Manages WebDAV URL and network port configuration
 */
export function NetworkSettings() {
  const electron = useElectron();
  const [localPort, setLocalPort] = useState('');
  const [davUrl, setDavUrl] = useState('dav://127.0.0.1:12345');
  const [isApplying, setIsApplying] = useState(false);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const status = await electron.invoke<'webdav:getStatus'>('webdav:getStatus');
        if (status?.config?.webdav) {
          const port = status.config.webdav.port || 12345;
          const host = status.config.webdav.host || 'localhost';
          setLocalPort(String(port));
          setDavUrl(`dav://${host}:${port}`);
        }
      } catch (err) {
        console.error('Failed to fetch WebDAV status:', err);
      }
    };

    fetchStatus();

    // Subscribe to config updates
    const unsubscribe = electron.on('config:updated', () => {
      fetchStatus();
    });

    return () => unsubscribe?.();
  }, [electron]);

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
      await electron.invoke<'config:update'>('config:update', { key: 'webdav.port', value: port });
      // Fetch updated status
      const status = await electron.invoke<'webdav:getStatus'>('webdav:getStatus');
      if (status?.config?.webdav) {
        const newPort = status.config.webdav.port || port;
        const host = status.config.webdav.host || 'localhost';
        setLocalPort(String(newPort));
        setDavUrl(`dav://${host}:${newPort}`);
      }
      console.log('Port updated successfully');
    } catch (err) {
      console.error('Failed to set port:', err);
    } finally {
      setIsApplying(false);
    }
  }, [localPort, electron]);

  return (
    <div
      style={{
        marginTop: '16px',
        padding: '12px',
        borderRadius: '4px',
        backgroundColor: '#f5f5f5',
      }}
    >
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
            onChange={(e: ChangeEvent<HTMLInputElement>) => setLocalPort(e.currentTarget.value)}
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
            disabled={isApplying}
            style={{
              padding: '6px 12px',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: '#4CAF50',
              color: 'white',
              cursor: 'pointer',
              opacity: isApplying ? 0.5 : 1,
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
