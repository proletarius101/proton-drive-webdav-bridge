/**
 * Proton Drive WebDAV Bridge - Electron Provider
 *
 * React context provider for Electron IPC communication.
 * Includes debugging for IPC issues.
 */

import React, { createContext, useCallback, useContext } from 'react';
import type { InvokeFn, OnFn } from '../../ipc/types.js';

interface ElectronContextType {
  // Strongly-typed invoke/on using the central IPC contract (InvokeFn/OnFn)
  invoke: InvokeFn;
  send: (channel: string, ...args: unknown[]) => void;
  on: OnFn;
  once: OnFn;
}

const ElectronContext = createContext<ElectronContextType | undefined>(undefined);

interface ElectronProviderProps {
  children: React.ReactNode;
}

/**
 * Provider component for Electron IPC
 */
export function ElectronProvider({ children }: ElectronProviderProps) {
  // Map to keep wrapper listeners so we can correctly remove them later.
  // Keyed by channel, then by original listener -> wrapper function
  type AnyListener = (data: unknown) => void;
  type WrapperFn = (...args: unknown[]) => void;
  const listenerMap = React.useRef(new Map<string, Map<AnyListener, WrapperFn>>());

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

    // Wrap listener to match underlying signature (...args: unknown[])
    const wrapper = (...args: unknown[]) => {
      try {
        // forward first argument as the data payload
        (listener as (data: unknown) => void)(args[0]);
      } catch (e) {
        // swallow errors from listener
        console.error('[IPC] Listener threw error', e);
      }
    };

    // store wrapper so we can remove it later
    const channelMap = listenerMap.current.get(channel) ?? new Map<AnyListener, WrapperFn>();
    channelMap.set(listener as AnyListener, wrapper);
    listenerMap.current.set(channel, channelMap);

    window.electron.events.on(channel, wrapper);
    return () => {
      if (window.electron?.events?.off) {
        const stored = listenerMap.current.get(channel)?.get(listener as AnyListener);
        if (stored) {
          window.electron.events.off(channel, stored);
          listenerMap.current.get(channel)?.delete(listener as AnyListener);
        }
      }
    };
  }, []);

  const once = useCallback<ElectronContextType['once']>((channel, listener) => {
    if (typeof window === 'undefined' || !window.electron?.events?.once) {
      console.warn(`[IPC] once not available for: ${channel}`);
      return () => {};
    }
    const wrapper: WrapperFn = (...args: unknown[]) => {
      try {
        (listener as (data: unknown) => void)(args[0]);
      } catch (e) {
        console.error('[IPC] Listener threw error', e);
      }
    };
    window.electron.events.once(channel, wrapper);
    return () => {};
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
