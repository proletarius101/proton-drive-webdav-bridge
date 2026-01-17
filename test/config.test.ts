/**
 * Comprehensive Integration Tests - Configuration Module
 *
 * Tests config loading, saving, updates, validation, file watching, and callbacks.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, mock } from 'bun:test';

const DEFAULT_PATHS_BASE = join(tmpdir(), 'pdb-config-default');
let pathsBase = DEFAULT_PATHS_BASE;

mock.module('env-paths', () => ({
  default: () => {
    const paths = {
      config: join(pathsBase, 'config', 'proton-drive-webdav-bridge'),
      data: join(pathsBase, 'data', 'proton-drive-webdav-bridge'),
      log: join(pathsBase, 'log', 'proton-drive-webdav-bridge'),
      temp: join(pathsBase, 'temp', 'proton-drive-webdav-bridge'),
      cache: join(pathsBase, 'cache', 'proton-drive-webdav-bridge'),
    };

    // Create directories on access
    Object.values(paths).forEach((path) => mkdirSync(path, { recursive: true }));

    return paths;
  },
}));

describe('Config - Initialization and Defaults', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'pdb-config-'));
    pathsBase = baseDir;
  });

  afterEach(async () => {
    // Dynamically import and unwatchConfigFile to clean up file watchers
    try {
      const { unwatchConfigFile } = await import(`../src/config.ts?cache=${Date.now()}`);
      unwatchConfigFile();
    } catch {
      // If import fails, continue cleanup
    }
    rmSync(baseDir, { recursive: true, force: true });
    pathsBase = DEFAULT_PATHS_BASE;
  });

  test('creates default config when missing', async () => {
    const { loadConfig, getConfigFilePath } = await import(`../src/config.ts?cache=${Date.now()}`);

    const configPath = getConfigFilePath();
    // Ensure no config exists before test
    if (existsSync(configPath)) {
      rmSync(configPath);
    }

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
    const { loadConfig, getConfigFilePath } = await import(`../src/config.ts?cache=${Date.now()}`);
    const { getConfigDir } = await import(`../src/paths.ts?cache=${Date.now()}`);

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
    const { loadConfig, getConfigFilePath } = await import(`../src/config.ts?cache=${Date.now()}`);
    const { getConfigDir } = await import(`../src/paths.ts?cache=${Date.now()}`);

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
    const { loadConfig, getConfigFilePath } = await import(`../src/config.ts?cache=${Date.now()}`);
    const { getConfigDir } = await import(`../src/paths.ts?cache=${Date.now()}`);

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
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'pdb-config-'));
    pathsBase = baseDir;
  });

  afterEach(async () => {
    try {
      const { unwatchConfigFile } = await import(`../src/config.ts?cache=${Date.now()}`);
      unwatchConfigFile();
    } catch {
      // ignore
    }
    rmSync(baseDir, { recursive: true, force: true });
    pathsBase = DEFAULT_PATHS_BASE;
  });

  test('updates and persists config', async () => {
    const { loadConfig, updateConfig, getConfigFilePath, getConfig } = await import(
      `../src/config.ts?cache=${Date.now()}`
    );

    loadConfig();
    const updated = updateConfig({ webdav: { port: 9090, requireAuth: false } });

    expect(updated.webdav.port).toBe(9090);
    expect(updated.webdav.requireAuth).toBe(false);
    expect(getConfig().webdav.port).toBe(9090);

    const raw = JSON.parse(readFileSync(getConfigFilePath(), 'utf-8')) as typeof updated;
    expect(raw.webdav.port).toBe(9090);
    expect(raw.webdav.requireAuth).toBe(false);
  });

  test('updateConfig merges deeply', async () => {
    const { loadConfig, updateConfig } = await import(`../src/config.ts?cache=${Date.now()}`);

    loadConfig();
    updateConfig({ webdav: { port: 5000 } });
    const config = updateConfig({ debug: true });

    expect(config.webdav.port).toBe(5000); // Previous update preserved
    expect(config.debug).toBe(true);
    expect(config.webdav.host).toBe('127.0.0.1'); // Defaults preserved
  });

  test('saveConfig writes to file', async () => {
    const { loadConfig, saveConfig, getConfigFilePath } = await import(
      `../src/config.ts?cache=${Date.now()}`
    );

    const config = loadConfig();
    config.debug = true;
    config.webdav.port = 7777;
    saveConfig(config);

    const raw = JSON.parse(readFileSync(getConfigFilePath(), 'utf-8')) as typeof config;
    expect(raw.debug).toBe(true);
    expect(raw.webdav.port).toBe(7777);
  });

  test('getConfig returns current config', async () => {
    const { loadConfig, getConfig, updateConfig } = await import(
      `../src/config.ts?cache=${Date.now()}`
    );

    loadConfig();
    updateConfig({ debug: true });
    const config = getConfig();
    expect(config.debug).toBe(true);
  });
});

describe('Config - Change Callbacks', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'pdb-config-'));
    pathsBase = baseDir;
  });

  afterEach(async () => {
    try {
      const { unwatchConfigFile } = await import(`../src/config.ts?cache=${Date.now()}`);
      unwatchConfigFile();
    } catch {
      // ignore
    }
    rmSync(baseDir, { recursive: true, force: true });
    pathsBase = DEFAULT_PATHS_BASE;
  });

  test('onConfigChange callback is invoked on update', async () => {
    const { loadConfig, updateConfig, onConfigChange } = await import(
      `../src/config.ts?cache=${Date.now()}`
    );

    loadConfig();

    let callbackInvoked = false;
    type ConfigType = ReturnType<typeof loadConfig>;
    let callbackConfig: ConfigType | null = null;
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
    const { loadConfig, updateConfig, onConfigChange } = await import(
      `../src/config.ts?cache=${Date.now()}`
    );

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
    const { loadConfig, updateConfig, onConfigChange } = await import(
      `../src/config.ts?cache=${Date.now()}`
    );

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
    const { validateWebDAVConfig } = await import(`../src/config.ts?cache=${Date.now()}`);

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
    const { validateWebDAVConfig } = await import(`../src/config.ts?cache=${Date.now()}`);

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
    const { validateWebDAVConfig } = await import(`../src/config.ts?cache=${Date.now()}`);

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
    const { validateWebDAVConfig } = await import(`../src/config.ts?cache=${Date.now()}`);

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
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'pdb-config-'));
    pathsBase = baseDir;
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    pathsBase = DEFAULT_PATHS_BASE;
  });

  test('watchConfigFile and unwatchConfigFile execute without error', async () => {
    const { loadConfig, watchConfigFile, unwatchConfigFile } = await import(
      `../src/config.ts?cache=${Date.now()}`
    );

    loadConfig();
    expect(() => watchConfigFile()).not.toThrow();
    expect(() => unwatchConfigFile()).not.toThrow();
  });

  test('watchConfigFile is idempotent', async () => {
    const { loadConfig, watchConfigFile } = await import(`../src/config.ts?cache=${Date.now()}`);

    loadConfig();
    watchConfigFile();
    expect(() => watchConfigFile()).not.toThrow(); // Should not error on second call
  });
});
