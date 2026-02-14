/**
 * Integration Tests - Paths Module
 *
 * Tests path resolution and directory creation using env-paths.
 */

import { fs, vol } from 'memfs';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('fs');
vi.mock('fs/promises');

beforeEach(() => {
  // reset the state of in-memory fs
  vol.reset();
});

const loadPaths = async () => import('../src/paths.js');

describe('Paths - Directory Functions Availability', () => {
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
  test('getConfigDir should create directory', async () => {
    const { getConfigDir } = await loadPaths();
    const configDir = getConfigDir();
    expect(fs.existsSync(configDir)).toBe(true);
  });

  test('getDataDir should create directory', async () => {
    const { getDataDir } = await loadPaths();
    const dataDir = getDataDir();
    expect(fs.existsSync(dataDir)).toBe(true);
  });

  test('getLogDir should create directory', async () => {
    const { getLogDir } = await loadPaths();
    const logDir = getLogDir();
    expect(fs.existsSync(logDir)).toBe(true);
  });
});

describe('Paths - Directory Idempotency', () => {
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
  test('getRuntimeDir should return absolute path and create directory', async () => {
    const { getRuntimeDir } = await loadPaths();
    const runtimeDir = getRuntimeDir();

    expect(runtimeDir.startsWith('/')).toBe(true);
    expect(fs.existsSync(runtimeDir)).toBe(true);
  });

  test('getRuntimeDir should remain stable across calls', async () => {
    const { getRuntimeDir } = await loadPaths();
    const dir1 = getRuntimeDir();
    const dir2 = getRuntimeDir();

    expect(dir1).toBe(dir2);
  });
});
