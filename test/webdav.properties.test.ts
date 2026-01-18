import { describe, test, expect, beforeEach } from 'bun:test';
import ProtonDriveResource from '../src/webdav/ProtonDriveResource.js';
import ProtonDriveAdapter from '../src/webdav/ProtonDriveAdapter.js';

// Simple integration test for properties persistence using MetadataManager
let adapter: ProtonDriveAdapter;
let baseUrl: URL;
let mockDriveClient: any;

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
  };
}

beforeEach(() => {
  mockDriveClient = createMockDriveClient();
  adapter = new ProtonDriveAdapter({ driveClient: mockDriveClient });
  baseUrl = new URL('http://localhost:8080/');
});

describe('ProtonDriveResource - Properties persistence', () => {
  test('set and get property persists across resource instances', async () => {
    const resource = new ProtonDriveResource({ adapter, baseUrl, path: '/Docs/file.txt' });

    const props = await resource.getProperties();
    await props.set('x-test', 'value-123');

    // New resource instance should read persisted value
    const resource2 = new ProtonDriveResource({ adapter, baseUrl, path: '/Docs/file.txt' });
    const props2 = await resource2.getProperties();
    const val = await props2.get('x-test');
    expect(val).toBe('value-123');
  });

  test('removing property persists', async () => {
    const resource = new ProtonDriveResource({ adapter, baseUrl, path: '/Docs/file.txt' });
    const props = await resource.getProperties();
    await props.set('to-delete', 'bye');

    await props.remove('to-delete');

    const resource2 = new ProtonDriveResource({ adapter, baseUrl, path: '/Docs/file.txt' });
    const props2 = await resource2.getProperties();
    const val = await props2.get('to-delete');
    expect(val).toBe('');
  });
});
