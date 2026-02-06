import { useState, useEffect, useCallback } from 'react';
import {
  enable as autostartEnable,
  isEnabled as autostartIsEnabled,
  disable as autostartDisable,
} from '@tauri-apps/plugin-autostart';
import { useTauri } from '../tauri/TauriProvider.js';

/**
 * Hook for managing system autostart
 * Handles both plugin API and backend persistence
 */
export function useAutostart() {
  const { invoke } = useTauri();
  const [isEnabled, setIsEnabled] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Load initial state
  useEffect(() => {
    const initAutostart = async () => {
      try {
        setIsLoading(true);

        // Try native plugin first
        try {
          const enabled = await autostartIsEnabled();
          setIsEnabled(enabled);
          setError(null);
          return;
        } catch (pluginErr) {
          console.debug('Autostart plugin unavailable, using backend persistence:', pluginErr);
        }

        // Fallback: backend persistence
        try {
          const persisted = await invoke<boolean>('get_autostart');
          setIsEnabled(!!persisted);
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
  }, [invoke]);

  /**
   * Toggle autostart with system API and backend fallback
   */
  const setAutostart = useCallback(
    async (enabled: boolean) => {
      const prevState = isEnabled;

      try {
        setIsLoading(true);

        // Apply system autostart
        try {
          if (enabled) {
            await autostartEnable();
          } else {
            await autostartDisable();
          }
        } catch (pluginErr) {
          console.debug('Autostart plugin unavailable, using backend only:', pluginErr);
        }

        // Persist to backend
        try {
          await invoke('set_autostart', { enabled });
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
    [invoke, isEnabled]
  );

  return {
    isEnabled: isEnabled ?? false,
    isLoading,
    error,
    setAutostart,
  };
}
