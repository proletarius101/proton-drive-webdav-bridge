import { createHash } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';

import { WebDAVServer } from '../src/webdav/server.ts';
import { driveClient } from '../src/drive.ts';

// Mock env-paths to avoid auth attempts
const pathsBase = mkdtempSync(join(tmpdir(), 'pdb-webdav-e2e-'));
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

describe('webdav e2e', () => {
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
    renameNode: driveClient.renameNode.bind(driveClient),
    moveNode: driveClient.moveNode.bind(driveClient),
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

  const readStream = async (stream: ReadableStream | AsyncIterable<Uint8Array> | Uint8Array | Buffer): Promise<Uint8Array> => {
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
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
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
      const data = await readStream(content as ReadableStream | AsyncIterable<Uint8Array> | Uint8Array | Buffer);
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
  });

  afterAll(() => {
    driveClient.initialize = originalMethods.initialize;
    driveClient.getRootFolderUid = originalMethods.getRootFolderUid;
    driveClient.listFolder = originalMethods.listFolder;
    driveClient.createFolder = originalMethods.createFolder;
    driveClient.deleteNode = originalMethods.deleteNode;
    driveClient.uploadFile = originalMethods.uploadFile;
    driveClient.downloadFile = originalMethods.downloadFile;
    driveClient.renameNode = originalMethods.renameNode;
    driveClient.moveNode = originalMethods.moveNode;
    rmSync(pathsBase, { recursive: true, force: true });
  });

  it('supports PUT/GET/DELETE', async () => {
    const server = new WebDAVServer({ host: '127.0.0.1', port: 0, requireAuth: false });
    await server.start();

    const httpServer = (server as unknown as { httpServer: { address: () => { port: number } } })
      .httpServer;
    const port = httpServer.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const putResponse = await fetch(`${baseUrl}/hello.txt`, {
        method: 'PUT',
        body: 'hello world',
      });
      expect(putResponse.status).toBeGreaterThanOrEqual(200);
      expect(putResponse.status).toBeLessThan(300);

      const getResponse = await fetch(`${baseUrl}/hello.txt`);
      const text = await getResponse.text();
      expect(text).toBe('hello world');

      const deleteResponse = await fetch(`${baseUrl}/hello.txt`, { method: 'DELETE' });
      expect(deleteResponse.status).toBeGreaterThanOrEqual(200);
      expect(deleteResponse.status).toBeLessThan(300);
    } finally {
      await server.stop();
    }
  });

  it('supports MKCOL and nested PUT', async () => {
    const server = new WebDAVServer({ host: '127.0.0.1', port: 0, requireAuth: false });
    await server.start();

    const httpServer = (server as unknown as { httpServer: { address: () => { port: number } } })
      .httpServer;
    const port = httpServer.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const mkcolResponse = await fetch(`${baseUrl}/folder/`, { method: 'MKCOL' });
      expect(mkcolResponse.status).toBeGreaterThanOrEqual(200);
      expect(mkcolResponse.status).toBeLessThan(300);

      const putResponse = await fetch(`${baseUrl}/folder/nested.txt`, {
        method: 'PUT',
        body: 'nested content',
      });
      expect(putResponse.status).toBeGreaterThanOrEqual(200);
      expect(putResponse.status).toBeLessThan(300);

      const getResponse = await fetch(`${baseUrl}/folder/nested.txt`);
      const text = await getResponse.text();
      expect(text).toBe('nested content');
    } finally {
      await server.stop();
    }
  });

  it('rejects requests without auth when enabled', async () => {
    const password = 'secret';
    const passwordHash = createHash('sha256').update(password).digest('hex');

    const server = new WebDAVServer({
      host: '127.0.0.1',
      port: 0,
      requireAuth: true,
      username: 'user',
      passwordHash,
    });
    await server.start();

    const httpServer = (server as unknown as { httpServer: { address: () => { port: number } } })
      .httpServer;
    const port = httpServer.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const unauthorized = await fetch(`${baseUrl}/auth.txt`, { method: 'PUT', body: 'data' });
      expect(unauthorized.status).toBe(401);

      const authHeader = Buffer.from(`user:${password}`).toString('base64');
      const authorized = await fetch(`${baseUrl}/auth.txt`, {
        method: 'PUT',
        headers: {
          Authorization: `Basic ${authHeader}`,
        },
        body: 'data',
      });
      expect(authorized.status).toBeGreaterThanOrEqual(200);
      expect(authorized.status).toBeLessThan(300);
    } finally {
      await server.stop();
    }
  });
});
