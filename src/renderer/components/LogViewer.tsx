import { useState, useEffect } from 'react';
import { useElectron } from '../electron/ElectronProvider.js';

/**
 * Log viewer component
 * Displays application logs in real-time
 */
export function LogViewer() {
  const [logs, setLogs] = useState<string>('');
  const [isHidden, setIsHidden] = useState(true);
  const electron = useElectron();

  useEffect(() => {
    // Listen for log events
    const unsubscribeLogs = electron.on('app:log', (data: any) => {
      const level = data?.level ?? 'info';
      const message = String(data?.message ?? '').replace(/\n$/, '');
      setLogs((prev) => `${prev}[${level}] ${message}\n`);
    });

    // Listen for WebDAV errors
    const unsubscribeError = electron.on('webdav:error', (error: any) => {
      const message = error?.message || String(error);
      setLogs((prev) => `${prev}[error] ${message}\n`);
    });

    return () => {
      unsubscribeLogs?.();
      unsubscribeError?.();
    };
  }, [electron]);

  // Auto-scroll to bottom
  useEffect(() => {
    const logArea = document.getElementById('log-area') as HTMLPreElement | null;
    if (logArea) {
      logArea.scrollTop = logArea.scrollHeight;
    }
  }, [logs]);

  return (
    <div style={{ marginTop: '16px' }}>
      <button
        id="toggle-log"
        onClick={() => setIsHidden(!isHidden)}
        style={{
          padding: '6px 12px',
          borderRadius: '4px',
          border: 'none',
          backgroundColor: '#666',
          color: 'white',
          cursor: 'pointer',
        }}
      >
        {isHidden ? 'Show Logs' : 'Hide Logs'}
      </button>

      <pre
        id="log-area"
        className={isHidden ? 'hidden' : ''}
        style={{
          display: isHidden ? 'none' : 'block',
          marginTop: '8px',
          padding: '8px',
          borderRadius: '4px',
          backgroundColor: '#1e1e1e',
          color: '#d4d4d4',
          fontSize: '12px',
          maxHeight: '300px',
          overflowY: 'auto',
          fontFamily: 'monospace',
        }}
      >
        {logs || 'No logs yet...'}
      </pre>
    </div>
  );
}
