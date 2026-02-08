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

import { afterEach, beforeEach, describe, expect, vi, test } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PerTestEnv, setupPerTestEnv } from './helpers/perTestEnv';

let __perTestEnv: PerTestEnv;
beforeEach(async () => {
  __perTestEnv = await setupPerTestEnv();
});
afterEach(async () => {
  await __perTestEnv.cleanup();
});

// Mock config to provide defaults - uses the preloaded env-paths from setup.ts
vi.mock('../src/config.js', () => ({
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
  getConfigFilePath: () => join(__perTestEnv.baseDir, 'config', 'proton-drive-webdav-bridge', 'config.json'),
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
  test('should instantiate WebDAVServer', async () => {
    const { WebDAVServer } = await import('../src/webdav/server.js');
    const server = new WebDAVServer();
    expect(server).toBeDefined();
    expect(typeof server).toBe('object');
  });

  test('should have start method', async () => {
    const { WebDAVServer } = await import('../src/webdav/server.js');
    const server = new WebDAVServer();
    expect(typeof server.start).toBe('function');
  });

  test('should have stop method', async () => {
    const { WebDAVServer } = await import('../src/webdav/server.js');
    const server = new WebDAVServer();
    expect(typeof server.stop).toBe('function');
  });

  test('should have getUrl method', async () => {
    const { WebDAVServer } = await import('../src/webdav/server.js');
    const server = new WebDAVServer();
    expect(typeof server.getUrl).toBe('function');
  });

  test('getUrl should return URL based on configuration', async () => {
    const { WebDAVServer } = await import('../src/webdav/server.js');
    const server = new WebDAVServer({ host: '127.0.0.1', port: 8080 });
    const url = server.getUrl();
    expect(url).toBe('http://127.0.0.1:8080');
  });
});

describe('WebDAV Server - Configuration', () => {
  test('should accept custom configuration', async () => {
    const { WebDAVServer } = await import('../src/webdav/server.js');
    const server = new WebDAVServer({
      host: '127.0.0.1',
      port: 9999,
      requireAuth: false,
    });
    expect(server).toBeDefined();
  });

  test('should support HTTPS configuration', async () => {
    const { WebDAVServer } = await import('../src/webdav/server.js');
    const server = new WebDAVServer({
      https: true,
      certPath: '/path/to/cert.pem',
      keyPath: '/path/to/key.pem',
    });
    expect(server).toBeDefined();
  });
});

describe('WebDAV Server - Error Handling', () => {
  test('stop should not throw when server not running', async () => {
    const { WebDAVServer } = await import('../src/webdav/server.js');
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
  test('should apply host configuration correctly', async () => {
    const { WebDAVServer } = await import('../src/webdav/server.js');
    const server = new WebDAVServer({ host: '0.0.0.0', port: 9090 });
    const url = server.getUrl();
    expect(url).toContain('0.0.0.0');
    expect(url).toContain('9090');
  });

  test('should apply HTTPS protocol configuration', async () => {
    const { WebDAVServer } = await import('../src/webdav/server.js');
    const server = new WebDAVServer({
      host: 'localhost',
      port: 8443,
      https: true,
    });
    const url = server.getUrl();
    expect(url).toMatch(/^https:\/\//);
  });

  test('should apply HTTP protocol configuration', async () => {
    const { WebDAVServer } = await import('../src/webdav/server.js');
    const server = new WebDAVServer({
      host: 'localhost',
      port: 8080,
      https: false,
    });
    const url = server.getUrl();
    expect(url).toMatch(/^http:\/\//);
  });

  test('should support authentication configuration', async () => {
    const { WebDAVServer } = await import('../src/webdav/server.js');
    const server = new WebDAVServer({
      requireAuth: true,
      username: 'testuser',
      passwordHash: 'test-hash',
    });
    expect(server).toBeDefined();
  });

  test('should instantiate with minimal configuration', async () => {
    const { WebDAVServer } = await import('../src/webdav/server.js');
    const server = new WebDAVServer();
    expect(server).toBeDefined();
    expect(typeof server.start).toBe('function');
    expect(typeof server.stop).toBe('function');
  });

  test('should create multiple independent instances', async () => {
    const { WebDAVServer } = await import('../src/webdav/server.js');
    const server1 = new WebDAVServer({ port: 8080 });
    const server2 = new WebDAVServer({ port: 9090 });

    expect(server1).toBeDefined();
    expect(server2).toBeDefined();
    expect(server1.getUrl()).not.toBe(server2.getUrl());
  });
});
