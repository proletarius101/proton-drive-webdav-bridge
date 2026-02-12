/**
 * Comprehensive Integration Tests - Configuration Module
 *
 * Tests config loading, saving, updates, validation, file watching, and callbacks.
 * Uses dynamic imports with mockFileSystem() for true per-test isolation.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { vol } from 'memfs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  getConfig,
  loadConfig,
  onConfigChange,
  saveConfig,
  unwatchConfigFile,
  updateConfig,
  validateWebDAVConfig,
  watchConfigFile,
} from '../src/config.js';
import { getConfigFilePath } from '../src/paths.js';

vi.mock('fs');
vi.mock('fs/promises');

beforeEach(() => {
  // reset the state of in-memory fs
  vol.reset();
});

describe('Config - Initialization and Defaults', () => {
  test('creates default config when missing', async () => {
    const configPath = getConfigFilePath();
    const config = loadConfig();

    // Verify defaults
    expect(config.webdav.host).toBe('127.0.0.1');
    expect(config.webdav.port).toBe(8080);
    expect(config.webdav.requireAuth).toBe(true);
    expect(config.webdav.https).toBe(false);
    expect(config.remotePath).toBe('/');
    expect(config.cache.enabled).toBe(true);
    expect(config.cache.ttlSeconds).toBe(60);
    expect(config.cache.maxSizeMB).toBe(100);
    expect(config.debug).toBe(false);
    expect(config.autoStart).toBe(false);

    // Verify file created
    expect(existsSync(configPath)).toBe(true);
    const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as typeof config;
    expect(raw.webdav.host).toBe(config.webdav.host);
    expect(raw.webdav.port).toBe(config.webdav.port);
  });

  test('loads existing config from file', async () => {
    const { getConfigDir } = await import(`../src/paths.js`);

    // Create custom config
    const configPath = getConfigFilePath();
    getConfigDir(); // Ensure directory exists
    const customConfig = {
      webdav: { host: '0.0.0.0', port: 9999, requireAuth: false, https: false },
      remotePath: '/Documents',
      cache: { enabled: false, ttlSeconds: 120, maxSizeMB: 200 },
      debug: true,
      autoStart: true,
    };
    writeFileSync(configPath, JSON.stringify(customConfig), { mode: 0o600 });

    // Load and verify
    const config = loadConfig();
    expect(config.webdav.host).toBe('0.0.0.0');
    expect(config.webdav.port).toBe(9999);
    expect(config.webdav.requireAuth).toBe(false);
    expect(config.remotePath).toBe('/Documents');
    expect(config.cache.enabled).toBe(false);
    expect(config.debug).toBe(true);
  });

  test('merges partial config with defaults', async () => {
    const { getConfigDir } = await import(`../src/paths.js`);

    const configPath = getConfigFilePath();
    getConfigDir();
    // Only override port
    const partialConfig = { webdav: { port: 3000 } };
    writeFileSync(configPath, JSON.stringify(partialConfig), { mode: 0o600 });

    const config = loadConfig();
    expect(config.webdav.port).toBe(3000);
    expect(config.webdav.host).toBe('127.0.0.1'); // Still default
    expect(config.webdav.requireAuth).toBe(true); // Still default
  });

  test('handles invalid JSON gracefully', async () => {
    const { getConfigDir } = await import(`../src/paths.js`);

    const configPath = getConfigFilePath();
    getConfigDir();
    writeFileSync(configPath, '{ invalid json }', { mode: 0o600 });

    const config = loadConfig();
    // Should return defaults on parse error
    expect(config.webdav.host).toBe('127.0.0.1');
    expect(config.webdav.port).toBe(8080);
  });
});

describe('Config - Updates and Persistence', () => {
  afterEach(async () => {
    try {
      unwatchConfigFile();
    } catch {
      // ignore
    }
  });

  test('updates and persists config', async () => {
    loadConfig();
    const updated = updateConfig({
      webdav: { host: '127.0.0.1', port: 9090, requireAuth: false, https: false },
    });

    expect(updated.webdav.port).toBe(9090);
    expect(updated.webdav.requireAuth).toBe(false);
    expect(getConfig().webdav.port).toBe(9090);

    const raw = JSON.parse(readFileSync(getConfigFilePath(), 'utf-8')) as typeof updated;
    expect(raw.webdav.port).toBe(9090);
    expect(raw.webdav.requireAuth).toBe(false);
  });

  test('updateConfig merges deeply', async () => {
    loadConfig();
    updateConfig({ webdav: { host: '127.0.0.1', port: 5000, requireAuth: true, https: false } });
    const config = updateConfig({ debug: true });

    expect(config.webdav.port).toBe(5000); // Previous update preserved
    expect(config.debug).toBe(true);
    expect(config.webdav.host).toBe('127.0.0.1'); // Defaults preserved
  });

  test('saveConfig writes to file', async () => {
    const config = loadConfig();
    config.debug = true;
    config.webdav.port = 7777;
    saveConfig(config);

    const raw = JSON.parse(readFileSync(getConfigFilePath(), 'utf-8')) as typeof config;
    expect(raw.debug).toBe(true);
    expect(raw.webdav.port).toBe(7777);
  });

  test('getConfig returns current config', async () => {
    loadConfig();
    updateConfig({ debug: true });
    const config = getConfig();
    expect(config.debug).toBe(true);
  });
});

describe('Config - Change Callbacks', () => {
  afterEach(async () => {
    try {
      unwatchConfigFile();
    } catch {
      // ignore
    }
  });

  test('onConfigChange callback is invoked on update', async () => {
    loadConfig();

    let callbackInvoked = false;
    type ConfigType = ReturnType<typeof loadConfig>;
    let callbackConfig: any = null;
    onConfigChange((config: ConfigType) => {
      callbackInvoked = true;
      callbackConfig = config;
    });

    updateConfig({ debug: true });

    expect(callbackInvoked).toBe(true);
    expect(callbackConfig).not.toBeNull();
    expect(callbackConfig?.debug).toBe(true);
  });

  test('onConfigChange returns unsubscribe function', async () => {
    loadConfig();

    let callCount = 0;
    const unsubscribe = onConfigChange(() => {
      callCount++;
    });

    updateConfig({ debug: true });
    expect(callCount).toBe(1);

    unsubscribe();
    updateConfig({ debug: false });
    expect(callCount).toBe(1); // Not called again
  });

  test('multiple callbacks can be registered', async () => {
    loadConfig();

    let callback1Count = 0;
    let callback2Count = 0;

    onConfigChange(() => callback1Count++);
    onConfigChange(() => callback2Count++);

    updateConfig({ debug: true });

    expect(callback1Count).toBe(1);
    expect(callback2Count).toBe(1);
  });
});

describe('Config - Validation', () => {
  test('validateWebDAVConfig rejects invalid port', async () => {
    const invalidConfig = {
      host: '127.0.0.1',
      port: 99999,
      requireAuth: false,
      https: false,
    };

    const errors = validateWebDAVConfig(invalidConfig);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e: string) => e.includes('Port'))).toBe(true);
  });

  test('validateWebDAVConfig requires auth credentials when enabled', async () => {
    const config = {
      host: '127.0.0.1',
      port: 8080,
      requireAuth: true,
      https: false,
    };

    const errors = validateWebDAVConfig(config);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e: string) => e.includes('Username'))).toBe(true);
  });

  test('validateWebDAVConfig requires cert/key for HTTPS', async () => {
    const config = {
      host: '127.0.0.1',
      port: 8080,
      requireAuth: false,
      https: true,
    };

    const errors = validateWebDAVConfig(config);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e: string) => e.includes('Certificate'))).toBe(true);
    expect(errors.some((e: string) => e.includes('Key'))).toBe(true);
  });

  test('validateWebDAVConfig accepts valid config', async () => {
    const config = {
      host: '127.0.0.1',
      port: 8080,
      requireAuth: false,
      https: false,
    };

    const errors = validateWebDAVConfig(config);
    expect(errors.length).toBe(0);
  });
});

describe('Config - File Watching', () => {
  afterEach(async () => {});

  test('watchConfigFile and unwatchConfigFile execute without error', async () => {
    loadConfig();
    expect(() => watchConfigFile()).not.toThrow();
    expect(() => unwatchConfigFile()).not.toThrow();
  });

  test('watchConfigFile is idempotent', async () => {
    loadConfig();
    watchConfigFile();
    expect(() => watchConfigFile()).not.toThrow(); // Should not error on second call
  });
});
