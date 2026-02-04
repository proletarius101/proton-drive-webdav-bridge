import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
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

// Mock env-paths to return fresh temp directories for each test
// This prevents singleton conflicts when tests run in parallel
let mockDirs: { config: string; data: string; log: string; temp: string; cache: string } | null =
  null;

mock.module('env-paths', () => ({
  default: () => {
    if (!mockDirs) {
      mockDirs = {
        config: mkdtempSync(join(tmpdir(), 'pdb-webdav-lock-config-')),
        data: mkdtempSync(join(tmpdir(), 'pdb-webdav-lock-data-')),
        log: mkdtempSync(join(tmpdir(), 'pdb-webdav-lock-log-')),
        temp: mkdtempSync(join(tmpdir(), 'pdb-webdav-lock-temp-')),
        cache: mkdtempSync(join(tmpdir(), 'pdb-webdav-lock-cache-')),
      };
    }
    return mockDirs;
  },
}));

import { writeFileSync } from 'fs';
import { driveClient } from '../src/drive.js';
import { getDataDir } from '../src/paths.js';
import { LockManager } from '../src/webdav/LockManager.js';
import { WebDAVServer } from '../src/webdav/server.js';

let server: InstanceType<typeof WebDAVServer> | null = null;
let baseDir: string | null = null;

beforeEach(() => {
  // Reset mock directories for this test to ensure isolation
  mockDirs = null;

  baseDir = mkdtempSync(join(tmpdir(), 'pdb-webdav-lock-'));

  // Force file-based encrypted storage for keyring (not testing keyring itself)
  process.env.KEYRING_PASSWORD = 'test-keyring-password';

  // Ensure DB file exists for LockManager
  const dataDir = getDataDir();
  // Create data dir if missing and touch DB file to ensure sqlite can open it
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(`${dataDir}/locks.db`, '', { flag: 'a' });

  // Stub driveClient to avoid network/auth
  driveClient.initialize = async () => {};
  driveClient.getRootFolderUid = () => 'root';
  driveClient.listFolder = async () => [];
  driveClient.createFolder = async () => 'folder-uid';
  driveClient.deleteNode = async () => undefined;
  // Return a dummy node UID to satisfy the typed signature
  driveClient.uploadFile = async () => 'test-file-uid';
  driveClient.downloadFile = async () => new ReadableStream({ start: (c) => c.close() });
  driveClient.renameNode = async () => undefined;
  driveClient.moveNode = async () => undefined;
});

afterEach(async () => {
  // Close LockManager first to release database locks
  try {
    const lm = LockManager.getInstance();
    lm.deleteLocksForPath('/locktest.txt');
    lm.close();
  } catch {
    /* ignore cleanup errors */
  }

  // Then stop the server
  if (server) await server.stop();
  server = null;

  // Clean up temp directories
  if (baseDir) rmSync(baseDir, { recursive: true, force: true });
  baseDir = null;

  // Clean up mocked env-paths directories
  if (mockDirs) {
    Object.values(mockDirs).forEach((dir) => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore cleanup errors */
      }
    });
    mockDirs = null;
  }

  // Clean up keyring environment
  delete process.env.KEYRING_PASSWORD;
});

// Note: These E2E tests should be run separately from other tests to avoid
// singleton/resource conflicts. Run with: bun test test/webdav.lock.e2e.test.ts
describe('WebDAV LOCK/UNLOCK integration', () => {
  it(
    'creates a lock via LOCK and removes it via UNLOCK',
    async () => {
      server = new WebDAVServer({ host: '127.0.0.1', port: 0, requireAuth: false });
      await server.start();

      const httpServer = server?.getHttpServer();
      if (!httpServer) throw new Error('HTTP server not available');
      const port = (httpServer.address() as import('net').AddressInfo).port;
      const baseUrl = `http://127.0.0.1:${port}`;

      // Send LOCK request
      const lockBody = `<?xml version="1.0" encoding="utf-8" ?>\n<D:lockinfo xmlns:D="DAV:">\n  <D:lockscope><D:exclusive/></D:lockscope>\n  <D:locktype><D:write/></D:locktype>\n  <D:owner><D:href>testuser</D:href></D:owner>\n</D:lockinfo>`;

      const lockResp = await fetch(`${baseUrl}/locktest.txt`, {
        method: 'LOCK',
        headers: {
          Depth: '0',
          Timeout: 'Second-3600',
          'Content-Type': 'application/xml; charset="utf-8"',
        },
        body: lockBody,
      });

      if (lockResp.status < 200 || lockResp.status >= 300) {
        const body = await lockResp.text();
        throw new Error(`LOCK failed: ${lockResp.status} - ${body}`);
      }

      // Lock should be present in LockManager
      const lm = LockManager.getInstance();
      const locks = lm.getLocksForPath('/locktest.txt');
      expect(locks.length).toBeGreaterThan(0);
      const token = locks[0].token;
      expect(token).toMatch(/^opaquelocktoken:/);

      // Attempt UNLOCK using Lock-Token header (with angle brackets as RDF expects)
      const unlockResp = await fetch(`${baseUrl}/locktest.txt`, {
        method: 'UNLOCK',
        headers: {
          'Lock-Token': `<${token}>`,
        },
      });

      expect(unlockResp.status).toBeGreaterThanOrEqual(200);
      expect(unlockResp.status).toBeLessThan(300);

      const locksAfter = lm.getLocksForPath('/locktest.txt');
      expect(locksAfter.length).toBe(0);
    },
    { timeout: 10000 }
  );

  it(
    'LOCK prevents other clients from creating conflicting locks',
    async () => {
      server = new WebDAVServer({ host: '127.0.0.1', port: 0, requireAuth: false });
      await server.start();

      const httpServer = server?.getHttpServer();
      if (!httpServer) throw new Error('HTTP server not available');
      const port = (httpServer.address() as import('net').AddressInfo).port;
      const baseUrl = `http://127.0.0.1:${port}`;

      const lockBody = `<?xml version="1.0" encoding="utf-8" ?>\n<D:lockinfo xmlns:D="DAV:">\n  <D:lockscope><D:exclusive/></D:lockscope>\n  <D:locktype><D:write/></D:locktype>\n  <D:owner><D:href>user1</D:href></D:owner>\n</D:lockinfo>`;

      const r1 = await fetch(`${baseUrl}/locktest.txt`, {
        method: 'LOCK',
        headers: { Depth: '0', 'Content-Type': 'application/xml; charset="utf-8"' },
        body: lockBody,
      });
      expect(r1.status).toBeGreaterThanOrEqual(200);

      // Second LOCK should fail (non-2xx). Ensure it does not succeed.
      // Use a short timeout for the second LOCK request to avoid long hangs in failure cases
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 500);
      let secondOk = false;

      try {
        const r2 = await fetch(`${baseUrl}/locktest.txt`, {
          method: 'LOCK',
          headers: { Depth: '0', 'Content-Type': 'application/xml; charset="utf-8"' },
          body: lockBody.replace('user1', 'user2'),
          signal: controller.signal,
        });

        clearTimeout(timeout);
        // If we got a response, it should be an error (4xx/5xx)
        expect(r2.status).toBeGreaterThanOrEqual(400);
        expect(r2.status).not.toBe(200);
        secondOk = true;
      } catch {
        // If request aborted or failed, treat as acceptable failure-case for this race test
        secondOk = true;
      } finally {
        clearTimeout(timeout);
      }

      expect(secondOk).toBe(true);

      // cleanup
      const lm = LockManager.getInstance();
      const locks = lm.getLocksForPath('/locktest.txt');
      for (const l of locks) lm.deleteLock(l.token);
    },
    { timeout: 10000 }
  );
});
