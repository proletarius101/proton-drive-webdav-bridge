/**
 * Integration Tests - Paths Module
 *
 * Tests path resolution and directory creation using env-paths.
 */

import { afterEach, beforeEach, describe, expect, test, mock } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let tempBase: string;

const loadPaths = async () =>
  import(`../src/paths.js?cache=${Date.now()}-${Math.random().toString(36).slice(2)}`);

mock.module('env-paths', () => ({
  default: () => ({
    config: join(tempBase, 'config', 'proton-drive-webdav-bridge'),
    data: join(tempBase, 'data', 'proton-drive-webdav-bridge'),
    log: join(tempBase, 'log', 'proton-drive-webdav-bridge'),
    temp: join(tempBase, 'temp', 'proton-drive-webdav-bridge'),
    cache: join(tempBase, 'cache', 'proton-drive-webdav-bridge'),
  }),
}));

describe('Paths - Directory Functions Availability', () => {
  beforeEach(() => {
    tempBase = mkdtempSync(join(tmpdir(), 'pdb-paths-'));
  });

  afterEach(() => {
    rmSync(tempBase, { recursive: true, force: true });
  });

  test('should have getConfigDir function', async () => {
    const { getConfigDir } = await loadPaths();
    expect(typeof getConfigDir).toBe('function');
  });

  test('should have getDataDir function', async () => {
    const { getDataDir } = await loadPaths();
    expect(typeof getDataDir).toBe('function');
  });

  test('should have getLogDir function', async () => {
    const { getLogDir } = await loadPaths();
    expect(typeof getLogDir).toBe('function');
  });
});

describe('Paths - Directory Paths Return Values', () => {
  beforeEach(() => {
    tempBase = mkdtempSync(join(tmpdir(), 'pdb-paths-'));
  });

  afterEach(() => {
    rmSync(tempBase, { recursive: true, force: true });
  });

  test('getConfigDir should return non-empty string', async () => {
    const { getConfigDir } = await loadPaths();
    const configDir = getConfigDir();
    expect(typeof configDir).toBe('string');
    expect(configDir.length).toBeGreaterThan(0);
  });

  test('getDataDir should return non-empty string', async () => {
    const { getDataDir } = await loadPaths();
    const dataDir = getDataDir();
    expect(typeof dataDir).toBe('string');
    expect(dataDir.length).toBeGreaterThan(0);
  });

  test('getLogDir should return non-empty string', async () => {
    const { getLogDir } = await loadPaths();
    const logDir = getLogDir();
    expect(typeof logDir).toBe('string');
    expect(logDir.length).toBeGreaterThan(0);
  });
});

describe('Paths - Path Properties', () => {
  beforeEach(() => {
    tempBase = mkdtempSync(join(tmpdir(), 'pdb-paths-'));
  });

  afterEach(() => {
    rmSync(tempBase, { recursive: true, force: true });
  });

  test('getConfigDir should return absolute path', async () => {
    const { getConfigDir } = await loadPaths();
    const configDir = getConfigDir();
    expect(configDir.startsWith('/')).toBe(true);
  });

  test('getDataDir should return absolute path', async () => {
    const { getDataDir } = await loadPaths();
    const dataDir = getDataDir();
    expect(dataDir.startsWith('/')).toBe(true);
  });

  test('getLogDir should return absolute path', async () => {
    const { getLogDir } = await loadPaths();
    const logDir = getLogDir();
    expect(logDir.startsWith('/')).toBe(true);
  });
});

describe('Paths - Directory Creation', () => {
  beforeEach(() => {
    tempBase = mkdtempSync(join(tmpdir(), 'pdb-paths-'));
  });

  afterEach(() => {
    rmSync(tempBase, { recursive: true, force: true });
  });

  test('getConfigDir should create directory', async () => {
    const { getConfigDir } = await loadPaths();
    const configDir = getConfigDir();
    expect(existsSync(configDir)).toBe(true);
  });

  test('getDataDir should create directory', async () => {
    const { getDataDir } = await loadPaths();
    const dataDir = getDataDir();
    expect(existsSync(dataDir)).toBe(true);
  });

  test('getLogDir should create directory', async () => {
    const { getLogDir } = await loadPaths();
    const logDir = getLogDir();
    expect(existsSync(logDir)).toBe(true);
  });
});

describe('Paths - Directory Idempotency', () => {
  beforeEach(() => {
    tempBase = mkdtempSync(join(tmpdir(), 'pdb-paths-'));
  });

  afterEach(() => {
    rmSync(tempBase, { recursive: true, force: true });
  });

  test('getConfigDir should return same path on multiple calls', async () => {
    const { getConfigDir } = await loadPaths();
    const dir1 = getConfigDir();
    const dir2 = getConfigDir();
    expect(dir1).toBe(dir2);
  });

  test('getDataDir should return same path on multiple calls', async () => {
    const { getDataDir } = await loadPaths();
    const dir1 = getDataDir();
    const dir2 = getDataDir();
    expect(dir1).toBe(dir2);
  });

  test('getLogDir should return same path on multiple calls', async () => {
    const { getLogDir } = await loadPaths();
    const dir1 = getLogDir();
    const dir2 = getLogDir();
    expect(dir1).toBe(dir2);
  });
});

describe('Paths - Runtime Directory', () => {
  beforeEach(() => {
    tempBase = mkdtempSync(join(tmpdir(), 'pdb-paths-'));
  });

  afterEach(() => {
    rmSync(tempBase, { recursive: true, force: true });
  });

  test('getRuntimeDir should return absolute path and create directory', async () => {
    const { getRuntimeDir } = await loadPaths();
    const runtimeDir = getRuntimeDir();

    expect(runtimeDir.startsWith('/')).toBe(true);
    expect(existsSync(runtimeDir)).toBe(true);
  });

  test('getRuntimeDir should remain stable across calls', async () => {
    const { getRuntimeDir } = await loadPaths();
    const dir1 = getRuntimeDir();
    const dir2 = getRuntimeDir();

    expect(dir1).toBe(dir2);
  });
});

describe('Paths - Platform Compliance', () => {
  beforeEach(() => {
    tempBase = mkdtempSync(join(tmpdir(), 'pdb-paths-'));
  });

  afterEach(() => {
    rmSync(tempBase, { recursive: true, force: true });
  });

  test('paths should contain app name proton-drive-webdav-bridge', async () => {
    const { getConfigDir, getDataDir, getLogDir } = await loadPaths();
    const configDir = getConfigDir();
    const dataDir = getDataDir();
    const logDir = getLogDir();

    expect(configDir).toContain('proton-drive-webdav-bridge');
    expect(dataDir).toContain('proton-drive-webdav-bridge');
    expect(logDir).toContain('proton-drive-webdav-bridge');
  });

  test('config and data paths should respect XDG on Linux', async () => {
    if (process.platform === 'linux') {
      const { getConfigDir, getDataDir } = await loadPaths();
      const configDir = getConfigDir();
      const dataDir = getDataDir();

      const configHasXdgConfig = configDir.includes('/config/');
      const dataHasXdgData = dataDir.includes('/data/');

      expect(configHasXdgConfig).toBe(true);
      expect(dataHasXdgData).toBe(true);
    }
  });
});
