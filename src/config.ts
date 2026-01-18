/**
 * Proton Drive WebDAV Bridge - Configuration
 *
 * Manages application configuration including WebDAV server settings,
 * mount paths, and security options.
 */

import { readFileSync, writeFileSync, existsSync, watchFile, unwatchFile, mkdirSync } from 'fs';
import { dirname } from 'path';
import { getConfigFilePath } from './paths.js';
import { logger } from './logger.js';

// Re-export for convenience
export { getConfigFilePath } from './paths.js';

// ============================================================================
// Types
// ============================================================================

export interface WebDAVConfig {
  /** Host to bind WebDAV server to */
  host: string;
  /** Port for WebDAV server */
  port: number;
  /** Enable HTTP Basic Auth for WebDAV */
  requireAuth: boolean;
  /** Username for WebDAV auth (if enabled) */
  username?: string;
  /** Password for WebDAV auth (if enabled, stored hashed) */
  passwordHash?: string;
  /** Enable HTTPS */
  https: boolean;
  /** Path to SSL certificate (if HTTPS enabled) */
  certPath?: string;
  /** Path to SSL key (if HTTPS enabled) */
  keyPath?: string;
}

export interface CacheConfig {
  /** Enable metadata caching */
  enabled: boolean;
  /** Cache TTL in seconds */
  ttlSeconds: number;
  /** Maximum cache size in MB */
  maxSizeMB: number;
}

export interface Config {
  /** WebDAV server configuration */
  webdav: WebDAVConfig;
  /** Remote path in Proton Drive to expose (e.g., "/", "/Documents") */
  remotePath: string;
  /** Cache settings */
  cache: CacheConfig;
  /** Enable debug logging */
  debug: boolean;
  /** Auto-start on system boot */
  autoStart: boolean;
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_CONFIG: Config = {
  webdav: {
    host: '127.0.0.1', // Only listen on localhost by default for security
    port: 8080,
    requireAuth: true,
    https: false,
  },
  remotePath: '/',
  cache: {
    enabled: true,
    ttlSeconds: 60,
    maxSizeMB: 100,
  },
  debug: false,
  autoStart: false,
};

// ============================================================================
// Config State
// ============================================================================

let currentConfig: Config = { ...DEFAULT_CONFIG };
const configChangeCallbacks: Array<(config: Config) => void> = [];

// ============================================================================
// Config Operations
// ============================================================================

/**
 * Load configuration from file
 */
export function loadConfig(): Config {
  const configPath = getConfigFilePath();

  try {
    if (existsSync(configPath)) {
      const data = readFileSync(configPath, 'utf-8');
      const loaded = JSON.parse(data) as Partial<Config>;

      // Deep merge with defaults
      currentConfig = {
        ...DEFAULT_CONFIG,
        ...loaded,
        webdav: { ...DEFAULT_CONFIG.webdav, ...loaded.webdav },
        cache: { ...DEFAULT_CONFIG.cache, ...loaded.cache },
      };

      logger.debug(`Loaded config from ${configPath}`);
    } else {
      // Create default config file
      currentConfig = { ...DEFAULT_CONFIG };
      saveConfig(currentConfig);
      logger.info(`Created default config at ${configPath}`);
    }
  } catch (error) {
    logger.error(`Failed to load config: ${error}`);
    currentConfig = { ...DEFAULT_CONFIG };
  }

  return currentConfig;
}

/**
 * Save configuration to file
 */
export function saveConfig(config: Config): void {
  const configPath = getConfigFilePath();

  try {
    // Ensure the parent directory of the config file exists
    // Use dirname(getConfigFilePath()) directly to avoid any mismatch
    // between getConfigDir() and the computed config path.
    const dir = dirname(configPath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    currentConfig = config;
    logger.debug(`Saved config to ${configPath}`);
  } catch (error) {
    logger.error(`Failed to save config: ${error}`);
    throw error;
  }
}

/**
 * Get current configuration
 */
export function getConfig(): Config {
  return currentConfig;
}

/**
 * Update configuration (partial update)
 */
export function updateConfig(updates: Partial<Config>): Config {
  currentConfig = {
    ...currentConfig,
    ...updates,
    webdav: { ...currentConfig.webdav, ...updates.webdav },
    cache: { ...currentConfig.cache, ...updates.cache },
  };
  saveConfig(currentConfig);
  notifyConfigChange();
  return currentConfig;
}

/**
 * Register a callback for config changes
 */
export function onConfigChange(callback: (config: Config) => void): () => void {
  configChangeCallbacks.push(callback);
  return () => {
    const index = configChangeCallbacks.indexOf(callback);
    if (index >= 0) configChangeCallbacks.splice(index, 1);
  };
}

/**
 * Notify all registered callbacks of config change
 */
function notifyConfigChange(): void {
  for (const callback of configChangeCallbacks) {
    try {
      callback(currentConfig);
    } catch (error) {
      logger.error(`Config change callback error: ${error}`);
    }
  }
}

// ============================================================================
// Config File Watching
// ============================================================================

let watchingConfig = false;

/**
 * Start watching config file for changes
 */
export function watchConfigFile(): void {
  if (watchingConfig) return;

  const configPath = getConfigFilePath();
  if (!existsSync(configPath)) return;

  watchFile(configPath, { interval: 1000 }, () => {
    logger.info('Config file changed, reloading...');
    loadConfig();
    notifyConfigChange();
  });

  watchingConfig = true;
  logger.debug('Started watching config file');
}

/**
 * Stop watching config file
 */
export function unwatchConfigFile(): void {
  if (!watchingConfig) return;

  const configPath = getConfigFilePath();
  unwatchFile(configPath);
  watchingConfig = false;
  logger.debug('Stopped watching config file');
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate WebDAV configuration
 */
export function validateWebDAVConfig(config: WebDAVConfig): string[] {
  const errors: string[] = [];

  if (config.port < 1 || config.port > 65535) {
    errors.push('Port must be between 1 and 65535');
  }

  if (config.requireAuth && (!config.username || !config.passwordHash)) {
    errors.push('Username and password required when auth is enabled');
  }

  if (config.https) {
    if (!config.certPath) errors.push('Certificate path required for HTTPS');
    if (!config.keyPath) errors.push('Key path required for HTTPS');
  }

  // Security warning for non-localhost bindings
  if (config.host !== '127.0.0.1' && config.host !== 'localhost' && !config.https) {
    logger.warn('WARNING: Binding to non-localhost without HTTPS is insecure!');
  }

  return errors;
}

export default {
  loadConfig,
  saveConfig,
  getConfig,
  updateConfig,
  onConfigChange,
  watchConfigFile,
  unwatchConfigFile,
  validateWebDAVConfig,
};
