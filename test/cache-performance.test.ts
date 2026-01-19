/**
 * Cache Performance Test
 *
 * Demonstrates the performance improvement from path caching.
 */

import { describe, expect, test, beforeEach } from 'bun:test';
import ProtonDriveAdapter from '../src/webdav/ProtonDriveAdapter.js';
import ProtonDriveResource from '../src/webdav/ProtonDriveResource.js';
import type { DriveClientManager, DriveNode } from '../src/drive.js';

describe('Path Cache Performance', () => {
  let mockClient: DriveClientManager;
  let adapter: ProtonDriveAdapter;
  let listFolderCallCount: number;

  beforeEach(() => {
    listFolderCallCount = 0;

    // Mock drive client that tracks API calls
    mockClient = {
      getRootFolderUid: () => 'root-uid',
      listFolder: async (uid: string): Promise<DriveNode[]> => {
        listFolderCallCount++;

        // Simulate network latency
        await new Promise((resolve) => setTimeout(resolve, 10));

        if (uid === 'root-uid') {
          return [
            {
              uid: 'docs-uid',
              name: 'Documents',
              type: 'folder',
              size: 0,
              mimeType: 'inode/directory',
              createdTime: new Date(),
              modifiedTime: new Date(),
              parentUid: 'root-uid',
            },
          ];
        }

        if (uid === 'docs-uid') {
          return [
            {
              uid: 'career-uid',
              name: 'Career',
              type: 'folder',
              size: 0,
              mimeType: 'inode/directory',
              createdTime: new Date(),
              modifiedTime: new Date(),
              parentUid: 'docs-uid',
            },
          ];
        }

        if (uid === 'career-uid') {
          return [
            {
              uid: 'file-uid',
              name: 'resume.pdf',
              type: 'file',
              size: 1024,
              mimeType: 'application/pdf',
              createdTime: new Date(),
              modifiedTime: new Date(),
              parentUid: 'career-uid',
            },
          ];
        }

        return [];
      },
    } as DriveClientManager;

    adapter = new ProtonDriveAdapter({ driveClient: mockClient, cacheTTL: 60000 });
  });

  test('first access traverses full path', async () => {
    const resource = new ProtonDriveResource({
      adapter,
      baseUrl: new URL('http://localhost'),
      path: '/Documents/Career/resume.pdf',
    });

    const startTime = performance.now();
    await resource.exists();
    const duration = performance.now() - startTime;

    // First access should call listFolder 3 times (root, Documents, Career)
    expect(listFolderCallCount).toBe(3);
    console.log(`First access took ${duration.toFixed(2)}ms with ${listFolderCallCount} API calls`);
  });

  test('second access uses path cache (zero API calls)', async () => {
    // First access
    const resource1 = new ProtonDriveResource({
      adapter,
      baseUrl: new URL('http://localhost'),
      path: '/Documents/Career/resume.pdf',
    });
    await resource1.exists();

    const firstCallCount = listFolderCallCount;
    expect(firstCallCount).toBe(3);

    // Second access (should hit path cache)
    const resource2 = new ProtonDriveResource({
      adapter,
      baseUrl: new URL('http://localhost'),
      path: '/Documents/Career/resume.pdf',
    });

    const startTime = performance.now();
    await resource2.exists();
    const duration = performance.now() - startTime;

    // Should not make any new API calls
    expect(listFolderCallCount).toBe(firstCallCount);
    console.log(`Second access took ${duration.toFixed(2)}ms with 0 API calls (path cache hit)`);
  });

  test('sibling file benefits from folder cache', async () => {
    // Access first file
    const resource1 = new ProtonDriveResource({
      adapter,
      baseUrl: new URL('http://localhost'),
      path: '/Documents/Career/resume.pdf',
    });
    await resource1.exists();
    expect(listFolderCallCount).toBe(3);

    // Add another file to the Career folder in our mock
    const originalListFolder = mockClient.listFolder;
    mockClient.listFolder = async (uid: string) => {
      const nodes = await originalListFolder.call(mockClient, uid);
      if (uid === 'career-uid') {
        return [
          ...nodes,
          {
            uid: 'file2-uid',
            name: 'cover-letter.pdf',
            type: 'file',
            size: 512,
            mimeType: 'application/pdf',
            createdTime: new Date(),
            modifiedTime: new Date(),
            parentUid: 'career-uid',
          },
        ];
      }
      return nodes;
    };

    // Access sibling file (should use cached folder listings for root and Documents)
    const resource2 = new ProtonDriveResource({
      adapter,
      baseUrl: new URL('http://localhost'),
      path: '/Documents/Career/cover-letter.pdf',
    });

    const startTime = performance.now();
    await resource2.exists();
    const duration = performance.now() - startTime;

    // Should only need 1 new API call (re-list Career folder for the new file)
    // But since we've cached the Career listing, it will be 0 additional calls
    const additionalCalls = listFolderCallCount - 3;
    console.log(
      `Sibling file access took ${duration.toFixed(2)}ms with ${additionalCalls} additional API calls`
    );

    // Should use folder cache for all lookups
    expect(additionalCalls).toBe(0);
  });

  test('cache invalidation clears both caches', async () => {
    // First access
    const resource1 = new ProtonDriveResource({
      adapter,
      baseUrl: new URL('http://localhost'),
      path: '/Documents/Career/resume.pdf',
    });
    await resource1.exists();
    expect(listFolderCallCount).toBe(3);

    // Invalidate cache
    adapter.invalidateFolderCache('career-uid');

    // Second access (should need to re-fetch)
    const resource2 = new ProtonDriveResource({
      adapter,
      baseUrl: new URL('http://localhost'),
      path: '/Documents/Career/resume.pdf',
    });
    await resource2.exists();

    // Should make API calls again (path cache was cleared)
    expect(listFolderCallCount).toBeGreaterThan(3);
  });
});
