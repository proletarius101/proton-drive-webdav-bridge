import { describe, test, expect, beforeEach } from 'bun:test';
import ProtonDriveResource from '../src/webdav/ProtonDriveResource.js';
import ProtonDriveAdapter from '../src/webdav/ProtonDriveAdapter.js';
import type { DriveClientManager } from '../src/drive.js';
import MetadataManager from '../src/webdav/MetadataManager.js';

let adapter: ProtonDriveAdapter;
let baseUrl: URL;
let getNodeCalls = 0;

function createMockDriveClient() {
  return {
    getRootFolderUid: () => 'root-uid',
    listFolder: async (uid: string) => {
      if (uid === 'root-uid')
        return [
          {
            uid: 'folder-uid',
            name: 'Docs',
            type: 'folder',
            size: 0,
            mimeType: 'inode/directory',
            createdTime: new Date(),
            modifiedTime: new Date(),
            parentUid: 'root-uid',
          },
        ];
      if (uid === 'folder-uid')
        return [
          {
            uid: 'file-uid',
            name: 'file.txt',
            type: 'file',
            size: 10,
            mimeType: 'text/plain',
            createdTime: new Date(),
            modifiedTime: new Date(),
            parentUid: 'folder-uid',
          },
        ];
      return [];
    },
    downloadFile: async () => Buffer.from('test'),
    uploadFile: async () => undefined,
    createFolder: async () => 'new-folder-uid',
    deleteNode: async () => undefined,
    moveNode: async () => undefined,
    renameNode: async () => undefined,
    getNode: async (nodeUid: string) => {
      getNodeCalls++;
      if (nodeUid === 'file-uid') {
        // Return an SDK-like parsed node with claimedAdditionalMetadata
        return {
          uid: 'file-uid',
          name: 'file.txt',
          type: 'file',
          activeRevision: {
            ok: true,
            value: {
              claimedAdditionalMetadata: { 'x-sdk': 'v1' },
              creationTime: new Date(),
            },
          },
          creationTime: new Date(),
          modificationTime: new Date(),
        };
      }
      return null;
    },
  };
}

beforeEach(async () => {
  getNodeCalls = 0;
  const mockDriveClient = createMockDriveClient();
  adapter = new ProtonDriveAdapter({
    driveClient: mockDriveClient as unknown as DriveClientManager,
  });
  baseUrl = new URL('http://localhost:8080/');

  // Clear any persisted metadata from other tests
  MetadataManager.getInstance().delete('file-uid');
});

describe('ProtonDriveResource - SDK metadata hydration & caching', () => {
  test('hydrates metadata from SDK into MetadataManager and properties', async () => {
    const resource = new ProtonDriveResource({ adapter, baseUrl, path: '/Docs/file.txt' });

    const props = await resource.getProperties();
    const val = await props.get('x-sdk');

    expect(val).toBe('v1');

    // New resource instance should read persisted value from MetadataManager without calling SDK again
    const resource2 = new ProtonDriveResource({ adapter, baseUrl, path: '/Docs/file.txt' });
    const props2 = await resource2.getProperties();
    const val2 = await props2.get('x-sdk');
    expect(val2).toBe('v1');

    expect(getNodeCalls).toBe(1);
  });

  test('caches SDK metadata to avoid repeated getNode calls', async () => {
    const resource = new ProtonDriveResource({ adapter, baseUrl, path: '/Docs/file.txt' });

    const props = await resource.getProperties();
    const val1 = await props.get('x-sdk');
    const val2 = await props.get('x-sdk');

    expect(val1).toBe('v1');
    expect(val2).toBe('v1');
    expect(getNodeCalls).toBe(1);
  });
});
