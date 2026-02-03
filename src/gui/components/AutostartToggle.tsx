import { useAutostart } from '../hooks/useAutostart.js';

/**
 * Autostart toggle component
 * Manages application autostart on system startup
 */
export function AutostartToggle() {
  const { isEnabled, isLoading, setAutostart } = useAutostart();

  const handleToggle = async (on: boolean) => {
    try {
      await setAutostart(on);
    } catch (err) {
      console.error('Failed to toggle autostart:', err);
    }
  };

  return (
    <div style={{ marginTop: '16px', padding: '12px', borderRadius: '4px', backgroundColor: '#f5f5f5' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input
          id="autostart-toggle"
          type="checkbox"
          checked={isEnabled}
          onChange={(e) => handleToggle(e.target.checked)}
          disabled={isLoading}
        />
        <span>Start on Boot</span>
      </label>
    </div>
  );
}
