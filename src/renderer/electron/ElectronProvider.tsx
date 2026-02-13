/**
 * Proton Drive WebDAV Bridge - Electron Provider
 *
 * React context provider for Electron IPC communication.
 * Includes debugging for IPC issues.
 */

import React, { createContext, useCallback, useContext } from 'react';

interface ElectronContextType {
  invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>;
  send: (channel: string, ...args: unknown[]) => void;
  on: (channel: string, listener: (data: unknown) => void) => () => void;
  once: (channel: string, listener: (data: unknown) => void) => void;
}

const ElectronContext = createContext<ElectronContextType | undefined>(undefined);

interface ElectronProviderProps {
  children: React.ReactNode;
}

/**
 * Provider component for Electron IPC
 */
export function ElectronProvider({ children }: ElectronProviderProps) {
  // Debug on mount
  React.useEffect(() => {
    console.log('[ElectronProvider] Mounted');
    console.log('[ElectronProvider] window.electron exists:', !!window.electron);
    console.log('[ElectronProvider] window.electron.auth exists:', !!window.electron?.auth);
  }, []);

  const invoke: ElectronContextType['invoke'] = useCallback(async (channel, ...args) => {
    console.log(`[IPC] invoke('${channel}')`, { args });

    if (typeof window === 'undefined') {
      console.error('[IPC] window is undefined');
      throw new Error('Window not available');
    }

    if (!window.electron) {
      console.error('[IPC] window.electron is undefined');
      throw new Error('Electron API not available');
    }

    const [service, method] = channel.split(':');
    if (!service || !method) {
      throw new Error(`Invalid channel: ${channel}`);
    }

    const api = window.electron[service as keyof typeof window.electron];
    if (!api || typeof api !== 'object') {
      console.error(`[IPC] Service not found: ${service}`, {
        available: Object.keys(window.electron),
      });
      throw new Error(`Service not available: ${service}`);
    }

    const methodFn = (api as Record<string, unknown>)[method];
    if (typeof methodFn !== 'function') {
      console.error(`[IPC] Method not found: ${service}.${method}`);
      throw new Error(`Method not available: ${service}.${method}`);
    }

    console.log(`[IPC] Calling ${service}.${method}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return methodFn(...args) as any;
  }, []);

  const send = useCallback<ElectronContextType['send']>((channel, ...args) => {
    if (typeof window === 'undefined' || !window.electron?.send) {
      console.warn(`[IPC] send not available for: ${channel}`);
      return;
    }
    window.electron.send(channel, ...args);
  }, []);

  const on = useCallback<ElectronContextType['on']>((channel, listener) => {
    if (typeof window === 'undefined' || !window.electron?.events?.on) {
      console.warn(`[IPC] on not available for: ${channel}`);
      return () => {};
    }

    window.electron.events.on(channel, listener);
    return () => {
      if (window.electron?.events?.off) {
        window.electron.events.off(channel, listener);
      }
    };
  }, []);

  const once = useCallback<ElectronContextType['once']>((channel, listener) => {
    if (typeof window === 'undefined' || !window.electron?.events?.once) {
      console.warn(`[IPC] once not available for: ${channel}`);
      return;
    }
    window.electron.events.once(channel, listener);
  }, []);

  const value: ElectronContextType = { invoke, send, on, once };
  return <ElectronContext.Provider value={value}>{children}</ElectronContext.Provider>;
}

export function useElectron(): ElectronContextType {
  const context = useContext(ElectronContext);
  if (!context) {
    throw new Error('useElectron must be used within ElectronProvider');
  }
  return context;
}
