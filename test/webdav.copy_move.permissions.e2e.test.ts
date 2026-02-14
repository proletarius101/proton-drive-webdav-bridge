import { vol } from 'memfs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { driveClient } from '../src/drive.ts';
import { WebDAVServer } from '../src/webdav/server.ts';

vi.mock('fs');
vi.mock('fs/promises');

beforeEach(() => {
  // reset the state of in-memory fs
  vol.reset();
});

interface Node {
  uid: string;
  name: string;
  type: 'file' | 'folder';
  parentUid: string | null;
  data?: Uint8Array;
}

describe('WebDAV COPY/MOVE permission semantics', () => {
  const nodes = new Map<string, Node>();
  const children = new Map<string, Set<string>>();
  let uidCounter = 0;

  const createUid = () => `n-${uidCounter++}`;
  const ensure = (p: string) => {
    if (!children.has(p)) children.set(p, new Set());
    return children.get(p)!;
  };
  const add = (n: Node) => {
    nodes.set(n.uid, n);
    if (n.parentUid) ensure(n.parentUid).add(n.uid);
  };

  beforeAll(() => {
    // Force file-based encrypted storage for keyring (not testing keyring itself)
    vi.stubEnv('KEY_FILE_PASSWORD', 'test-keyring-password');

    const root = { uid: 'root', name: '', type: 'folder', parentUid: null };
    add(root as Node);

    // src.txt
    const src = createUid();
    add({ uid: src, name: 'src.txt', type: 'file', parentUid: 'root', data: new Uint8Array([1]) });

    driveClient.initialize = async () => {};
    driveClient.getRootFolderUid = () => 'root';
    driveClient.listFolder = async (uid: string) => {
      const set = children.get(uid) || new Set<string>();
      return Array.from(set).map((id) => {
        const n = nodes.get(id)!;
        return { uid: n.uid, name: n.name, type: n.type, size: n.data?.length ?? 0 };
      });
    };
    driveClient.downloadFile = async (uid: string) =>
      new ReadableStream({ start: (c) => c.close() });
    driveClient.uploadFile = async (parentUid: string, name: string) => {
      // If a node with same name exists, emulate overwrite semantics for Overwrite:F tests by throwing
      const existing = Array.from(children.get(parentUid) || new Set())
        .map((id) => nodes.get(id)!)
        .find((n) => n.name === name);
      if (existing) {
        // Emulate precondition failed
        const e: any = new Error('Destination exists');
        e.statusCode = 412;
        throw e;
      }
      const uid = createUid();
      add({ uid, name, type: 'file', parentUid });
      return uid;
    };
    driveClient.moveNode = async (uid: string, newParentUid: string) => {
      const node = nodes.get(uid);
      if (!node) throw new Error('Not found');
      // Move to newParent
      if (node.parentUid) children.get(node.parentUid)?.delete(uid);
      node.parentUid = newParentUid;
      ensure(newParentUid).add(uid);
    };
    driveClient.renameNode = async (uid: string, newName: string) => {
      const node = nodes.get(uid);
      if (node) node.name = newName;
    };
  });

  it('COPY to existing destination with Overwrite:F returns 412', async () => {
    // Create destination first
    const dest = createUid();
    add({
      uid: dest,
      name: 'dest.txt',
      type: 'file',
      parentUid: 'root',
      data: new Uint8Array([9]),
    });

    const server = new WebDAVServer({ host: '127.0.0.1', port: 0, requireAuth: false });
    await server.start();
    const httpServer = server.getHttpServer();
    if (!httpServer) throw new Error('HTTP server not available');
    const port = (httpServer.address() as import('net').AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const resp = await fetch(`${baseUrl}/src.txt`, {
        method: 'COPY',
        headers: { Destination: `${baseUrl}/dest.txt`, Overwrite: 'F' },
      });
      expect(resp.status).toBe(412);
    } finally {
      await server.stop();
    }
  });

  it('MOVE into an existing non-empty collection returns 403', async () => {
    // Create destdir/ with a file inside
    const destdir = createUid();
    add({ uid: destdir, name: 'destdir', type: 'folder', parentUid: 'root' });
    const inside = createUid();
    add({ uid: inside, name: 'keep.txt', type: 'file', parentUid: destdir });

    const server = new WebDAVServer({ host: '127.0.0.1', port: 0, requireAuth: false });
    await server.start();
    const httpServer = server.getHttpServer();
    if (!httpServer) throw new Error('HTTP server not available');
    const port = (httpServer.address() as import('net').AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const resp = await fetch(`${baseUrl}/src.txt`, {
        method: 'MOVE',
        headers: { Destination: `${baseUrl}/destdir/` },
      });
      expect(resp.status).toBe(403);
    } finally {
      await server.stop();
    }
  });
});
