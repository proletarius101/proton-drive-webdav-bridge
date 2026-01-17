/**
 * Unit Tests - ProtonDriveResource WebDAV Operations
 *
 * Tests new methods and improved operations with mocked drive SDK:
 * - Path canonicalization (getCanonicalName, getCanonicalPath, getCanonicalUrl)
 * - Resource tree validation (resourceTreeExists)
 * - Collection detection (isEmpty)
 * - COPY operation
 * - MOVE operation
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, test, expect, beforeEach } from 'bun:test';
import ProtonDriveResource from '../src/webdav/ProtonDriveResource.js';
import ProtonDriveAdapter from '../src/webdav/ProtonDriveAdapter.js';

// Mock interfaces
interface MockNode {
  uid: string;
  name: string;
  type: 'file' | 'folder';
  size: number;
  mimeType: string;
  createdTime: Date;
  modifiedTime: Date;
  parentUid: string;
}

interface MockDriveClient {
  getRootFolderUid: () => string;
  listFolder: (uid: string) => Promise<MockNode[]>;
  downloadFile: (uid: string) => Promise<Buffer>;
  uploadFile: (
    parentUid: string,
    name: string,
    data: Buffer | Uint8Array | unknown,
    options?: any
  ) => Promise<void>;
  createFolder: (name: string, parentUid: string) => Promise<string>;
  deleteNode: (uid: string) => Promise<void>;
  moveNode: (uid: string, newParentUid: string) => Promise<void>;
  renameNode: (uid: string, newName: string) => Promise<void>;
}

// Create mock drive client
let mockDriveClient: MockDriveClient;

function createMockDriveClient(): MockDriveClient {
  return {
    getRootFolderUid: () => 'root-uid',
    listFolder: async () => [],
    downloadFile: async () => Buffer.from('test content'),
    uploadFile: async () => undefined,
    createFolder: async () => 'new-folder-uid',
    deleteNode: async () => undefined,
    moveNode: async () => undefined,
    renameNode: async () => undefined,
  };
}

/**
 * Attach mock drive client to adapter using several common property names
 * to cover different internal implementations.
 */
function attachMockDriveClient(adapter: ProtonDriveAdapter, client: MockDriveClient): void {
  // Explicitly inject the mocked drive client into the adapter (DI pattern)
  (adapter as any).driveClient = client;
}

describe('ProtonDriveResource - Path Canonicalization', () => {
  let adapter: ProtonDriveAdapter;
  let baseUrl: URL;

  beforeEach(() => {
    mockDriveClient = createMockDriveClient();
    adapter = new ProtonDriveAdapter();
    attachMockDriveClient(adapter, mockDriveClient);
    baseUrl = new URL('http://localhost:8080/');
  });

  test('getCanonicalName returns "/" for root path', async () => {
    const resource = new ProtonDriveResource({
      adapter,
      baseUrl,
      path: '/',
    });

    const name = await resource.getCanonicalName();
    expect(name).toBe('/');
  });

  test('getCanonicalName returns filename for file resource', async () => {
    const mockNode: MockNode = {
      uid: 'file-uid',
      name: 'document.txt',
      type: 'file',
      size: 1024,
      mimeType: 'text/plain',
      createdTime: new Date(),
      modifiedTime: new Date(),
      parentUid: 'parent-uid',
    };

    mockDriveClient.listFolder = async () => [mockNode];

    const resource = new ProtonDriveResource({
      adapter,
      baseUrl,
      path: '/document.txt',
    });

    const name = await resource.getCanonicalName();
    expect(name).toBe('document.txt');
  });

  test('getCanonicalPath returns "/" for root', async () => {
    const resource = new ProtonDriveResource({
      adapter,
      baseUrl,
      path: '/',
    });

    const path = await resource.getCanonicalPath();
    expect(path).toBe('/');
  });

  test('getCanonicalPath adds trailing slash for collections', async () => {
    const resource = new ProtonDriveResource({
      adapter,
      baseUrl,
      path: '/Documents',
      collection: true,
    });

    const path = await resource.getCanonicalPath();
    expect(path.endsWith('/')).toBe(true);
  });

  test('getCanonicalPath removes trailing slash for files', async () => {
    const resource = new ProtonDriveResource({
      adapter,
      baseUrl,
      path: '/file.txt/',
      collection: false,
    });

    const path = await resource.getCanonicalPath();
    expect(path.endsWith('/')).toBe(false);
  });

  test('getCanonicalUrl returns properly encoded URL', async () => {
    const resource = new ProtonDriveResource({
      adapter,
      baseUrl,
      path: '/file with spaces.txt',
      collection: false,
    });

    const url = await resource.getCanonicalUrl();
    expect(url.pathname).toContain('file%20with%20spaces.txt');
  });

  test('getCanonicalUrl encodes non-ASCII characters', async () => {
    const resource = new ProtonDriveResource({
      adapter,
      baseUrl,
      path: '/文件.txt',
      collection: false,
    });

    const url = await resource.getCanonicalUrl();
    // URL-encoded characters should be present
    expect(url.pathname.includes('%')).toBe(true);
  });
});

describe('ProtonDriveResource - isEmpty()', () => {
  let adapter: ProtonDriveAdapter;
  let baseUrl: URL;

  beforeEach(() => {
    mockDriveClient = createMockDriveClient();
    adapter = new ProtonDriveAdapter();
    attachMockDriveClient(adapter, mockDriveClient);
    baseUrl = new URL('http://localhost:8080/');
  });

  test('isEmpty returns true for empty collection', async () => {
    mockDriveClient.listFolder = async () => [];

    const resource = new ProtonDriveResource({
      adapter,
      baseUrl,
      path: '/EmptyFolder',
      collection: true,
    });

    const isEmpty = await resource.isEmpty();
    expect(isEmpty).toBe(true);
  });

  test('isEmpty returns false for non-empty collection', async () => {
    const mockChild: MockNode = {
      uid: 'child-uid',
      name: 'file.txt',
      type: 'file',
      size: 1024,
      mimeType: 'text/plain',
      createdTime: new Date(),
      modifiedTime: new Date(),
      parentUid: 'folder-uid',
    };

    // Simulate root containing the Documents folder and Documents containing one child
    mockDriveClient.listFolder = async (uid: string) => {
      if (uid === 'root-uid')
        return [
          {
            uid: 'folder-uid',
            name: 'Documents',
            type: 'folder',
            size: 0,
            mimeType: 'inode/directory',
            createdTime: new Date(),
            modifiedTime: new Date(),
            parentUid: 'root-uid',
          },
        ];
      if (uid === 'folder-uid') return [mockChild];
      return [];
    };

    const resource = new ProtonDriveResource({
      adapter,
      baseUrl,
      path: '/Documents',
      collection: true,
    });

    const isEmpty = await resource.isEmpty();
    expect(isEmpty).toBe(false);
  });

  test('isEmpty returns false for non-collection resources', async () => {
    const resource = new ProtonDriveResource({
      adapter,
      baseUrl,
      path: '/file.txt',
      collection: false,
    });

    const isEmpty = await resource.isEmpty();
    expect(isEmpty).toBe(false);
  });
});

describe('ProtonDriveResource - resourceTreeExists()', () => {
  let adapter: ProtonDriveAdapter;
  let baseUrl: URL;

  beforeEach(() => {
    mockDriveClient = createMockDriveClient();
    adapter = new ProtonDriveAdapter();
    attachMockDriveClient(adapter, mockDriveClient);
    baseUrl = new URL('http://localhost:8080/');
  });

  test('resourceTreeExists returns true for root path', async () => {
    const resource = new ProtonDriveResource({
      adapter,
      baseUrl,
      path: '/',
    });

    const exists = await resource.resourceTreeExists('/');
    expect(exists).toBe(true);
  });

  test('resourceTreeExists returns true when all parents exist', async () => {
    const mockFolder: MockNode = {
      uid: 'folder-uid',
      name: 'Documents',
      type: 'folder',
      size: 0,
      mimeType: 'inode/directory',
      createdTime: new Date(),
      modifiedTime: new Date(),
      parentUid: 'root-uid',
    };

    mockDriveClient.listFolder = async () => [mockFolder];

    const resource = new ProtonDriveResource({
      adapter,
      baseUrl,
      path: '/Documents',
    });

    const exists = await resource.resourceTreeExists('/Documents/newfile.txt');
    expect(exists).toBe(true);
  });

  test('resourceTreeExists returns false when parent directory missing', async () => {
    mockDriveClient.listFolder = async () => [];

    const resource = new ProtonDriveResource({
      adapter,
      baseUrl,
      path: '/file.txt',
    });

    const exists = await resource.resourceTreeExists('/nonexistent/parent/file.txt');
    expect(exists).toBe(false);
  });

  test('resourceTreeExists validates all parent directories in chain', async () => {
    const mockFolderA: MockNode = {
      uid: 'a-uid',
      name: 'a',
      type: 'folder',
      size: 0,
      mimeType: 'inode/directory',
      createdTime: new Date(),
      modifiedTime: new Date(),
      parentUid: 'root-uid',
    };

    const mockFolderB: MockNode = {
      uid: 'b-uid',
      name: 'b',
      type: 'folder',
      size: 0,
      mimeType: 'inode/directory',
      createdTime: new Date(),
      modifiedTime: new Date(),
      parentUid: 'a-uid',
    };

    let callCount = 0;
    mockDriveClient.listFolder = async () => {
      callCount++;
      if (callCount === 1) return [mockFolderA];
      if (callCount === 2) return [mockFolderB];
      return [];
    };

    const resource = new ProtonDriveResource({
      adapter,
      baseUrl,
      path: '/a/b',
    });

    const exists = await resource.resourceTreeExists('/a/b/c/file.txt');
    expect(exists).toBe(true);
    expect(callCount).toBe(2);
  });
});

describe('ProtonDriveResource - COPY Operation', () => {
  let adapter: ProtonDriveAdapter;
  let baseUrl: URL;

  beforeEach(() => {
    mockDriveClient = createMockDriveClient();
    adapter = new ProtonDriveAdapter();
    attachMockDriveClient(adapter, mockDriveClient);
    baseUrl = new URL('http://localhost:8080/');
  });

  test('copy method exists and is callable', () => {
    const resource = new ProtonDriveResource({
      adapter,
      baseUrl,
      path: '/file.txt',
      collection: false,
    });

    expect(typeof resource.copy).toBe('function');
  });

  test('copy throws error when copying to self', async () => {
    const mockNode: MockNode = {
      uid: 'file-uid',
      name: 'file.txt',
      type: 'file',
      size: 1024,
      mimeType: 'text/plain',
      createdTime: new Date(),
      modifiedTime: new Date(),
      parentUid: 'root-uid',
    };

    const resource = new ProtonDriveResource({
      adapter,
      baseUrl,
      path: '/file.txt',
      collection: false,
    });

    // Manually set internal node reference
    (resource as any)._node = mockNode;

    const sameUrl = new URL('/file.txt', baseUrl);

    try {
      await resource.copy(sameUrl, baseUrl, { username: 'testuser' } as any);
      throw new Error('Should have thrown error');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('destination cannot be the same');
    }
  });

  test('copy prevents copying into self (nested path)', async () => {
    const mockNode: MockNode = {
      uid: 'folder-uid',
      name: 'Documents',
      type: 'folder',
      size: 0,
      mimeType: 'inode/directory',
      createdTime: new Date(),
      modifiedTime: new Date(),
      parentUid: 'root-uid',
    };

    const resource = new ProtonDriveResource({
      adapter,
      baseUrl,
      path: '/Documents',
      collection: true,
    });

    (resource as any)._node = mockNode;

    const childUrl = new URL('/Documents/subfolder', baseUrl);

    try {
      await resource.copy(childUrl, baseUrl, { username: 'testuser' } as any);
      throw new Error('Should have thrown error');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('destination cannot be the same');
    }
  });

  test('copy a file to a new destination uploads content to destination parent', async () => {
    const mockNode: MockNode = {
      uid: 'file-uid',
      name: 'file.txt',
      type: 'file',
      size: 10,
      mimeType: 'text/plain',
      createdTime: new Date(),
      modifiedTime: new Date(),
      parentUid: 'root-uid',
    };

    let uploaded = false;
    mockDriveClient.downloadFile = async () => new TextEncoder().encode('copied data');
    mockDriveClient.uploadFile = async (parentUid: string, name: string, data: any) => {
      uploaded = true;
      expect(name).toBe('file.txt');
      const content = data instanceof Uint8Array ? new TextDecoder().decode(data) : data.toString();
      expect(content).toBe('copied data');
      expect(parentUid).toBe('new-parent-uid');
    };

    // Simulate destination parent exists
    mockDriveClient.listFolder = async (uid: string) => {
      if (uid === 'root-uid')
        return [
          {
            uid: 'new-parent-uid',
            name: 'dest',
            type: 'folder',
            size: 0,
            mimeType: 'inode/directory',
            createdTime: new Date(),
            modifiedTime: new Date(),
            parentUid: 'root-uid',
          },
        ];
      return [];
    };

    const resource = new ProtonDriveResource({
      adapter,
      baseUrl,
      path: '/file.txt',
      collection: false,
    });

    (resource as any)._node = mockNode;

    const destUrl = new URL('/dest/file.txt', baseUrl);
    await resource.copy(destUrl, baseUrl, { username: 'testuser' } as any);

    expect(uploaded).toBe(true);
  });

  test('copy a file when downloadFile returns a ReadableStream', async () => {
    const mockNode: MockNode = {
      uid: 'file-uid',
      name: 'file.txt',
      type: 'file',
      size: 10,
      mimeType: 'text/plain',
      createdTime: new Date(),
      modifiedTime: new Date(),
      parentUid: 'root-uid',
    };

    let uploaded = false;
    mockDriveClient.downloadFile = async () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('streamed data'));
          controller.close();
        },
      });

    mockDriveClient.uploadFile = async (parentUid: string, name: string, data: any) => {
      uploaded = true;
      expect(name).toBe('file.txt');

      if (data instanceof ReadableStream) {
        const reader = data.getReader();
        let collected = '';
        for (;;) {
          // eslint-disable-next-line no-await-in-loop
          const { done, value } = await reader.read();
          if (done) break;
          collected += new TextDecoder().decode(value);
        }
        expect(collected).toBe('streamed data');
      } else {
        const content = data instanceof Uint8Array ? new TextDecoder().decode(data) : data.toString();
        expect(content).toBe('streamed data');
      }

      expect(parentUid).toBe('new-parent-uid');
    };

    // Simulate destination parent exists
    mockDriveClient.listFolder = async (uid: string) => {
      if (uid === 'root-uid')
        return [
          {
            uid: 'new-parent-uid',
            name: 'dest',
            type: 'folder',
            size: 0,
            mimeType: 'inode/directory',
            createdTime: new Date(),
            modifiedTime: new Date(),
            parentUid: 'root-uid',
          },
        ];
      return [];
    };

    const resource = new ProtonDriveResource({
      adapter,
      baseUrl,
      path: '/file.txt',
      collection: false,
    });

    (resource as any)._node = mockNode;

    const destUrl = new URL('/dest/file.txt', baseUrl);
    await resource.copy(destUrl, baseUrl, { username: 'testuser' } as any);

    expect(uploaded).toBe(true);
  });
});

describe('ProtonDriveResource - MOVE Operation', () => {
  let adapter: ProtonDriveAdapter;
  let baseUrl: URL;

  beforeEach(() => {
    mockDriveClient = createMockDriveClient();
    adapter = new ProtonDriveAdapter();
    attachMockDriveClient(adapter, mockDriveClient);
    baseUrl = new URL('http://localhost:8080/');
  });

  test('move method exists and is callable', () => {
    const resource = new ProtonDriveResource({
      adapter,
      baseUrl,
      path: '/file.txt',
      collection: false,
    });

    expect(typeof resource.move).toBe('function');
  });

  test('move throws error when moving to self', async () => {
    const mockNode: MockNode = {
      uid: 'file-uid',
      name: 'file.txt',
      type: 'file',
      size: 1024,
      mimeType: 'text/plain',
      createdTime: new Date(),
      modifiedTime: new Date(),
      parentUid: 'root-uid',
    };

    const resource = new ProtonDriveResource({
      adapter,
      baseUrl,
      path: '/file.txt',
      collection: false,
    });

    (resource as any)._node = mockNode;

    const sameUrl = new URL('/file.txt', baseUrl);

    try {
      await resource.move(sameUrl, baseUrl, { username: 'testuser' } as any);
      throw new Error('Should have thrown error');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('destination cannot be the same');
    }
  });

  test('move prevents moving collection resources', async () => {
    const mockNode: MockNode = {
      uid: 'folder-uid',
      name: 'Documents',
      type: 'folder',
      size: 0,
      mimeType: 'inode/directory',
      createdTime: new Date(),
      modifiedTime: new Date(),
      parentUid: 'root-uid',
    };

    const resource = new ProtonDriveResource({
      adapter,
      baseUrl,
      path: '/Documents',
      collection: true,
    });

    (resource as any)._node = mockNode;

    const destUrl = new URL('/NewDocuments', baseUrl);

    try {
      await resource.move(destUrl, baseUrl, { username: 'testuser' } as any);
      throw new Error('Should have thrown error');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('Move called on a collection resource');
    }
  });

  test('move throws error when destination parent missing', async () => {
    const mockNode: MockNode = {
      uid: 'file-uid',
      name: 'file.txt',
      type: 'file',
      size: 1024,
      mimeType: 'text/plain',
      createdTime: new Date(),
      modifiedTime: new Date(),
      parentUid: 'root-uid',
    };

    mockDriveClient.listFolder = async () => [];

    const resource = new ProtonDriveResource({
      adapter,
      baseUrl,
      path: '/file.txt',
      collection: false,
    });

    (resource as any)._node = mockNode;

    const destUrl = new URL('/nonexistent/parent/file.txt', baseUrl);

    try {
      await resource.move(destUrl, baseUrl, { username: 'testuser' } as any);
      throw new Error('Should have thrown error');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      expect(
        message.includes('parent') || message.includes('tree') || message.includes('complete')
      ).toBe(true);
    }
  });

  test('move successfully moves node when destination parent exists', async () => {
    const mockNode: MockNode = {
      uid: 'file-uid',
      name: 'file.txt',
      type: 'file',
      size: 512,
      mimeType: 'text/plain',
      createdTime: new Date(),
      modifiedTime: new Date(),
      parentUid: 'root-uid',
    };

    let moved = false;
    mockDriveClient.moveNode = async (uid: string, newParentUid: string) => {
      moved = true;
      expect(uid).toBe('file-uid');
      expect(newParentUid).toBe('dest-parent-uid');
    };

    // Destination parent exists
    mockDriveClient.listFolder = async (uid: string) => {
      if (uid === 'root-uid')
        return [
          {
            uid: 'dest-parent-uid',
            name: 'dest',
            type: 'folder',
            size: 0,
            mimeType: 'inode/directory',
            createdTime: new Date(),
            modifiedTime: new Date(),
            parentUid: 'root-uid',
          },
        ];
      return [];
    };

    const resource = new ProtonDriveResource({
      adapter,
      baseUrl,
      path: '/file.txt',
      collection: false,
    });

    (resource as any)._node = mockNode;

    const destUrl = new URL('/dest/file.txt', baseUrl);
    await resource.move(destUrl, baseUrl, { username: 'testuser' } as any);

    expect(moved).toBe(true);
  });
});

describe('ProtonDriveResource - Edge Cases', () => {
  let adapter: ProtonDriveAdapter;
  let baseUrl: URL;

  beforeEach(() => {
    mockDriveClient = createMockDriveClient();
    adapter = new ProtonDriveAdapter();
    attachMockDriveClient(adapter, mockDriveClient);
    baseUrl = new URL('http://localhost:8080/');
  });

  test('handles empty path correctly', async () => {
    const resource = new ProtonDriveResource({
      adapter,
      baseUrl,
      path: '',
    });

    const name = await resource.getCanonicalName();
    expect(name).toBe('/');
  });

  test('resourceTreeExists returns true for empty path', async () => {
    const resource = new ProtonDriveResource({
      adapter,
      baseUrl,
      path: '',
    });

    const exists = await resource.resourceTreeExists('');
    expect(exists).toBe(true);
  });

  test('handles paths with multiple slashes', async () => {
    const resource = new ProtonDriveResource({
      adapter,
      baseUrl,
      path: '/Documents//subfolder//file.txt',
      collection: false,
    });

    const path = await resource.getCanonicalPath();
    expect(typeof path).toBe('string');
  });

  test('getCanonicalUrl returns a valid URL object', async () => {
    const resource = new ProtonDriveResource({
      adapter,
      baseUrl,
      path: '/test/file.txt',
      collection: false,
    });

    const url = await resource.getCanonicalUrl();
    expect(url instanceof URL).toBe(true);
    expect(url.pathname).toBeDefined();
  });
});
