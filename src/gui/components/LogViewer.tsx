import { useState, useEffect } from 'react';
import { useTauriEvent } from '../hooks/useTauriEvent.js';

/**
 * Log viewer component
 * Displays sidecar logs and mount status events in real-time
 */
export function LogViewer() {
  const [logs, setLogs] = useState<string>('');
  const [isHidden, setIsHidden] = useState(true);

  // Listen for sidecar logs
  useTauriEvent(
    'sidecar:log',
    (event: { level?: string; message?: string }) => {
      const level = event.level ?? 'info';
      const message = String(event.message ?? '').replace(/\n$/, '');
      setLogs((prev) => `${prev}[${level}] ${message}\n`);
    }
  );

  // Listen for mount status events
  useTauriEvent('mount:status', (payload: string) => {
    const msg = String(payload);
    setLogs((prev) => `${prev}[mount] ${msg}\n`);
  });

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
