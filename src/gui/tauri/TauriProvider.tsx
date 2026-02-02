import React, { createContext, useContext } from 'react';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';

export type TauriApi = {
  invoke: (cmd: string, args?: any) => Promise<any>;
  listen: (event: string, handler: any) => Promise<() => void>;
};

const defaultApi: TauriApi = {
  invoke: tauriInvoke as unknown as (cmd: string, args?: any) => Promise<any>,
  listen: tauriListen as unknown as (event: string, handler: any) => Promise<() => void>,
};

const TauriContext = createContext<TauriApi>(defaultApi);

export function TauriProvider({ children, invoke, listen }: {
  children?: React.ReactNode;
  invoke?: TauriApi['invoke'];
  listen?: TauriApi['listen'];
}) {
  const api: TauriApi = {
    invoke: invoke ?? defaultApi.invoke,
    listen: listen ?? defaultApi.listen,
  };
  return <TauriContext.Provider value={api}>{children}</TauriContext.Provider>;
}

export function useTauri() {
  return useContext(TauriContext);
}
