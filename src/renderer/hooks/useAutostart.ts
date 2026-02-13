import { useState, useEffect, useCallback } from 'react';
import { useElectron } from '../electron/ElectronProvider.js';

/**
 * Hook for managing system autostart
 * Uses Electron's app.setLoginItemSettings() via IPC
 */
export function useAutostart() {
  const electron = useElectron();
  const [isEnabled, setIsEnabled] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Load initial state
  useEffect(() => {
    const initAutostart = async () => {
      try {
        setIsLoading(true);

        // Get autostart state from main process
        try {
          const enabled = await electron.invoke('config:get', { key: 'autostart' });
          setIsEnabled(!!enabled);
          setError(null);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          console.error('Failed to load autostart state:', error);
          setError(error);
          setIsEnabled(false);
        }
      } finally {
        setIsLoading(false);
      }
    };

    initAutostart();
  }, [electron]);

  /**
   * Toggle autostart via Electron app.setLoginItemSettings()
   */
  const setAutostart = useCallback(
    async (enabled: boolean) => {
      const prevState = isEnabled;

      try {
        setIsLoading(true);

        // Update autostart via IPC
        try {
          await electron.invoke('config:update', { key: 'autostart', value: enabled });
        } catch (err) {
          console.error('Failed to persist autostart state:', err);
          // Revert UI if persistence fails
          setIsEnabled(prevState);
          throw err;
        }

        // Success
        setIsEnabled(enabled);
        setError(null);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error('Failed to toggle autostart:', error);
        setError(error);
        // UI reverted to previous state above
      } finally {
        setIsLoading(false);
      }
    },
    [electron, isEnabled]
  );

  return {
    isEnabled: isEnabled ?? false,
    isLoading,
    error,
    setAutostart,
  };
}
