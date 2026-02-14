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
const VALID_SEND_CHANNELS = ['window:minimize', 'window:maximize', 'window:close'] as const;

/**
 * Valid IPC channels for receive operations (main -> renderer events)
 */
const VALID_RECEIVE_CHANNELS = [
  'webdav:log',
  'webdav:status-changed',
  'webdav:started',
  'webdav:stopped',
  'platform:log',
  'platform:terminated',
  'mount:status',
  'auth:session-expired',
] as const;

type SendChannel = (typeof VALID_SEND_CHANNELS)[number];
type ReceiveChannel = (typeof VALID_RECEIVE_CHANNELS)[number];

// ==========================
// Public TypeScript typings
// ==========================
export interface PlatformAPI {
  os: NodeJS.Platform;
  mountDrive: () => Promise<unknown>;
  unmountDrive: () => Promise<unknown>;
  checkMountStatus: () => Promise<string | null>;
  openInFiles: (path?: string) => Promise<unknown>;
  startServer: (options?: Record<string, unknown>) => Promise<unknown>;
  stopServer: () => Promise<unknown>;
  getServerStatus: () => Promise<unknown>;
}

export interface WebDAVAPI {
  start: (options?: Record<string, unknown>) => Promise<unknown>;
  stop: () => Promise<unknown>;
  getStatus: () => Promise<unknown>;
}

export interface AuthAPI {
  login: (credentials: Record<string, unknown>) => Promise<unknown>;
  submit2FA: (twoFactor: Record<string, unknown>) => Promise<unknown>;
  submitMailboxPassword: (mailbox: Record<string, unknown>) => Promise<unknown>;
  logout: () => Promise<unknown>;
  getStatus: () => Promise<unknown>;
}

export interface ConfigAPI {
  get: () => Promise<unknown>;
  update: (updates: Record<string, unknown>) => Promise<unknown>;
}

export interface EventsAPI {
  on: (channel: ReceiveChannel | string, callback: (...args: unknown[]) => void) => () => void;
  once: (channel: ReceiveChannel | string, callback: (...args: unknown[]) => void) => void;
  off: (channel: ReceiveChannel | string, callback: (...args: unknown[]) => void) => void;
}

export interface ElectronAPI {
  platform: PlatformAPI;
  webdav: WebDAVAPI;
  auth: AuthAPI;
  config: ConfigAPI;
  events: EventsAPI;
  send: (channel: SendChannel, ...args: unknown[]) => void;
}

/**
 * Helper to safely invoke IPC with validation
 */
const safeInvoke = <T = unknown>(channel: string, ...args: unknown[]): Promise<T> => {
  return ipcRenderer.invoke(channel, ...args);
};

/**
 * Exposed API for renderer process
 */
const electronAPI: ElectronAPI = {
  /**
   * Platform service object
   * Exposes host/platform related helper methods expected by renderer
   */
  platform: {
    // low-level OS string for simple checks
    os: process.platform,

    // Mount/unmount and open helpers mapped to platform: IPC channels
    mountDrive: () => safeInvoke('platform:mountDrive'),
    unmountDrive: () => safeInvoke('platform:unmountDrive'),
    checkMountStatus: () => safeInvoke('platform:checkMountStatus'),
    openInFiles: (path?: string) => safeInvoke('platform:openInFiles', path),

    // convenience mappings to webdav lifecycle (if callers use them)
    startServer: (options?: Record<string, unknown>) => safeInvoke('webdav:start', options),
    stopServer: () => safeInvoke('webdav:stop'),
    getServerStatus: () => safeInvoke('webdav:status'),
  },

  /**
   * WebDAV Service API
   */
  webdav: {
    start: (options?: Record<string, unknown>) => safeInvoke('webdav:start', options),
    stop: () => safeInvoke('webdav:stop'),
    getStatus: () => safeInvoke('webdav:status'),
  },

  /**
   * Authentication API
   */
  auth: {
    login: (credentials: Record<string, unknown>) => safeInvoke('auth:login', credentials),
    submit2FA: (twoFactor: Record<string, unknown>) => safeInvoke('auth:submit2FA', twoFactor),
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
    update: (updates: Record<string, unknown>) => safeInvoke('config:update', updates),
  },

  /**
   * Event handling API
   */
  events: {
    on: (channel: ReceiveChannel | string, callback: (...args: unknown[]) => void) => {
      const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
        callback(...args);
      if (VALID_RECEIVE_CHANNELS.includes(channel as ReceiveChannel)) {
        ipcRenderer.on(channel, subscription);
      } else {
        // still allow listening to arbitrary channels if caller knows what they're doing
        ipcRenderer.on(channel, subscription);
      }
      return () => ipcRenderer.removeListener(channel, subscription);
    },

    once: (channel: ReceiveChannel | string, callback: (...args: unknown[]) => void) => {
      ipcRenderer.once(channel, (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
        callback(...args)
      );
    },

    off: (channel: ReceiveChannel | string, callback: (...args: unknown[]) => void) => {
      const wrapper = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
      ipcRenderer.removeListener(channel, wrapper);
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
export type ElectronAPIType = ElectronAPI;

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
