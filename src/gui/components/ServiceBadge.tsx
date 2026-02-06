import { useServiceStatus } from '../hooks/useServiceStatus.js';

/**
 * Service status badge component
 * Shows running/connecting/stopped states with color coding
 */
export function ServiceBadge() {
  const { isRunning, status, isLoading } = useServiceStatus();

  const getStatus = () => {
    if (isLoading) return { state: 'connecting', label: 'Loading...' };
    if (isRunning) return { state: 'active', label: 'Active' };
    if (status?.connecting) return { state: 'connecting', label: 'Connecting' };
    return { state: 'stopped', label: 'Stopped' };
  };

  const { state, label } = getStatus();

  return (
    <div
      id="service-badge"
      className={`badge ${state}`}
      style={{
        padding: '8px 12px',
        borderRadius: '4px',
        fontWeight: 600,
        fontSize: '14px',
        backgroundColor:
          state === 'active'
            ? '#4CAF50'
            : state === 'connecting'
              ? '#FFC107'
              : '#F44336',
        color: 'white',
      }}
    >
      {label}
    </div>
  );
}
