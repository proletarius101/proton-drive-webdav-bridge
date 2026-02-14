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
  'webdav:error',
  'platform:log',
  'platform:terminated',
  'mount:status',
  'auth:session-expired',
  'auth:login-success',
  'auth:logout-success',
  'account:updated',
  'config:updated',
  'app:log',
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
 * Helper to safely invoke IPC with validation and error handling
 */
const safeInvoke = async <T = unknown>(channel: string, ...args: unknown[]): Promise<T> => {
  try {
    console.log(`[Preload:IPC] invoke('${channel}')`, { argsCount: args.length });
    const result = await ipcRenderer.invoke(channel, ...args);
    console.log(`[Preload:IPC] result for '${channel}'`);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Preload:IPC] Error invoking '${channel}':`, message);
    throw error;
  }
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
   * Enforces strict channel allowlisting for security
   */
  events: {
    on: (channel: ReceiveChannel | string, callback: (...args: unknown[]) => void) => {
      // SECURITY: Enforce channel allowlist
      if (!VALID_RECEIVE_CHANNELS.includes(channel as ReceiveChannel)) {
        throw new Error(
          `[Security] Invalid channel: '${channel}'. Allowed channels: ${VALID_RECEIVE_CHANNELS.join(', ')}`
        );
      }

      const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
        try {
          callback(...args);
        } catch (error) {
          console.error(`[Preload:IPC] Listener error for '${channel}':`, error);
        }
      };
      ipcRenderer.on(channel, subscription);

      return () => {
        console.log(`[Preload:IPC] Unsubscribing from '${channel}'`);
        ipcRenderer.removeListener(channel, subscription);
      };
    },

    once: (channel: ReceiveChannel | string, callback: (...args: unknown[]) => void) => {
      // SECURITY: Enforce channel allowlist
      if (!VALID_RECEIVE_CHANNELS.includes(channel as ReceiveChannel)) {
        throw new Error(
          `[Security] Invalid channel: '${channel}'. Allowed channels: ${VALID_RECEIVE_CHANNELS.join(', ')}`
        );
      }

      ipcRenderer.once(channel, (_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
        try {
          callback(...args);
        } catch (error) {
          console.error(`[Preload:IPC] Listener error for '${channel}':`, error);
        }
      });
    },

    off: (_channel: ReceiveChannel | string, _callback: (...args: unknown[]) => void) => {
      // SECURITY: Enforce channel allowlist
      if (!VALID_RECEIVE_CHANNELS.includes(_channel as ReceiveChannel)) {
        throw new Error(
          `[Security] Invalid channel: '${_channel}'. Allowed channels: ${VALID_RECEIVE_CHANNELS.join(', ')}`
        );
      }

      // Note: ipcRenderer.off uses a wrapper comparison, so listeners should be unsubscribed
      // via the returned unsubscribe function from on() for best results
      console.log(`[Preload:IPC] Removing listener for '${_channel}'`);
      ipcRenderer.removeAllListeners(_channel);
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
