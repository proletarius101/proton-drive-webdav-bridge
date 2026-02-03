import { useEffect, useCallback } from 'react';
import { useTauri } from '../tauri/TauriProvider.js';

/**
 * Custom hook for Tauri event listeners with automatic cleanup
 * Prevents memory leaks by unlistening on component unmount
 */
export function useTauriEvent<T = unknown>(
  eventName: string,
  handler: (payload: T) => void,
  options?: {
    enabled?: boolean;
  }
) {
  const { listen } = useTauri();

  // Wrap handler to be stable across re-renders
  const stableHandler = useCallback(handler, [handler]);

  useEffect(() => {
    if (options?.enabled === false) return;

    let unlisten: (() => void) | null = null;

    const setupListener = async () => {
      try {
        unlisten = await listen<T>(eventName, (event) => {
          stableHandler(event.payload);
        });
      } catch (err) {
        console.error(`Failed to listen to event '${eventName}':`, err);
      }
    };

    setupListener();

    // ✅ Critical cleanup: prevent memory leaks
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [eventName, stableHandler, options?.enabled, listen]);
}
