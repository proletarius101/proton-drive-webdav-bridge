import { describe, test, expect, beforeEach } from 'bun:test';
import { getDataDir } from '../src/paths.js';
import { writeFileSync, mkdirSync } from 'fs';
import ProtonDriveLock from '../src/webdav/ProtonDriveLock.js';

beforeEach(() => {
  const dataDir = getDataDir();
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(`${dataDir}/locks.db`, '', { flag: 'a' });
});

// Create a lock with a token that doesn't exist in LockManager to force failures
describe('ProtonDriveLock - error paths', () => {
  test('save persists a missing lock by creating it when necessary', async () => {
    const fakeResource = { path: '/x' } as unknown as any;
    const lock = new ProtonDriveLock({
      resource: fakeResource,
      token: 'nonexistent-token',
      date: new Date(),
      timeout: 10,
      scope: 'exclusive',
      depth: '0',
      provisional: false,
      owner: 'me',
    });

    await expect(lock.save()).resolves.toBeUndefined();
  });

  test('delete throws when lock does not exist', async () => {
    const fakeResource = { path: '/x' } as unknown as any;
    const lock = new ProtonDriveLock({
      resource: fakeResource,
      token: 'nonexistent-token',
      date: new Date(),
      timeout: 10,
      scope: 'exclusive',
      depth: '0',
      provisional: false,
      owner: 'me',
    });

    await expect(lock.delete()).rejects.toThrow('Failed to delete lock');
  });
});
