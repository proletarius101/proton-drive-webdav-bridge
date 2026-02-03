import { useEffect, useState, useCallback, useRef } from 'react';
import { useTauri } from '../tauri/TauriProvider.js';

/**
 * Custom hook for Tauri command queries with built-in polling and caching
 * Inspired by React Query patterns, optimized for Tauri IPC
 */
export function useTauriQuery<T>(
  _queryKey: string[],
  queryFn: (invoke: ReturnType<typeof useTauri>['invoke']) => Promise<T>,
  options?: {
    enabled?: boolean;
    refetchInterval?: number;
    staleTime?: number;
    onSuccess?: (data: T) => void;
    onError?: (error: Error) => void;
  }
) {
  const { invoke } = useTauri();
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const cacheRef = useRef<{ timestamp: number; data: T } | null>(null);

  const refetch = useCallback(async () => {
    // Skip if stale time hasn't expired
    if (
      options?.staleTime &&
      cacheRef.current &&
      Date.now() - cacheRef.current.timestamp < options.staleTime
    ) {
      setData(cacheRef.current.data);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const result = await queryFn(invoke);
      setData(result);
      setError(null);
      cacheRef.current = { timestamp: Date.now(), data: result };
      options?.onSuccess?.(result);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      options?.onError?.(error);
    } finally {
      setIsLoading(false);
    }
  }, [invoke, queryFn, options]);

  useEffect(() => {
    if (options?.enabled === false) return;

    // Initial fetch
    refetch();

    // Setup polling if interval is specified
    if (options?.refetchInterval && options.refetchInterval > 0) {
      const intervalId = setInterval(refetch, options.refetchInterval);
      return () => clearInterval(intervalId);
    }
    return undefined;
  }, [refetch, options?.enabled, options?.refetchInterval]);

  return { data, isLoading, error, refetch };
}
