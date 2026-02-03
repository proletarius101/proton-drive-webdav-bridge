import { useState, useCallback } from 'react';
import { useTauriQuery } from './useTauriQuery.js';
import { useTauriEvent } from './useTauriEvent.js';
import { useTauri } from '../tauri/TauriProvider.js';

/**
 * Hook for managing mount/unmount operations with retry logic
 * Handles GIO timing issues on Linux
 */
export function useMountStatus(options?: { mountRetryDelayMs?: number; mountMaxRetries?: number }) {
  const { invoke } = useTauri();
  const [isToggling, setIsToggling] = useState(false);

  const retryDelayMs = options?.mountRetryDelayMs ?? 1500;
  const maxRetries = options?.mountMaxRetries ?? 8;

  // Poll mount status
  const { data: mountStatus, refetch: refetchMountStatus } = useTauriQuery<string | null>(
    ['mount', 'status'],
    async (invoke) => {
      return invoke<string | null>('check_mount_status');
    },
    { refetchInterval: 3000 }
  );

  // Listen for mount events from sidecar
  useTauriEvent<string>('mount:status', (payload) => {
    console.log('[Mount] Status event:', payload);
    refetchMountStatus();
  });

  const isMounted = mountStatus !== null;

  /**
   * Toggle mount state with retry logic
   * Handles transient GIO errors gracefully
   */
  const toggleMount = useCallback(
    async (shouldMount: boolean) => {
      setIsToggling(true);

      try {
        // Issue the command (may fail transiently)
        try {
          await invoke(shouldMount ? 'mount_drive' : 'unmount_drive');
        } catch (err) {
          console.warn(
            `${shouldMount ? 'mount' : 'unmount'} command returned error, verifying actual state:`,
            err
          );
        }

        // Verify actual mount state with retries
        let actualMountStatus: string | null = null;
        let lastError: Error | null = null;

        for (let i = 0; i < maxRetries; i++) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));

          try {
            actualMountStatus = await invoke<string | null>('check_mount_status');
            const actualIsMounted = actualMountStatus !== null;

            // Success: state matches desired state
            if (actualIsMounted === shouldMount) {
              console.info(`Mount status verified: ${shouldMount ? 'mounted' : 'unmounted'}`);
              break;
            }

            // Track error if last retry and mismatch
            if (i === maxRetries - 1) {
              lastError = new Error(
                `Mount status mismatch: expected ${shouldMount ? 'mounted' : 'unmounted'}, ` +
                  `got ${actualIsMounted ? 'mounted' : 'unmounted'}`
              );
            }
          } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            console.warn(`Mount status check attempt ${i + 1}/${maxRetries} failed:`, err);
          }
        }

        // Refresh UI with final state
        await refetchMountStatus();

        // Log persistent errors for debugging
        if (lastError) {
          console.warn('Mount operation completed with status:', {
            requested: shouldMount,
            actual: actualMountStatus !== null,
            error: lastError.message,
          });
        }
      } catch (err) {
        console.error('mount action failed with unexpected error:', err);

        // Try to determine actual state before reverting UI
        try {
          await invoke<string | null>('check_mount_status');
          // UI will update via refetchMountStatus below
        } catch (statusErr) {
          console.error('Failed to check final mount status:', statusErr);
        }

        await refetchMountStatus();
      } finally {
        setIsToggling(false);
      }
    },
    [invoke, maxRetries, retryDelayMs, refetchMountStatus]
  );

  return {
    isMounted,
    isToggling,
    toggleMount,
    refetch: refetchMountStatus,
  };
}
