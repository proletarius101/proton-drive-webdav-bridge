/**
 * Electron Preload Script
 * 
 * This script runs in the renderer process before the web page loads.
 * It exposes a secure API to the renderer via contextBridge.
 */

import { contextBridge, ipcRenderer } from 'electron';

console.log('[Preload] Preload script starting...');

/**
 * Valid IPC channels for send operations (one-way)
 */
const VALID_SEND_CHANNELS = [
  'window:minimize',
  'window:maximize',
  'window:close',
] as const;

/**
 * Valid IPC channels for receive operations (main -> renderer events)
 */
const VALID_RECEIVE_CHANNELS = [
  'webdav:log',
  'webdav:status-changed',
  'auth:session-expired',
] as const;

type SendChannel = (typeof VALID_SEND_CHANNELS)[number];
type ReceiveChannel = (typeof VALID_RECEIVE_CHANNELS)[number];

/**
 * Helper to safely invoke IPC with validation
 */
const safeInvoke = <T = unknown>(channel: string, ...args: unknown[]): Promise<T> => {
  return ipcRenderer.invoke(channel, ...args);
};

/**
 * Exposed API for renderer process
 */
const electronAPI = {
  /**
   * Platform information
   */
  platform: process.platform,

  /**
   * WebDAV Service API
   */
  webdav: {
    start: (options?: Record<string, unknown>) =>
      safeInvoke('webdav:start', options),
    stop: () => safeInvoke('webdav:stop'),
    getStatus: () => safeInvoke('webdav:status'),
  },

  /**
   * Authentication API
   */
  auth: {
    login: (credentials: Record<string, unknown>) =>
      safeInvoke('auth:login', credentials),
    submit2FA: (twoFactor: Record<string, unknown>) =>
      safeInvoke('auth:submit2FA', twoFactor),
    submitMailboxPassword: (mailbox: Record<string, unknown>) =>
      safeInvoke('auth:submitMailboxPassword', mailbox),
    logout: () => safeInvoke('auth:logout'),
    getStatus: () => safeInvoke('auth:check'),
  },

  /**
   * Configuration API
   */
  config: {
    get: () => safeInvoke('config:get'),
    update: (updates: Record<string, unknown>) =>
      safeInvoke('config:update', updates),
  },

  /**
   * Event handling API
   */
  events: {
    on: (channel: string, callback: (...args: unknown[]) => void) => {
      if (VALID_RECEIVE_CHANNELS.includes(channel as ReceiveChannel)) {
        const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
          callback(...args);
        ipcRenderer.on(channel, subscription);
        return () => {
          ipcRenderer.removeListener(channel, subscription);
        };
      }
      return () => {};
    },

    once: (channel: string, callback: (...args: unknown[]) => void) => {
      if (VALID_RECEIVE_CHANNELS.includes(channel as ReceiveChannel)) {
        ipcRenderer.once(channel, (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
          callback(...args)
        );
      }
    },

    off: (channel: string, callback: (...args: unknown[]) => void) => {
      if (VALID_RECEIVE_CHANNELS.includes(channel as ReceiveChannel)) {
        ipcRenderer.removeListener(channel, (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
          callback(...args)
        );
      }
    },
  },

  /**
   * Send one-way message to main process
   */
  send: (channel: SendChannel, ...args: unknown[]) => {
    if (VALID_SEND_CHANNELS.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    }
  },
};

/**
 * Type for the exposed API
 */
export type ElectronAPI = typeof electronAPI;

/**
 * Expose the API to the renderer process
 * Using contextBridge for security (context isolation)
 */
console.log('[Preload] Exposing electron via contextBridge...');
try {
  contextBridge.exposeInMainWorld('electron', electronAPI);
  console.log('[Preload] Preload script complete. window.electron is now available.');
} catch (error) {
  console.error('[Preload] Error exposing API:', error);
  throw error;
}
