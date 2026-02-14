// Central IPC contract: channel -> { req, res }
export interface IPCChannels {
  'auth:getStatus': {
    req: undefined;
    res: {
      authenticated: boolean;
      email?: string;
      username?: string;
      server?: unknown;
      config?: unknown;
      logFile?: string;
    };
  };
  'webdav:getStatus': {
    req: undefined;
    res: { running?: boolean; config?: { webdav?: { host?: string; port?: number } } };
  };
  'config:get': { req: { key: string }; res: unknown };
  'config:update': { req: { key: string; value: unknown }; res: unknown };
  'auth:listAccounts': {
    req: undefined;
    res: Array<{ id: string; email?: string; status?: string }>;
  };
  'auth:getAccount': {
    req: { id: string };
    res: { id: string; email?: string; status?: string } | null;
  };
  'platform:openInFiles': { req: undefined; res: unknown };
  'platform:mountDrive': { req: undefined; res: unknown };
  'platform:checkMountStatus': { req: undefined; res: string | null };
  'platform:unmountDrive': { req: undefined; res: unknown };
  // Events
  'webdav:started': { req: undefined; res: undefined };
  'webdav:stopped': { req: undefined; res: undefined };
  'webdav:error': { req: undefined; res: { message?: string } };
  'app:log': { req: undefined; res: { level?: string; message?: string } };
  'config:updated': { req: undefined; res: { key: string; value: unknown } };
  'auth:login-success': { req: undefined; res: { email?: string } };
  'auth:logout-success': { req: undefined; res: undefined };
  'account:updated': { req: undefined; res: { id?: string; email?: string; status?: string } };

  // Additional commands used by the renderer
  'webdav:start': { req: undefined; res: unknown };
  'webdav:stop': { req: undefined; res: unknown };
  'auth:login': { req: { email: string; password: string }; res: unknown };
  'auth:submit2FA': { req: { code: string }; res: unknown };
  'auth:submitMailboxPassword': { req: { password: string }; res: unknown };
  'auth:logout': { req: undefined; res: unknown };
}

export type RequestOf<K extends keyof IPCChannels> = IPCChannels[K] extends { req: infer R }
  ? R
  : undefined;
export type ResponseOf<K extends keyof IPCChannels> = IPCChannels[K] extends { res: infer S }
  ? S
  : unknown;

// Invoke signature: if request is undefined, no args allowed; otherwise single arg of request type
export type InvokeFn = <K extends keyof IPCChannels>(
  channel: K,
  ...args: undefined extends RequestOf<K> ? [] : [RequestOf<K>]
) => Promise<ResponseOf<K>>;

// Listener payloads are responses for event-like channels (reuse ResponseOf)
export type OnFn = <K extends keyof IPCChannels>(
  channel: K,
  listener: (data: ResponseOf<K>) => void
) => () => void;

export default IPCChannels;
