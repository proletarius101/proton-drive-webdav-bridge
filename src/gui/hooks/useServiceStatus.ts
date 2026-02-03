import { useCallback } from 'react';
import { useTauriQuery } from './useTauriQuery.js';
import { useTauriEvent } from './useTauriEvent.js';

/**
 * Service status interface from Tauri sidecar
 */
export interface ServiceStatus {
  running?: boolean;
  connecting?: boolean;
  server?: {
    running: boolean;
    url?: string;
  };
  storage?: {
    used: number;
    total: number;
  };
  config?: {
    webdav?: {
      host: string;
      port: number;
    };
  };
  liveStatusString?: string;
  port?: number;
}

/**
 * Hook for polling and listening to service status
 * Automatically handles sidecar lifecycle events
 */
export function useServiceStatus(options?: { refetchInterval?: number }) {
  const refetchInterval = options?.refetchInterval ?? 3000;

  const {
    data: status,
    isLoading,
    error,
    refetch,
  } = useTauriQuery<ServiceStatus>(
    ['service', 'status'],
    async (invoke) => {
      return invoke<ServiceStatus>('get_status');
    },
    {
      refetchInterval,
      onError: (err) => {
        console.error('Failed to fetch service status:', err);
      },
    }
  );

  // Listen for sidecar termination and refresh status
  useTauriEvent('sidecar:terminated', () => {
    console.log('Sidecar terminated, refreshing status');
    refetch();
  });

  // Computed properties for easier component usage
  const isRunning = status?.server?.running ?? status?.running ?? false;
  const quotaPercent =
    status?.storage?.total && status.storage.total > 0
      ? Math.round((status.storage.used / status.storage.total) * 100)
      : 0;

  const formatBytes = useCallback((bytes: number) => {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  }, []);

  return {
    status,
    isRunning,
    isLoading,
    error,
    storage: status?.storage
      ? {
          used: status.storage.used,
          total: status.storage.total,
          formattedUsed: formatBytes(status.storage.used),
          formattedTotal: formatBytes(status.storage.total),
        }
      : null,
    quotaPercent,
    url: status?.server?.url,
    refetch,
  };
}
