import { useState, useEffect, useCallback, useRef } from 'react';
import { useElectron } from '../electron/ElectronProvider.js';

export function useMountStatus(options?: { mountRetryDelayMs?: number; mountMaxRetries?: number }) {
  const electron = useElectron();
  const [isMounted, setIsMounted] = useState<boolean>(false);
  const [isToggling, setIsToggling] = useState<boolean>(false);
  const mountedRef = useRef(isMounted);

  const mountRetryDelayMs = options?.mountRetryDelayMs ?? 1000;
  const mountMaxRetries = options?.mountMaxRetries ?? 5;

  useEffect(() => {
    mountedRef.current = isMounted;
  }, [isMounted]);

  // Initial check of mount status
  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const res = await electron.invoke('check_mount_status');
        // check_mount_status returns mount point string or null
        if (cancelled) return;
        setIsMounted(Boolean(res));
      } catch (err) {
        console.error('Failed to check mount status:', err);
        if (cancelled) return;
        setIsMounted(false);
      }
    };

    check();

    return () => {
      cancelled = true;
    };
  }, [electron]);

  const toggleMount = useCallback(
    async (shouldMount: boolean) => {
      setIsToggling(true);

      if (shouldMount) {
        try {
          await electron.invoke('mount_drive');
          // If mount_drive resolves, assume mounted
          setIsMounted(true);
        } catch {
          // On error, poll check_mount_status until mounted or max retries
          for (let i = 0; i < mountMaxRetries; i++) {
            try {
              // wait
              await new Promise((r) => setTimeout(r, mountRetryDelayMs));
              const res = await electron.invoke('check_mount_status');
              if (res) {
                setIsMounted(true);
                break;
              }
            } catch (pollErr) {
              console.error('Error while polling mount status:', pollErr);
            }
          }
        } finally {
          setIsToggling(false);
        }
      } else {
        try {
          await electron.invoke('unmount_drive');
          setIsMounted(false);
        } catch (err) {
          console.error('Failed to unmount drive:', err);
        } finally {
          setIsToggling(false);
        }
      }
    },
    [electron, mountMaxRetries, mountRetryDelayMs]
  );

  return { isMounted, isToggling, toggleMount };
}
