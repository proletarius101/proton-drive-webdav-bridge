import { useServiceStatus } from '../hooks/useServiceStatus.js';

/**
 * Storage quota display component
 * Shows used/total storage with progress bar
 */
export function StorageQuota() {
  const { storage, quotaPercent, isLoading } = useServiceStatus();

  if (isLoading) {
    return (
      <div>
        <p>Loading storage...</p>
      </div>
    );
  }

  if (!storage) {
    return (
      <div>
        <p id="quota-text">--</p>
      </div>
    );
  }

  return (
    <div style={{ marginTop: '16px' }}>
      <progress
        id="quota-bar"
        value={quotaPercent}
        max={100}
        style={{
          width: '100%',
          height: '8px',
          borderRadius: '4px',
        }}
      />
      <p id="quota-text" style={{ marginTop: '8px', fontSize: '12px' }}>
        {storage.formattedUsed} / {storage.formattedTotal} ({quotaPercent}%)
      </p>
    </div>
  );
}
