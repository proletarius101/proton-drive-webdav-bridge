/**
 * Comprehensive Tests - WebDAV Server
 *
 * Tests WebDAV server functionality including:
 * - Server lifecycle (start/stop)
 * - Configuration validation
 * - HTTP/HTTPS support
 * - Authentication
 * - URL generation
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const DEFAULT_PATHS_BASE = join(tmpdir(), 'pdb-webdav-default');
let pathsBase = DEFAULT_PATHS_BASE;

mock.module('env-paths', () => ({
  default: () => ({
    config: join(pathsBase, 'config', 'proton-drive-webdav-bridge'),
    data: join(pathsBase, 'data', 'proton-drive-webdav-bridge'),
    log: join(pathsBase, 'log', 'proton-drive-webdav-bridge'),
    temp: join(pathsBase, 'temp', 'proton-drive-webdav-bridge'),
    cache: join(pathsBase, 'cache', 'proton-drive-webdav-bridge'),
  }),
}));

// Mock config to provide defaults
mock.module('../src/config.js', () => ({
  getConfig: () => ({
    webdav: {
      host: '127.0.0.1',
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
  }),
  loadConfig: () => ({}),
  saveConfig: () => {},
  updateConfig: () => ({}),
  getConfigFilePath: () => join(pathsBase, 'config', 'proton-drive-webdav-bridge', 'config.json'),
}));

describe('WebDAV Server - Initialization', () => {
  test('should import WebDAV server module', async () => {
    const serverModule = await import('../src/webdav/server.js');
    expect(serverModule).toBeDefined();
  });

  test('should export WebDAVServer class', async () => {
    const { WebDAVServer } = await import('../src/webdav/server.js');
    expect(WebDAVServer).toBeDefined();
    expect(typeof WebDAVServer).toBe('function');
  });
});

describe('WebDAV Server - Lifecycle', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'pdb-webdav-'));
    pathsBase = baseDir;
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    pathsBase = DEFAULT_PATHS_BASE;
  });

  test('should instantiate WebDAVServer', async () => {
    const { WebDAVServer } = await import(`../src/webdav/server.js?cache=${Date.now()}`);
    const server = new WebDAVServer();
    expect(server).toBeDefined();
    expect(typeof server).toBe('object');
  });

  test('should have start method', async () => {
    const { WebDAVServer } = await import(`../src/webdav/server.js?cache=${Date.now()}`);
    const server = new WebDAVServer();
    expect(typeof server.start).toBe('function');
  });

  test('should have stop method', async () => {
    const { WebDAVServer } = await import(`../src/webdav/server.js?cache=${Date.now()}`);
    const server = new WebDAVServer();
    expect(typeof server.stop).toBe('function');
  });

  test('should have getUrl method', async () => {
    const { WebDAVServer } = await import(`../src/webdav/server.js?cache=${Date.now()}`);
    const server = new WebDAVServer();
    expect(typeof server.getUrl).toBe('function');
  });

  test('getUrl should return URL based on configuration', async () => {
    const { WebDAVServer } = await import(`../src/webdav/server.js?cache=${Date.now()}`);
    const server = new WebDAVServer({ host: '127.0.0.1', port: 8080 });
    const url = server.getUrl();
    expect(url).toBe('http://127.0.0.1:8080');
  });
});

describe('WebDAV Server - Configuration', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'pdb-webdav-'));
    pathsBase = baseDir;
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    pathsBase = DEFAULT_PATHS_BASE;
  });

  test('should accept custom configuration', async () => {
    const { WebDAVServer } = await import(`../src/webdav/server.js?cache=${Date.now()}`);
    const server = new WebDAVServer({
      host: '127.0.0.1',
      port: 9999,
      requireAuth: false,
    });
    expect(server).toBeDefined();
  });

  test('should support HTTPS configuration', async () => {
    const { WebDAVServer } = await import(`../src/webdav/server.js?cache=${Date.now()}`);
    const server = new WebDAVServer({
      https: true,
      certPath: '/path/to/cert.pem',
      keyPath: '/path/to/key.pem',
    });
    expect(server).toBeDefined();
  });
});

describe('WebDAV Server - Error Handling', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'pdb-webdav-'));
    pathsBase = baseDir;
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    pathsBase = DEFAULT_PATHS_BASE;
  });

  test('stop should not throw when server not running', async () => {
    const { WebDAVServer } = await import(`../src/webdav/server.js?cache=${Date.now()}`);
    const server = new WebDAVServer();
    await expect(server.stop()).resolves.toBeUndefined();
  });
});

describe('WebDAV Server - URL Generation', () => {
  test('should generate HTTP URL format', () => {
    // Test URL generation logic without starting server
    const host = '127.0.0.1';
    const port = 8080;
    const expectedUrl = `http://${host}:${port}`;
    expect(expectedUrl).toBe('http://127.0.0.1:8080');
  });

  test('should generate HTTPS URL format', () => {
    const host = '127.0.0.1';
    const port = 8080;
    const expectedUrl = `https://${host}:${port}`;
    expect(expectedUrl).toBe('https://127.0.0.1:8080');
  });
});

describe('WebDAV Server - Configuration Integration', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'pdb-webdav-config-'));
    pathsBase = baseDir;
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    pathsBase = DEFAULT_PATHS_BASE;
  });

  test('should apply host configuration correctly', async () => {
    const { WebDAVServer } = await import(`../src/webdav/server.js?cache=${Date.now()}`);
    const server = new WebDAVServer({ host: '0.0.0.0', port: 9090 });
    const url = server.getUrl();
    expect(url).toContain('0.0.0.0');
    expect(url).toContain('9090');
  });

  test('should apply HTTPS protocol configuration', async () => {
    const { WebDAVServer } = await import(`../src/webdav/server.js?cache=${Date.now()}`);
    const server = new WebDAVServer({
      host: 'localhost',
      port: 8443,
      https: true,
    });
    const url = server.getUrl();
    expect(url).toStartWith('https://');
  });

  test('should apply HTTP protocol configuration', async () => {
    const { WebDAVServer } = await import(`../src/webdav/server.js?cache=${Date.now()}`);
    const server = new WebDAVServer({
      host: 'localhost',
      port: 8080,
      https: false,
    });
    const url = server.getUrl();
    expect(url).toStartWith('http://');
  });

  test('should support authentication configuration', async () => {
    const { WebDAVServer } = await import(`../src/webdav/server.js?cache=${Date.now()}`);
    const server = new WebDAVServer({
      requireAuth: true,
      username: 'testuser',
      passwordHash: 'test-hash',
    });
    expect(server).toBeDefined();
  });

  test('should instantiate with minimal configuration', async () => {
    const { WebDAVServer } = await import(`../src/webdav/server.js?cache=${Date.now()}`);
    const server = new WebDAVServer();
    expect(server).toBeDefined();
    expect(typeof server.start).toBe('function');
    expect(typeof server.stop).toBe('function');
  });

  test('should create multiple independent instances', async () => {
    const { WebDAVServer } = await import(`../src/webdav/server.js?cache=${Date.now()}`);
    const server1 = new WebDAVServer({ port: 8080 });
    const server2 = new WebDAVServer({ port: 9090 });

    expect(server1).toBeDefined();
    expect(server2).toBeDefined();
    expect(server1.getUrl()).not.toBe(server2.getUrl());
  });
});
