/**
 * Proton Drive Bridge - XDG Paths
 *
 * Cross-platform path management following XDG Base Directory Specification.
 */

import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync } from 'fs';

// ============================================================================
// Path Constants
// ============================================================================

const APP_NAME = 'proton-drive-bridge';

/**
 * Get the configuration directory path.
 * - Linux: ~/.config/proton-drive-bridge
 * - macOS: ~/Library/Application Support/proton-drive-bridge
 * - Windows: %APPDATA%/proton-drive-bridge
 */
export function getConfigDir(): string {
  const platform = process.platform;

  let configDir: string;

  if (platform === 'darwin') {
    configDir = join(homedir(), 'Library', 'Application Support', APP_NAME);
  } else if (platform === 'win32') {
    configDir = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), APP_NAME);
  } else {
    // Linux and others - follow XDG
    configDir = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), APP_NAME);
  }

  // Ensure directory exists
  mkdirSync(configDir, { recursive: true });
  return configDir;
}

/**
 * Get the data directory path (for databases, cache, etc.)
 * - Linux: ~/.local/share/proton-drive-bridge
 * - macOS: ~/Library/Application Support/proton-drive-bridge
 * - Windows: %LOCALAPPDATA%/proton-drive-bridge
 */
export function getDataDir(): string {
  const platform = process.platform;

  let dataDir: string;

  if (platform === 'darwin') {
    dataDir = join(homedir(), 'Library', 'Application Support', APP_NAME);
  } else if (platform === 'win32') {
    dataDir = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), APP_NAME);
  } else {
    // Linux and others - follow XDG
    dataDir = join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), APP_NAME);
  }

  // Ensure directory exists
  mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

/**
 * Get the log directory path.
 * - Linux: ~/.local/state/proton-drive-bridge/logs
 * - macOS: ~/Library/Logs/proton-drive-bridge
 * - Windows: %LOCALAPPDATA%/proton-drive-bridge/logs
 */
export function getLogDir(): string {
  const platform = process.platform;

  let logDir: string;

  if (platform === 'darwin') {
    logDir = join(homedir(), 'Library', 'Logs', APP_NAME);
  } else if (platform === 'win32') {
    logDir = join(
      process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'),
      APP_NAME,
      'logs'
    );
  } else {
    // Linux and others - follow XDG
    logDir = join(
      process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'),
      APP_NAME,
      'logs'
    );
  }

  // Ensure directory exists
  mkdirSync(logDir, { recursive: true });
  return logDir;
}

/**
 * Get the runtime directory (for sockets, PID files, etc.)
 * - Linux: /run/user/$UID/proton-drive-bridge or /tmp/proton-drive-bridge-$UID
 * - macOS: /tmp/proton-drive-bridge-$UID
 * - Windows: %TEMP%/proton-drive-bridge
 */
export function getRuntimeDir(): string {
  const platform = process.platform;

  let runtimeDir: string;

  if (platform === 'win32') {
    runtimeDir = join(process.env.TEMP || join(homedir(), 'AppData', 'Local', 'Temp'), APP_NAME);
  } else {
    // Linux and macOS
    const xdgRuntime = process.env.XDG_RUNTIME_DIR;
    if (xdgRuntime) {
      runtimeDir = join(xdgRuntime, APP_NAME);
    } else {
      runtimeDir = join('/tmp', `${APP_NAME}-${process.getuid?.() || process.pid}`);
    }
  }

  // Ensure directory exists
  mkdirSync(runtimeDir, { recursive: true });
  return runtimeDir;
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
