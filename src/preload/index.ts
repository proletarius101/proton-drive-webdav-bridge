/**
 * Proton Drive WebDAV Bridge - Electron Preload Script
 *
 * Exposes a secure, minimal API surface to the renderer process using contextBridge.
 * All IPC communication must go through this preload script.
 */

import { contextBridge, ipcRenderer } from 'electron';

// Type definitions for the exposed API
export interface WebDAVServiceAPI {
  start: (options?: WebDAVServiceOptions) => Promise<ServerStatus>;
  stop: () => Promise<ServerStatus>;
  getStatus: () => Promise<ServerStatus>;
}

export interface AuthAPI {
  login: (credentials: LoginCredentials) => Promise<AuthResult>;
  submit2FA: (twoFactor: TwoFactorAuth) => Promise<AuthResult>;
  submitMailboxPassword: (mailbox: MailboxPasswordAuth) => Promise<AuthResult>;
  logout: () => Promise<{ success: boolean; error?: string }>;
  getStatus: () => Promise<AuthStatus>;
}

export interface ConfigAPI {
  get: () => Promise<AppConfig>;
  update: (updates: ConfigUpdate) => Promise<{ success: boolean; error?: string }>;
}

export interface LogAPI {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

export interface EventAPI {
  on: (channel: string, listener: (...args: unknown[]) => void) => void;
  once: (channel: string, listener: (...args: unknown[]) => void) => void;
  off: (channel: string, listener: (...args: unknown[]) => void) => void;
}

export interface ElectronAPI {
  webdav: WebDAVServiceAPI;
  auth: AuthAPI;
  config: ConfigAPI;
  log: LogAPI;
  events: EventAPI;
  send: (channel: string, ...args: unknown[]) => void;
  platform: NodeJS.Platform;
  versions: {
    node: string;
    chrome: string;
    electron: string;
  };
}

// Type imports (these should match your service types)
interface WebDAVServiceOptions {
  port?: number;
  host?: string;
  requireAuth?: boolean;
}

interface ServerStatus {
  running: boolean;
  url?: string;
  error?: string;
}

interface LoginCredentials {
  username: string;
  password: string;
}

interface TwoFactorAuth {
  code: string;
}

interface MailboxPasswordAuth {
  password: string;
}

interface AuthResult {
  success: boolean;
  requires2FA?: boolean;
  requiresMailboxPassword?: boolean;
  error?: string;
  sessionData?: unknown;
}

interface AuthStatus {
  isAuthenticated: boolean;
  username?: string;
}

interface AppConfig {
  port?: number;
  host?: string;
  requireAuth?: boolean;
  debug?: boolean;
  [key: string]: unknown;
}

type ConfigUpdate = Partial<AppConfig>;

/**
 * Expose the API to the renderer process
 */
contextBridge.exposeInMainWorld('electron', {
  // WebDAV service
  webdav: {
    start: (options?: WebDAVServiceOptions) => ipcRenderer.invoke('webdav:start', options),
    stop: () => ipcRenderer.invoke('webdav:stop'),
    getStatus: () => ipcRenderer.invoke('webdav:status'),
  },

  // Authentication
  auth: {
    login: (credentials: LoginCredentials) => ipcRenderer.invoke('auth:login', credentials),
    submit2FA: (twoFactor: TwoFactorAuth) => ipcRenderer.invoke('auth:submit2fa', twoFactor),
    submitMailboxPassword: (mailbox: MailboxPasswordAuth) =>
      ipcRenderer.invoke('auth:submitMailboxPassword', mailbox),
    logout: () => ipcRenderer.invoke('auth:logout'),
    getStatus: () => ipcRenderer.invoke('auth:status'),
  },

  // Configuration
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    update: (updates: ConfigUpdate) => ipcRenderer.invoke('config:update', updates),
  },

  // Logging (one-way to main)
  log: {
    debug: (message: string, ...args: unknown[]) => {
      ipcRenderer.send('log:message', 'debug', message, ...args);
    },
    info: (message: string, ...args: unknown[]) => {
      ipcRenderer.send('log:message', 'info', message, ...args);
    },
    warn: (message: string, ...args: unknown[]) => {
      ipcRenderer.send('log:message', 'warn', message, ...args);
    },
    error: (message: string, ...args: unknown[]) => {
      ipcRenderer.send('log:message', 'error', message, ...args);
    },
  },

  // Event helpers (main -> renderer)
  events: {
    on: (channel: string, callback: (...args: unknown[]) => void) => {
      ipcRenderer.on(channel, (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args));
    },
    once: (channel: string, callback: (...args: unknown[]) => void) => {
      ipcRenderer.once(channel, (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args));
    },
    off: (channel: string, callback: (...args: unknown[]) => void) => {
      ipcRenderer.removeListener(channel, (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args));
    },
  },

  // One-way send to main
  send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),

  // Platform info
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron || 'unknown',
  },
} satisfies ElectronAPI);

// Extend Window interface for TypeScript
declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
