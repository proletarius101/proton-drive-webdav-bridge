/**
 * Proton Drive WebDAV Bridge - Paths
 *
 * Cross-platform path management via env-paths.
 */

import envPaths from 'env-paths';
import { join } from 'path';
import { mkdirSync } from 'fs';

// ============================================================================
// Path Constants
// ============================================================================

const APP_NAME = 'proton-drive-webdav-bridge';
const paths = envPaths(APP_NAME, { suffix: '' });

const ensureDir = (dirPath: string): string => {
  mkdirSync(dirPath, { recursive: true });
  return dirPath;
};

/**
 * Get the configuration directory path.
 * - Linux: ~/.config/proton-drive-webdav-bridge
 * - macOS: ~/Library/Application Support/proton-drive-webdav-bridge
 * - Windows: %APPDATA%/proton-drive-webdav-bridge
 */
export function getConfigDir(): string {
  return ensureDir(paths.config);
}

/**
 * Get the data directory path (for databases, cache, etc.)
 * - Linux: ~/.local/share/proton-drive-webdav-bridge
 * - macOS: ~/Library/Application Support/proton-drive-webdav-bridge
 * - Windows: %LOCALAPPDATA%/proton-drive-webdav-bridge
 */
export function getDataDir(): string {
  return ensureDir(paths.data);
}

/**
 * Get the log directory path.
 * - Linux: ~/.local/state/proton-drive-webdav-bridge/logs
 * - macOS: ~/Library/Logs/proton-drive-webdav-bridge
 * - Windows: %LOCALAPPDATA%/proton-drive-webdav-bridge/logs
 */
export function getLogDir(): string {
  return ensureDir(paths.log);
}

/**
 * Get the runtime directory (for sockets, PID files, etc.)
 * - Linux: /run/user/$UID/proton-drive-webdav-bridge or /tmp/proton-drive-webdav-bridge-$UID
 * - macOS: /tmp/proton-drive-webdav-bridge-$UID
 * - Windows: %TEMP%/proton-drive-webdav-bridge
 */
export function getRuntimeDir(): string {
  const baseRuntime = join(paths.temp, APP_NAME);
  const runtimeDir =
    process.platform === 'win32'
      ? baseRuntime
      : join(baseRuntime, `${process.getuid?.() ?? process.pid}`);

  return ensureDir(runtimeDir);
}

/**
 * Get the path to the main config file
 */
export function getConfigFilePath(): string {
  return join(getConfigDir(), 'config.json');
}

/**
 * Get the path to the encrypted credentials file (fallback for headless Linux)
 */
export function getCredentialsFilePath(): string {
  return join(getDataDir(), 'credentials.enc');
}

/**
 * Get the path to the PID file for the daemon
 */
export function getPidFilePath(): string {
  return join(getRuntimeDir(), 'bridge.pid');
}

/**
 * Get the path to the main log file
 */
export function getLogFilePath(): string {
  return join(getLogDir(), 'bridge.log');
}
