import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { beforeAll, afterAll, describe, it, expect, mock } from 'bun:test';

import { WebDAVServer } from '../src/webdav/server.ts';
import { driveClient } from '../src/drive.ts';

// Note: These E2E tests should be run separately from other tests to avoid
// singleton/resource conflicts. Run with: bun test test/webdav.propfind.e2e.test.ts
// Mock env-paths to avoid using real data dirs
const DEFAULT_PATHS_BASE = mkdtempSync(join(tmpdir(), 'pdb-webdav-propfind-default-'));
let pathsBase = DEFAULT_PATHS_BASE;
mock.module('env-paths', () => ({
  default: () => ({
    config: join(pathsBase, 'config'),
    data: join(pathsBase, 'data'),
    log: join(pathsBase, 'log'),
    temp: join(pathsBase, 'temp'),
    cache: join(pathsBase, 'cache'),
  }),
}));

interface Node {
  uid: string;
  name: string;
  type: 'file' | 'folder';
  parentUid: string | null;
  data?: Uint8Array;
  createdTime: Date;
  modifiedTime: Date;
}

describe('WebDAV PROPFIND recursion and filtering', () => {
  const nodes = new Map<string, Node>();
  const children = new Map<string, Set<string>>();
  let uidCounter = 0;

  const createUid = () => `node-${uidCounter++}`;
  const ensureChildSet = (parentUid: string) => {
    if (!children.has(parentUid)) children.set(parentUid, new Set());
    return children.get(parentUid)!;
  };

  const addNode = (node: Node) => {
    nodes.set(node.uid, node);
    if (node.parentUid) ensureChildSet(node.parentUid).add(node.uid);
  };

  const readStream = async (
    stream: ReadableStream | AsyncIterable<Uint8Array> | Uint8Array | Buffer
  ) => {
    if (stream instanceof Uint8Array) return stream;
    const chunks: Uint8Array[] = [];
    let total = 0;
    if ((stream as ReadableStream).getReader) {
      const r = (stream as ReadableStream).getReader();
      while (true) {
        const { done, value } = await r.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value as any);
        chunks.push(chunk);
        total += chunk.length;
      }
    } else {
      for await (const value of stream as AsyncIterable<Uint8Array | Buffer>) {
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value as any);
        chunks.push(chunk);
        total += chunk.length;
      }
    }
    const res = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      res.set(c, off);
      off += c.length;
    }
    return res;
  };

  // Create isolated temporary directories for this test suite
  let baseDir: string;

  beforeAll(() => {
    // Set up isolated temp directory for this entire test suite
    baseDir = mkdtempSync(join(tmpdir(), 'pdb-webdav-propfind-'));
    pathsBase = baseDir;

    // Force file-based encrypted storage for keyring (not testing keyring itself)
    process.env.KEYRING_PASSWORD = 'test-keyring-password';

    const root: Node = {
      uid: 'root',
      name: '',
      type: 'folder',
      parentUid: null,
      createdTime: new Date(),
      modifiedTime: new Date(),
    };
    addNode(root);

    // Build tree: /a/   /a/b/  /a/b/nested.txt   /file1.txt
    const aUid = createUid();
    addNode({
      uid: aUid,
      name: 'a',
      type: 'folder',
      parentUid: 'root',
      createdTime: new Date(),
      modifiedTime: new Date(),
    });
    const bUid = createUid();
    addNode({
      uid: bUid,
      name: 'b',
      type: 'folder',
      parentUid: aUid,
      createdTime: new Date(),
      modifiedTime: new Date(),
    });
    const nestedUid = createUid();
    addNode({
      uid: nestedUid,
      name: 'nested.txt',
      type: 'file',
      parentUid: bUid,
      data: new Uint8Array([1, 2, 3]),
      createdTime: new Date(),
      modifiedTime: new Date(),
    });
    const file1 = createUid();
    addNode({
      uid: file1,
      name: 'file1.txt',
      type: 'file',
      parentUid: 'root',
      data: new Uint8Array([4, 5, 6]),
      createdTime: new Date(),
      modifiedTime: new Date(),
    });

    // Stub driveClient
    driveClient.initialize = async () => {};
    driveClient.getRootFolderUid = () => 'root';
    driveClient.listFolder = async (uid: string) => {
      const set = children.get(uid) || new Set<string>();
      return Array.from(set).map((id) => {
        const n = nodes.get(id)!;
        return {
          uid: n.uid,
          name: n.name,
          type: n.type,
          size: n.data?.length || 0,
          mimeType: n.type === 'folder' ? 'inode/directory' : 'application/octet-stream',
          createdTime: n.createdTime,
          modifiedTime: n.modifiedTime,
          parentUid: n.parentUid,
        };
      });
    };
    driveClient.downloadFile = async (uid: string) => {
      const data = nodes.get(uid)?.data || new Uint8Array();
      return new ReadableStream({
        start(controller) {
          controller.enqueue(data);
          controller.close();
        },
      });
    };

    // Allow uploads during tests and reflect them in the in-memory nodes map
    driveClient.uploadFile = async (
      parentUid: string,
      name: string,
      content: ReadableStream | Uint8Array | Buffer,
      _opts?: unknown
    ) => {
      const newUid = createUid();
      let data: Uint8Array;
      if (content instanceof Uint8Array) {
        data = content;
      } else {
        data = await readStream(content as ReadableStream);
      }
      addNode({
        uid: newUid,
        name,
        type: 'file',
        parentUid: parentUid,
        data,
        createdTime: new Date(),
        modifiedTime: new Date(),
      });
      return newUid;
    };
  });

  afterAll(() => {
    rmSync(baseDir, { recursive: true, force: true });
    pathsBase = DEFAULT_PATHS_BASE;
    delete process.env.KEYRING_PASSWORD;
  });

  it('PROPFIND depth=infinity returns all members', async () => {
    const server = new WebDAVServer({ host: '127.0.0.1', port: 0, requireAuth: false });
    await server.start();

    const httpServer = server.getHttpServer();
    if (!httpServer) throw new Error('HTTP server not available');
    const port = (httpServer.address() as import('net').AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const body = `<?xml version="1.0" encoding="utf-8" ?>\n<D:propfind xmlns:D="DAV:">\n  <D:allprop/>\n</D:propfind>`;
      const resp = await fetch(`${baseUrl}/`, {
        method: 'PROPFIND',
        headers: { Depth: 'infinity', 'Content-Type': 'application/xml' },
        body,
      });
      expect(resp.status).toBe(207);
      const text = await resp.text();

      // Check that nested hrefs are present
      expect(text).toContain('/a/');
      expect(text).toContain('/a/b/');
      expect(text).toContain('/a/b/nested.txt');
      expect(text).toContain('/file1.txt');
    } finally {
      await server.stop();
    }
  });

  it('PROPFIND depth=1 returns only immediate children', async () => {
    const server = new WebDAVServer({ host: '127.0.0.1', port: 0, requireAuth: false });
    await server.start();

    const httpServer = server.getHttpServer();
    if (!httpServer) throw new Error('HTTP server not available');
    const port = (httpServer.address() as import('net').AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const body = `<?xml version="1.0" encoding="utf-8" ?>\n<D:propfind xmlns:D="DAV:">\n  <D:allprop/>\n</D:propfind>`;
      const resp = await fetch(`${baseUrl}/`, {
        method: 'PROPFIND',
        headers: { Depth: '1', 'Content-Type': 'application/xml' },
        body,
      });
      expect(resp.status).toBe(207);
      const text = await resp.text();
      // Immediate children should include /a but not /a/b
      expect(text).toContain('/a');
      expect(text).not.toContain('/a/b');
    } finally {
      await server.stop();
    }
  });

  it('PROPFIND with prop filter returns requested properties only', async () => {
    const server = new WebDAVServer({ host: '127.0.0.1', port: 0, requireAuth: false });
    await server.start();

    const httpServer = server.getHttpServer();
    if (!httpServer) throw new Error('HTTP server not available');
    const port = (httpServer.address() as import('net').AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const body = `<?xml version="1.0" encoding="utf-8" ?>\n<D:propfind xmlns:D="DAV:">\n  <D:prop>\n    <D:getlastmodified/>\n  </D:prop>\n</D:propfind>`;
      const resp = await fetch(`${baseUrl}/a/`, {
        method: 'PROPFIND',
        headers: { Depth: '0', 'Content-Type': 'application/xml' },
        body,
      });
      expect(resp.status).toBe(207);
      const text = await resp.text();
      // Response should include the requested property name
      expect(text).toContain('getlastmodified');
    } finally {
      await server.stop();
    }
  });

  // New tests for caching behavior
  it('PROPFIND uses folder cache to avoid repeated API calls', async () => {
    const server = new WebDAVServer({ host: '127.0.0.1', port: 0, requireAuth: false });
    await server.start();

    const httpServer = server.getHttpServer();
    if (!httpServer) throw new Error('HTTP server not available');
    const port = (httpServer.address() as import('net').AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const originalList = driveClient.listFolder;
      let calls = 0;
      driveClient.listFolder = async (uid: string) => {
        calls++;
        return originalList(uid);
      };

      const body = `<?xml version="1.0" encoding="utf-8" ?>\n<D:propfind xmlns:D="DAV:">\n  <D:allprop/>\n</D:propfind>`;

      // First PROPFIND primes the cache
      const resp1 = await fetch(`${baseUrl}/`, {
        method: 'PROPFIND',
        headers: { Depth: '1', 'Content-Type': 'application/xml' },
        body,
      });
      expect(resp1.status).toBe(207);
      const callsAfterFirst = calls;

      // Second PROPFIND should not cause additional listFolder calls (cache hit)
      const resp2 = await fetch(`${baseUrl}/`, {
        method: 'PROPFIND',
        headers: { Depth: '1', 'Content-Type': 'application/xml' },
        body,
      });
      expect(resp2.status).toBe(207);
      expect(calls).toBe(callsAfterFirst);
    } finally {
      await server.stop();
    }
  });

  it('Cache invalidates after PUT and subsequent PROPFIND triggers re-fetch', async () => {
    const server = new WebDAVServer({ host: '127.0.0.1', port: 0, requireAuth: false });
    await server.start();

    const httpServer = server.getHttpServer();
    if (!httpServer) throw new Error('HTTP server not available');
    const port = (httpServer.address() as import('net').AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const originalList = driveClient.listFolder;
      let calls = 0;
      driveClient.listFolder = async (uid: string) => {
        calls++;
        return originalList(uid);
      };

      const body = `<?xml version="1.0" encoding="utf-8" ?>\n<D:propfind xmlns:D="DAV:">\n  <D:allprop/>\n</D:propfind>`;

      // Prime the cache
      const resp1 = await fetch(`${baseUrl}/`, {
        method: 'PROPFIND',
        headers: { Depth: '1', 'Content-Type': 'application/xml' },
        body,
      });
      expect(resp1.status).toBe(207);
      const callsAfterFirst = calls;

      // Upload a new file to root (should invalidate folder cache)
      const putResp = await fetch(`${baseUrl}/newfile.txt`, {
        method: 'PUT',
        body: new Uint8Array([7, 8, 9]),
      });
      expect([200, 201, 204].includes(putResp.status)).toBeTruthy();

      // Next PROPFIND should cause listFolder to be called again (cache refreshed)
      const resp2 = await fetch(`${baseUrl}/`, {
        method: 'PROPFIND',
        headers: { Depth: '1', 'Content-Type': 'application/xml' },
        body,
      });
      expect(resp2.status).toBe(207);
      expect(calls).toBeGreaterThan(callsAfterFirst);
    } finally {
      await server.stop();
    }
  });
});
