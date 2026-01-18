/**
 * Integration Tests - Drive Client Manager
 *
 * Tests DriveClientManager interface, error handling, and initialization.
 */

import { describe, test, expect } from 'bun:test';
import { DriveClientManager } from '../src/drive.js';
import type { ProtonDriveClient } from '../src/drive.js';

type ProtonHttpClient = {
  fetchJson: (req: unknown) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
  fetchBlob?: (req: unknown) => Promise<unknown>;
};

describe('DriveClientManager - Initialization', () => {
  test('should instantiate DriveClientManager', () => {
    const manager = new DriveClientManager();
    expect(manager).toBeDefined();
    expect(typeof manager).toBe('object');
  });

  test('should have all required methods', () => {
    const manager = new DriveClientManager();

    expect(typeof manager.initialize).toBe('function');
    expect(typeof manager.listFolder).toBe('function');
    expect(typeof manager.createFolder).toBe('function');
    expect(typeof manager.uploadFile).toBe('function');
    expect(typeof manager.downloadFile).toBe('function');
    expect(typeof manager.deleteNode).toBe('function');
    expect(typeof manager.renameNode).toBe('function');
    expect(typeof manager.moveNode).toBe('function');
    expect(typeof manager.resolvePath).toBe('function');
    expect(typeof manager.findNodeByName).toBe('function');
    expect(typeof manager.getRootFolderUid).toBe('function');
    expect(typeof manager.getUsername).toBe('function');
    expect(typeof manager.getClient).toBe('function');
  });
});

describe('DriveClientManager - Error Handling', () => {
  test('should throw error when getRootFolderUid called before initialization', () => {
    const manager = new DriveClientManager();

    try {
      manager.getRootFolderUid();
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBeDefined();
    }
  });

  test('should throw error when getUsername called before initialization', () => {
    const manager = new DriveClientManager();

    try {
      manager.getUsername();
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBeDefined();
    }
  });

  test('listFolder uses SDK iterateNodes when direct API is available', async () => {
    const manager = new DriveClientManager();

    // Mock httpClient.fetchJson to return LinkIDs (direct API)
    (manager as unknown as Record<string, unknown>).httpClient = {
      fetchJson: async () => ({
        ok: true,
        json: async () => ({ LinkIDs: ['id1', 'id2'], More: false }),
      }),
    } as unknown as ProtonHttpClient;

    const now = new Date();
    const mockNodes = [
      {
        uid: 'volume~id1',
        name: 'file1',
        type: 'file',
        mediaType: 'text/plain',
        creationTime: now,
        modificationTime: now,
        activeRevision: { storageSize: 123, claimedSize: 123, claimedModificationTime: now },
      },
      {
        uid: 'volume~id2',
        name: 'folder1',
        type: 'folder',
        creationTime: now,
        modificationTime: now,
        folder: { claimedModificationTime: now },
      },
    ];

    const captured: string[] = [];

    (manager as unknown as Record<string, unknown>).client = {
      iterateNodes: async function* (nodeUids: string[]) {
        captured.push(...nodeUids);
        for (const n of mockNodes) {
          yield { ok: true, value: n };
        }
      },
      // Minimal stubs for other methods possibly touched
      getMyFilesRootFolder: async () => ({ ok: true, value: { uid: 'volume~root' } }),
      getNode: async (_: string) => ({ ok: true, value: mockNodes[0] }),
      iterateFolderChildren: async function* () {},
    } as unknown as ProtonDriveClient;

    const result = await manager.listFolder('volume~parent');

    expect(captured).toEqual(['volume~id1', 'volume~id2']);
    expect(result.length).toBe(2);
    expect(result[0].uid).toBe('volume~id1');
    expect(result[0].name).toBe('file1');
    expect(result[1].type).toBe('folder');
  });

  test('listFolder skips missing nodes returned by iterateNodes', async () => {
    const manager = new DriveClientManager();

    // Mock httpClient.fetchJson to return LinkIDs (direct API)
    (manager as unknown as Record<string, unknown>).httpClient = {
      fetchJson: async () => ({
        ok: true,
        json: async () => ({ LinkIDs: ['id1', 'id2'], More: false }),
      }),
    } as unknown as ProtonHttpClient;

    const now = new Date();
    const mockNode = {
      uid: 'volume~id1',
      name: 'file1',
      type: 'file',
      mediaType: 'text/plain',
      creationTime: now,
      modificationTime: now,
      activeRevision: { storageSize: 123 },
    };

    const captured: string[] = [];

    (manager as Record<string, unknown>).client = {
      iterateNodes: async function* (nodeUids: string[]) {
        captured.push(...nodeUids);
        yield { ok: true, value: mockNode };
        yield { ok: false, error: { missingUid: 'volume~id2' } };
      },
      getMyFilesRootFolder: async () => ({ ok: true, value: { uid: 'volume~root' } }),
      getNode: async (_: string) => ({ ok: true, value: mockNode }),
      iterateFolderChildren: async function* () {},
    } as unknown as ProtonDriveClient;

    const result = await manager.listFolder('volume~parent');

    expect(captured).toEqual(['volume~id1', 'volume~id2']);
    expect(result.length).toBe(1);
    expect(result[0].uid).toBe('volume~id1');
    expect(result[0].name).toBe('file1');
  });

  test('listFolder includes degraded nodes returned by iterateNodes', async () => {
    const manager = new DriveClientManager();

    // Mock httpClient.fetchJson to return LinkIDs (direct API)
    (manager as unknown as Record<string, unknown>).httpClient = {
      fetchJson: async () => ({
        ok: true,
        json: async () => ({ LinkIDs: ['id1', 'id2'], More: false }),
      }),
    } as unknown as ProtonHttpClient;

    const now = new Date();
    const mockNode = {
      uid: 'volume~id1',
      name: 'file1',
      type: 'file',
      mediaType: 'text/plain',
      creationTime: now,
      modificationTime: now,
      activeRevision: { storageSize: 123 },
    };

    const captured: string[] = [];

    (manager as unknown as Record<string, unknown>).client = {
      iterateNodes: async function* (nodeUids: string[]) {
        captured.push(...nodeUids);
        yield { ok: true, value: mockNode };
        // Degraded node with UID present (should be included with a placeholder name)
        yield {
          ok: false,
          error: {
            uid: 'volume~id2',
            type: 'file',
            name: { ok: false, error: {} },
          },
        };
      },
      getMyFilesRootFolder: async () => ({ ok: true, value: { uid: 'volume~root' } }),
      getNode: async (_: string) => ({ ok: true, value: mockNode }),
      iterateFolderChildren: async function* () {},
    } as unknown as ProtonDriveClient;

    const result = await manager.listFolder('volume~parent');

    expect(captured).toEqual(['volume~id1', 'volume~id2']);
    expect(result.length).toBe(2);
    expect(result[1].uid).toBe('volume~id2');
    expect(result[1].name).toBe('Undecryptable');
  });

  test('should throw error when getClient called before initialization', () => {
    const manager = new DriveClientManager();

    try {
      manager.getClient();
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBeDefined();
    }
  });

  test('should throw error when listFolder called before initialization', async () => {
    const manager = new DriveClientManager();

    try {
      await manager.listFolder('root');
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBeDefined();
    }
  });

  test('should throw error when createFolder called before initialization', async () => {
    const manager = new DriveClientManager();

    try {
      await manager.createFolder('root', 'new-folder');
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBeDefined();
    }
  });

  test('should throw error when uploadFile called before initialization', async () => {
    const manager = new DriveClientManager();

    try {
      const stream = new ReadableStream({ start: (c) => c.close() });
      await manager.uploadFile('root', 'file.txt', stream);
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBeDefined();
    }
  });

  test('should throw error when downloadFile called before initialization', async () => {
    const manager = new DriveClientManager();

    try {
      await manager.downloadFile('file-uid');
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBeDefined();
    }
  });

  test('should throw error when deleteNode called before initialization', async () => {
    const manager = new DriveClientManager();

    try {
      await manager.deleteNode('node-uid');
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBeDefined();
    }
  });

  test('should throw error when renameNode called before initialization', async () => {
    const manager = new DriveClientManager();

    try {
      await manager.renameNode('node-uid', 'new-name');
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBeDefined();
    }
  });

  test('should throw error when moveNode called before initialization', async () => {
    const manager = new DriveClientManager();

    try {
      await manager.moveNode('node-uid', 'new-parent-uid');
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBeDefined();
    }
  });

  test('should throw error when resolvePath called before initialization', async () => {
    const manager = new DriveClientManager();

    try {
      await manager.resolvePath('/path');
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBeDefined();
    }
  });

  test('should throw error when findNodeByName called before initialization', async () => {
    const manager = new DriveClientManager();

    try {
      await manager.findNodeByName('filename', 'parent-uid');
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBeDefined();
    }
  });
});
