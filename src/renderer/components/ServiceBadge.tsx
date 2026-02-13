import { useState, useEffect } from 'react';
import { useElectron } from '../electron/ElectronProvider.js';

/**
 * Service status badge component
 * Shows running/connecting/stopped states with color coding
 */
export function ServiceBadge() {
  const [status, setStatus] = useState<'active' | 'connecting' | 'stopped'>('stopped');
  const [isLoading, setIsLoading] = useState(true);
  const electron = useElectron();

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const result = await electron.invoke<'webdav:getStatus'>('webdav:getStatus');
        setStatus((result as any)?.running ? 'active' : 'stopped');
      } catch (err) {
        console.error('Failed to get WebDAV status:', err);
        setStatus('stopped');
      } finally {
        setIsLoading(false);
      }
    };

    fetchStatus();

    // Listen for status changes
    const unsubscribeStarted = electron.on('webdav:started', () => {
      setStatus('active');
    });

    const unsubscribeStopped = electron.on('webdav:stopped', () => {
      setStatus('stopped');
    });

    return () => {
      unsubscribeStarted?.();
      unsubscribeStopped?.();
    };
  }, [electron]);

  const getStatusLabel = () => {
    if (isLoading) return 'Loading...';
    if (status === 'active') return 'Active';
    if (status === 'connecting') return 'Connecting';
    return 'Stopped';
  };

  return (
    <div
      id="service-badge"
      className={`badge ${status}`}
      style={{
        padding: '8px 12px',
        borderRadius: '4px',
        fontWeight: 600,
        fontSize: '14px',
        backgroundColor:
          status === 'active' ? '#4CAF50' : status === 'connecting' ? '#FFC107' : '#F44336',
        color: 'white',
      }}
    >
      {getStatusLabel()}
    </div>
  );
}
