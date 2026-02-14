/**
 * Type definitions for Electron API exposed via preload script
 */

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
  versions?: {
    node: string;
    chrome: string;
    electron: string;
  };
}

export interface WebDAVServiceOptions {
  port?: number;
  host?: string;
  requireAuth?: boolean;
}

export interface ServerStatus {
  running: boolean;
  url?: string;
  error?: string;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface TwoFactorAuth {
  code: string;
}

export interface MailboxPasswordAuth {
  password: string;
}

export interface AuthResult {
  success: boolean;
  requires2FA?: boolean;
  requiresMailboxPassword?: boolean;
  error?: string;
  sessionData?: unknown;
}

export interface AuthStatus {
  isAuthenticated: boolean;
  username?: string;
}

export interface AppConfig {
  port?: number;
  host?: string;
  requireAuth?: boolean;
  debug?: boolean;
  [key: string]: unknown;
}

export type ConfigUpdate = Partial<AppConfig>;

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
