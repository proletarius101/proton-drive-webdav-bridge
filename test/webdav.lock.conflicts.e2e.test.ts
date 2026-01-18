import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { getDataDir } from '../src/paths.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, beforeEach, afterEach, expect, mock } from 'bun:test';

// Note: These E2E tests should be run separately from other tests to avoid
// singleton/resource conflicts. Run with: bun test test/webdav.lock.conflicts.e2e.test.ts
// Mock env-paths to return fresh temp directories for each test
let mockDirs: { config: string; data: string; log: string; temp: string; cache: string } | null = null;
mock.module('env-paths', () => ({
  default: () => {
    if (!mockDirs) {
      mockDirs = {
        config: mkdtempSync(join(tmpdir(), 'pdb-webdav-lockconf-config-')),
        data: mkdtempSync(join(tmpdir(), 'pdb-webdav-lockconf-data-')),
        log: mkdtempSync(join(tmpdir(), 'pdb-webdav-lockconf-log-')),
        temp: mkdtempSync(join(tmpdir(), 'pdb-webdav-lockconf-temp-')),
        cache: mkdtempSync(join(tmpdir(), 'pdb-webdav-lockconf-cache-')),
      };
    }
    return mockDirs;
  },
}));

import { WebDAVServer } from '../src/webdav/server.js';
import { LockManager } from '../src/webdav/LockManager.js';
import { driveClient } from '../src/drive.js';

let server: InstanceType<typeof WebDAVServer> | null = null;
let baseDir: string | null = null;

beforeEach(() => {
  mockDirs = null;
  baseDir = mkdtempSync(join(tmpdir(), 'pdb-webdav-lockconf-'));

  // Ensure DB file exists (create data dir and touch locks DB)
  const dataDir = getDataDir();
  mkdirSync(dataDir, { recursive: true });
  // Touch DB file to ensure sqlite can open it
  writeFileSync(`${dataDir}/locks.db`, '', { flag: 'a' });

  // Stub driveClient to avoid network/auth
  driveClient.initialize = async () => {};
  driveClient.getRootFolderUid = () => 'root';
  driveClient.listFolder = async () => [];
  driveClient.createFolder = async () => 'folder-uid';
  driveClient.deleteNode = async () => undefined;
  driveClient.uploadFile = async () => 'test-file-uid';
  driveClient.downloadFile = async () => new ReadableStream({ start: (c) => c.close() });
  driveClient.renameNode = async () => undefined;
  driveClient.moveNode = async () => undefined;
});

afterEach(async () => {
  try {
    const lm = LockManager.getInstance();
    // Remove all locks to ensure test isolation
    for (const l of lm.getAllLocks()) lm.deleteLock(l.token);
    lm.close();
  } catch {}

  if (server) await server.stop();
  server = null;

  if (baseDir) rmSync(baseDir, { recursive: true, force: true });
  baseDir = null;

  if (mockDirs) {
    Object.values(mockDirs).forEach((dir) => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    });
    mockDirs = null;
  }
});

// These tests assert behavior when a depth:infinity lock is applied to a collection
// and ensure child modifications are blocked until unlock.
describe('WebDAV LOCK depth/infinity conflicts', () => {
  it('LOCK on collection (depth: infinity) prevents PUT to child resource', async () => {
    server = new WebDAVServer({ host: '127.0.0.1', port: 0, requireAuth: false });
    await server.start();

    const httpServer = server?.getHttpServer();
    if (!httpServer) throw new Error('HTTP server not available');
    const port = (httpServer.address() as import('net').AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    // Create collection
    const mkcol = await fetch(`${baseUrl}/parent/`, { method: 'MKCOL' });
    expect(mkcol.status).toBeGreaterThanOrEqual(200);

    // Lock the collection with depth=infinity
    const lockBody = `<?xml version="1.0" encoding="utf-8" ?>\n<D:lockinfo xmlns:D="DAV:">\n  <D:lockscope><D:exclusive/></D:lockscope>\n  <D:locktype><D:write/></D:locktype>\n  <D:owner><D:href>client</D:href></D:owner>\n</D:lockinfo>`;

    const lockResp = await fetch(`${baseUrl}/parent/`, {
      method: 'LOCK',
      headers: { Depth: 'infinity', 'Content-Type': 'application/xml; charset="utf-8"' },
      body: lockBody,
    });

    expect(lockResp.status).toBeGreaterThanOrEqual(200);

    // Confirm lock persisted in LockManager
    const lm = LockManager.getInstance();
    const locks = lm.getAllLocks();
    expect(locks.some((l) => l.path === '/parent/' || l.path === '/parent')).toBeTruthy();

    // Attempt to PUT child
    const putResp = await fetch(`${baseUrl}/parent/child.txt`, { method: 'PUT', body: 'data' });

    // Expect Locked (423) per RFC 4918
    expect(putResp.status).toBe(423);
  }, { timeout: 10000 });

  it('UNLOCKing collection allows PUT to child resource', async () => {
    server = new WebDAVServer({ host: '127.0.0.1', port: 0, requireAuth: false });
    await server.start();

    const httpServer = server?.getHttpServer();
    if (!httpServer) throw new Error('HTTP server not available');
    const port = (httpServer.address() as import('net').AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    // Create collection
    const mkcol = await fetch(`${baseUrl}/parent/`, { method: 'MKCOL' });
    expect(mkcol.status).toBeGreaterThanOrEqual(200);

    // Lock the collection with depth=infinity
    const lockBody = `<?xml version="1.0" encoding="utf-8" ?>\n<D:lockinfo xmlns:D="DAV:">\n  <D:lockscope><D:exclusive/></D:lockscope>\n  <D:locktype><D:write/></D:locktype>\n  <D:owner><D:href>client</D:href></D:owner>\n</D:lockinfo>`;

    const lockResp = await fetch(`${baseUrl}/parent/`, {
      method: 'LOCK',
      headers: { Depth: 'infinity', 'Content-Type': 'application/xml; charset="utf-8"' },
      body: lockBody,
    });

    expect(lockResp.status).toBeGreaterThanOrEqual(200);
    const token = lockResp.headers.get('lock-token') || lockResp.headers.get('Lock-Token');
    expect(token).toBeTruthy();

    // Unlock
    const unlockResp = await fetch(`${baseUrl}/parent/`, {
      method: 'UNLOCK',
      headers: { 'Lock-Token': token || '' },
    });

    expect(unlockResp.status).toBeGreaterThanOrEqual(200);

    // Now PUT child
    const putResp = await fetch(`${baseUrl}/parent/child.txt`, { method: 'PUT', body: 'data' });
    expect(putResp.status).toBeGreaterThanOrEqual(200);
  }, { timeout: 10000 });
});
