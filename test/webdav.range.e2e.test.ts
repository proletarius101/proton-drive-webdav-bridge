/**
 * E2E Tests - HTTP Range Request Support
 *
 * Tests partial content (206) responses for Range header requests.
 * Validates that video scrubbing and large file partial reads work correctly.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';

import { WebDAVServer } from '../src/webdav/server.ts';
import { driveClient } from '../src/drive.ts';
import type { SeekableReadableStream } from '../src/drive.ts';
import { createFileDownloader } from './utils/seekableMock.ts';

// Mock env-paths to avoid auth attempts
const pathsBase = mkdtempSync(join(tmpdir(), 'pdb-range-e2e-'));
mock.module('env-paths', () => ({
  default: () => ({
    config: join(pathsBase, 'config'),
    data: join(pathsBase, 'data'),
    log: join(pathsBase, 'log'),
    temp: join(pathsBase, 'temp'),
    cache: join(pathsBase, 'cache'),
  }),
}));

interface InMemoryNode {
  uid: string;
  name: string;
  type: 'file' | 'folder';
  parentUid: string | null;
  data?: Uint8Array;
  createdTime: Date;
  modifiedTime: Date;
}

describe('webdav range requests', () => {
  const nodes = new Map<string, InMemoryNode>();
  const children = new Map<string, Set<string>>();
  let uidCounter = 0;

  const originalMethods = {
    initialize: driveClient.initialize.bind(driveClient),
    getRootFolderUid: driveClient.getRootFolderUid.bind(driveClient),
    listFolder: driveClient.listFolder.bind(driveClient),
    createFolder: driveClient.createFolder.bind(driveClient),
    deleteNode: driveClient.deleteNode.bind(driveClient),
    uploadFile: driveClient.uploadFile.bind(driveClient),
    downloadFile: driveClient.downloadFile.bind(driveClient),
    getFileDownloader: driveClient.getFileDownloader.bind(driveClient),
    renameNode: driveClient.renameNode.bind(driveClient),
    moveNode: driveClient.moveNode.bind(driveClient),
    resolvePath: driveClient.resolvePath.bind(driveClient),
    findNodeByName: driveClient.findNodeByName.bind(driveClient),
    getNode: driveClient.getNode.bind(driveClient),
  };

  const createUid = () => `node-${uidCounter++}`;

  const ensureChildSet = (parentUid: string) => {
    if (!children.has(parentUid)) {
      children.set(parentUid, new Set());
    }
    return children.get(parentUid)!;
  };

  const addNode = (node: InMemoryNode) => {
    nodes.set(node.uid, node);
    if (node.parentUid) {
      ensureChildSet(node.parentUid).add(node.uid);
    }
  };

  const removeNode = (uid: string) => {
    const node = nodes.get(uid);
    if (!node) return;
    const childSet = children.get(uid);
    if (childSet) {
      for (const childUid of childSet) {
        removeNode(childUid);
      }
      children.delete(uid);
    }
    if (node.parentUid) {
      children.get(node.parentUid)?.delete(uid);
    }
    nodes.delete(uid);
  };

  const readStream = async (
    stream: ReadableStream | AsyncIterable<Uint8Array> | Uint8Array | Buffer
  ): Promise<Uint8Array> => {
    if (stream instanceof Uint8Array) {
      return stream;
    }

    const chunks: Uint8Array[] = [];
    let total = 0;

    if (typeof (stream as ReadableStream).getReader === 'function') {
      const reader = (stream as ReadableStream).getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // Handle strings from fetch body
        let chunk: Uint8Array;
        if (typeof value === 'string') {
          chunk = new TextEncoder().encode(value);
        } else if (value instanceof Uint8Array) {
          chunk = value;
        } else {
          chunk = new Uint8Array(value);
        }
        chunks.push(chunk);
        total += chunk.length;
      }
    } else {
      for await (const value of stream as AsyncIterable<Uint8Array | Buffer>) {
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        chunks.push(chunk);
        total += chunk.length;
      }
    }

    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  };



  beforeAll(() => {
    const rootNode: InMemoryNode = {
      uid: 'root',
      name: '',
      type: 'folder',
      parentUid: null,
      createdTime: new Date(),
      modifiedTime: new Date(),
    };
    addNode(rootNode);

    driveClient.initialize = async () => {};
    driveClient.getRootFolderUid = () => 'root';
    driveClient.listFolder = async (folderUid: string) => {
      const childIds = children.get(folderUid) || new Set<string>();
      return Array.from(childIds)
        .map((uid) => nodes.get(uid)!)
        .map((node) => ({
          uid: node.uid,
          name: node.name,
          type: node.type,
          size: node.data?.length || 0,
          mimeType: node.type === 'folder' ? 'inode/directory' : 'application/octet-stream',
          createdTime: node.createdTime,
          modifiedTime: node.modifiedTime,
          parentUid: node.parentUid,
        }));
    };
    driveClient.createFolder = async (parentUid: string, name: string) => {
      const uid = createUid();
      addNode({
        uid,
        name,
        type: 'folder',
        parentUid,
        createdTime: new Date(),
        modifiedTime: new Date(),
      });
      return uid;
    };
    driveClient.deleteNode = async (uid: string) => {
      removeNode(uid);
    };
    driveClient.uploadFile = async (
      parentUid: string,
      name: string,
      content: ReadableStream | Buffer | Uint8Array
    ) => {
      const data = await readStream(
        content as ReadableStream | AsyncIterable<Uint8Array> | Uint8Array | Buffer
      );
      const existingId = Array.from(children.get(parentUid) || new Set<string>())
        .map((uid) => nodes.get(uid)!)
        .find((node) => node.type === 'file' && node.name === name)?.uid;
      if (existingId) {
        nodes.get(existingId)!.data = data;
        nodes.get(existingId)!.modifiedTime = new Date();
        return existingId;
      }
      const uid = createUid();
      addNode({
        uid,
        name,
        type: 'file',
        parentUid,
        data,
        createdTime: new Date(),
        modifiedTime: new Date(),
      });
      return uid;
    };
    driveClient.downloadFile = async (uid: string) => {
      const node = nodes.get(uid);
      const data = node?.data || new Uint8Array();
      return new ReadableStream({
        start(controller) {
          controller.enqueue(data);
          controller.close();
        },
      });
    };
    // Mock getFileDownloader to return a downloader with getSeekableStream
    driveClient.getFileDownloader = async (uid: string) => {
      const node = nodes.get(uid);
      const data = node?.data || new Uint8Array();
      return createFileDownloader(data);
    };
    driveClient.renameNode = async (uid: string, newName: string) => {
      const node = nodes.get(uid);
      if (node) {
        node.name = newName;
        node.modifiedTime = new Date();
      }
    };
    driveClient.moveNode = async (uid: string, newParentUid: string) => {
      const node = nodes.get(uid);
      if (!node) return;
      if (node.parentUid) {
        children.get(node.parentUid)?.delete(uid);
      }
      node.parentUid = newParentUid;
      ensureChildSet(newParentUid).add(uid);
      node.modifiedTime = new Date();
    };
    // Mock resolvePath to walk the in-memory node tree
    driveClient.resolvePath = async (path: string) => {
      const parts = path.split('/').filter((p) => p.length > 0);
      if (parts.length === 0) {
        return { uid: 'root', type: 'folder' as const };
      }
      let currentUid = 'root';
      for (const part of parts) {
        const childIds = children.get(currentUid) || new Set<string>();
        let found: InMemoryNode | undefined;
        for (const childUid of childIds) {
          const child = nodes.get(childUid);
          if (child && child.name === part) {
            found = child;
            break;
          }
        }
        if (!found) return null;
        currentUid = found.uid;
      }
      const finalNode = nodes.get(currentUid);
      return finalNode ? { uid: finalNode.uid, type: finalNode.type } : null;
    };
    driveClient.findNodeByName = async (folderUid: string, name: string) => {
      const childIds = children.get(folderUid) || new Set<string>();
      for (const childUid of childIds) {
        const child = nodes.get(childUid);
        if (child && child.name === name) {
          return { uid: child.uid, type: child.type };
        }
      }
      return null;
    };
    // Mock getNode to return full node details
    driveClient.getNode = async (uid: string) => {
      const node = nodes.get(uid);
      if (!node) return null;
      return {
        uid: node.uid,
        name: node.name,
        type: node.type,
        creationTime: node.createdTime,
        modificationTime: node.modifiedTime,
        parentUid: node.parentUid,
        activeRevision: node.data
          ? {
              claimedSize: node.data.length,
              claimedModificationTime: node.modifiedTime,
            }
          : undefined,
        mediaType: node.type === 'folder' ? 'inode/directory' : 'application/octet-stream',
      };
    };
  });

  afterAll(() => {
    driveClient.initialize = originalMethods.initialize;
    driveClient.getRootFolderUid = originalMethods.getRootFolderUid;
    driveClient.listFolder = originalMethods.listFolder;
    driveClient.createFolder = originalMethods.createFolder;
    driveClient.deleteNode = originalMethods.deleteNode;
    driveClient.uploadFile = originalMethods.uploadFile;
    driveClient.downloadFile = originalMethods.downloadFile;
    driveClient.getFileDownloader = originalMethods.getFileDownloader;
    driveClient.renameNode = originalMethods.renameNode;
    driveClient.moveNode = originalMethods.moveNode;
    driveClient.resolvePath = originalMethods.resolvePath;
    driveClient.findNodeByName = originalMethods.findNodeByName;
    driveClient.getNode = originalMethods.getNode;
    rmSync(pathsBase, { recursive: true, force: true });
  });

  it('returns 206 Partial Content for Range requests', async () => {
    const server = new WebDAVServer({ host: '127.0.0.1', port: 0, requireAuth: false });
    await server.start();

    const httpServer = (server as unknown as { httpServer: { address: () => { port: number } } })
      .httpServer;
    const port = httpServer.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // Create a test file with known content
      const testContent = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      const putResponse = await fetch(`${baseUrl}/range-test.txt`, {
        method: 'PUT',
        body: testContent,
      });
      expect(putResponse.status).toBeGreaterThanOrEqual(200);
      expect(putResponse.status).toBeLessThan(300);

      // Request bytes 0-9 (first 10 bytes)
      const rangeResponse = await fetch(`${baseUrl}/range-test.txt`, {
        headers: { Range: 'bytes=0-9' },
      });

      expect(rangeResponse.status).toBe(206);
      expect(rangeResponse.headers.get('Content-Range')).toMatch(/^bytes 0-9\/36$/);

      const partialContent = await rangeResponse.text();
      expect(partialContent).toBe('ABCDEFGHIJ');
    } catch (err) {
      throw err;
    } finally {
      await server.stop();
    }
  });

  it('returns correct bytes for middle range', async () => {
    const server = new WebDAVServer({ host: '127.0.0.1', port: 0, requireAuth: false });
    await server.start();

    const httpServer = (server as unknown as { httpServer: { address: () => { port: number } } })
      .httpServer;
    const port = httpServer.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const testContent = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      await fetch(`${baseUrl}/range-middle.txt`, {
        method: 'PUT',
        body: testContent,
      });

      // Request bytes 10-19 (middle 10 bytes)
      const rangeResponse = await fetch(`${baseUrl}/range-middle.txt`, {
        headers: { Range: 'bytes=10-19' },
      });

      expect(rangeResponse.status).toBe(206);
      const partialContent = await rangeResponse.text();
      expect(partialContent).toBe('KLMNOPQRST');
    } finally {
      await server.stop();
    }
  });

  it('returns correct bytes for end range', async () => {
    const server = new WebDAVServer({ host: '127.0.0.1', port: 0, requireAuth: false });
    await server.start();

    const httpServer = (server as unknown as { httpServer: { address: () => { port: number } } })
      .httpServer;
    const port = httpServer.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const testContent = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      await fetch(`${baseUrl}/range-end.txt`, {
        method: 'PUT',
        body: testContent,
      });

      // Request last 10 bytes using explicit range (bytes 26-35 of 36-byte file)
      const rangeResponse = await fetch(`${baseUrl}/range-end.txt`, {
        headers: { Range: 'bytes=26-35' },
      });

      expect(rangeResponse.status).toBe(206);
      const partialContent = await rangeResponse.text();
      expect(partialContent).toBe('0123456789');
    } finally {
      await server.stop();
    }
  });

  it('returns full content without Range header', async () => {
    const server = new WebDAVServer({ host: '127.0.0.1', port: 0, requireAuth: false });
    await server.start();

    const httpServer = (server as unknown as { httpServer: { address: () => { port: number } } })
      .httpServer;
    const port = httpServer.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const testContent = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      await fetch(`${baseUrl}/range-full.txt`, {
        method: 'PUT',
        body: testContent,
      });

      // Request without Range header
      const response = await fetch(`${baseUrl}/range-full.txt`);

      expect(response.status).toBe(200);
      const content = await response.text();
      expect(content).toBe(testContent);
    } finally {
      await server.stop();
    }
  });

  it('handles large file range requests efficiently', async () => {
    const server = new WebDAVServer({ host: '127.0.0.1', port: 0, requireAuth: false });
    await server.start();

    const httpServer = (server as unknown as { httpServer: { address: () => { port: number } } })
      .httpServer;
    const port = httpServer.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // Create a larger test file (1MB)
      const size = 1024 * 1024;
      const largeContent = new Uint8Array(size);
      for (let i = 0; i < size; i++) {
        largeContent[i] = i % 256;
      }

      await fetch(`${baseUrl}/large-file.bin`, {
        method: 'PUT',
        body: largeContent,
      });

      // Request only first 1KB
      const rangeResponse = await fetch(`${baseUrl}/large-file.bin`, {
        headers: { Range: 'bytes=0-1023' },
      });

      expect(rangeResponse.status).toBe(206);
      const partialData = new Uint8Array(await rangeResponse.arrayBuffer());
      expect(partialData.length).toBe(1024);

      // Verify the content is correct
      for (let i = 0; i < 1024; i++) {
        expect(partialData[i]).toBe(i % 256);
      }
    } finally {
      await server.stop();
    }
  });

  it('handles range request from middle of large file', async () => {
    const server = new WebDAVServer({ host: '127.0.0.1', port: 0, requireAuth: false });
    await server.start();

    const httpServer = (server as unknown as { httpServer: { address: () => { port: number } } })
      .httpServer;
    const port = httpServer.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // Create a 100KB file
      const size = 100 * 1024;
      const content = new Uint8Array(size);
      for (let i = 0; i < size; i++) {
        content[i] = i % 256;
      }

      await fetch(`${baseUrl}/video-sim.bin`, {
        method: 'PUT',
        body: content,
      });

      // Simulate video scrubbing - request bytes from middle (50KB offset, 1KB length)
      const offset = 50 * 1024;
      const length = 1024;
      const rangeResponse = await fetch(`${baseUrl}/video-sim.bin`, {
        headers: { Range: `bytes=${offset}-${offset + length - 1}` },
      });

      expect(rangeResponse.status).toBe(206);
      const partialData = new Uint8Array(await rangeResponse.arrayBuffer());
      expect(partialData.length).toBe(length);

      // Verify content is from correct offset
      for (let i = 0; i < length; i++) {
        expect(partialData[i]).toBe((offset + i) % 256);
      }
    } finally {
      await server.stop();
    }
  });

  it('returns Accept-Ranges header on GET', async () => {
    const server = new WebDAVServer({ host: '127.0.0.1', port: 0, requireAuth: false });
    await server.start();

    const httpServer = (server as unknown as { httpServer: { address: () => { port: number } } })
      .httpServer;
    const port = httpServer.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      await fetch(`${baseUrl}/accept-ranges.txt`, {
        method: 'PUT',
        body: 'test content',
      });

      const response = await fetch(`${baseUrl}/accept-ranges.txt`);
      expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    } finally {
      await server.stop();
    }
  });
});
