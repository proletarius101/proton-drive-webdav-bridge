import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdirSync, writeFileSync } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

// Per-test dynamic setup: create unique temp dirs and register env-paths mock
let baseDirs: string[] = [];
let LockManager: any;

beforeEach(async () => {
  // Create per-test temp dirs
  const config = await mkdtemp(join(tmpdir(), 'pdb-lock-config-'));
  const data = await mkdtemp(join(tmpdir(), 'pdb-lock-data-'));
  const log = await mkdtemp(join(tmpdir(), 'pdb-lock-log-'));
  const temp = await mkdtemp(join(tmpdir(), 'pdb-lock-temp-'));
  const cache = await mkdtemp(join(tmpdir(), 'pdb-lock-cache-'));
  baseDirs.push(config, data, log, temp, cache);

  // Register per-test env-paths mock
  mock.module('env-paths', () => ({
    default: () => ({ config, data, log, temp, cache }),
  }));

  // Import paths and lock manager after mock is registered
  const cacheBuster = `${Date.now()}-${Math.random()}`;
  const pathsMod = await import(`../src/paths.js?cache=${cacheBuster}`);
  const getDataDir = pathsMod.getDataDir;

  // Ensure data dir exists for SQLite and pre-create database file
  const dataDir = getDataDir();
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, 'locks.db');
  writeFileSync(dbPath, '', { flag: 'a' });

  const lmMod = await import(`../src/webdav/LockManager.js?cache=${cacheBuster}`);
  LockManager = lmMod.LockManager;
});

afterEach(async () => {
  // Remove temporary directories
  for (const d of baseDirs) {
    try {
      await rm(d, { recursive: true, force: true });
    } catch {
      /* ignore errors during cleanup */
    }
  }
  baseDirs = [];
  // Ensure LockManager singleton is reset
  try {
    const inst = LockManager.getInstance();
    inst.close();
  } catch {
    /* ignore close errors */
  }
  // Restore mocks
  mock.restore();
  mock.clearAllMocks();
});

describe('LockManager - basic operations', () => {
  test('createLock and getLock work and token format', () => {
    const lm = LockManager.getInstance();

    const user = { username: 'testuser' } as unknown as User;
    const lock = lm.createLock('/resource', user, 10, 'exclusive', '0', false, 'owner');

    expect(lock.token).toMatch(/^opaquelocktoken:/);
    expect(lock.path).toBe('/resource');

    const retrieved = lm.getLock(lock.token);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.username).toBe('testuser');

    // cleanup
    lm.deleteLock(lock.token);
  });

  test('cannot create conflicting lock on same path', () => {
    const lm = LockManager.getInstance();

    const user = { username: 'u1' } as unknown as User;
    const lock1 = lm.createLock('/a', user, 10, 'exclusive', '0', false, 'owner');

    try {
      expect(() =>
        lm.createLock(
          '/a',
          { username: 'u2' } as unknown as User,
          10,
          'exclusive',
          '0',
          false,
          'owner2'
        )
      ).toThrow();
    } finally {
      lm.deleteLock(lock1.token);
    }
  });

  test('depth=infinity conflicts with child paths', () => {
    const lm = LockManager.getInstance();

    const parentLock = lm.createLock(
      '/parent',
      { username: 'u' } as unknown as User,
      10,
      'exclusive',
      'infinity',
      false,
      'o'
    );

    try {
      expect(() =>
        lm.createLock(
          '/parent/child',
          { username: 'u2' } as unknown as User,
          10,
          'exclusive',
          '0',
          false,
          'o2'
        )
      ).toThrow();
    } finally {
      lm.deleteLock(parentLock.token);
    }
  });

  test('refreshLock updates expiry and returns true/false appropriately', () => {
    const lm = LockManager.getInstance();

    const lock = lm.createLock(
      '/refresh',
      { username: 'u' } as unknown as User,
      1,
      'exclusive',
      '0',
      false,
      'o'
    );
    const ok = lm.refreshLock(lock.token, 10);
    expect(ok).toBe(true);

    // Non-existent token
    const ok2 = lm.refreshLock('nonexistent', 10);
    expect(ok2).toBe(false);

    lm.deleteLock(lock.token);
  });

  test('isLocked and validateLockToken behavior', () => {
    const lm = LockManager.getInstance();

    const lock = lm.createLock(
      '/locked',
      { username: 'u' } as unknown as User,
      10,
      'exclusive',
      'infinity',
      false,
      'o'
    );

    expect(lm.isLocked('/locked')).toBe(true);
    expect(lm.validateLockToken('/locked', lock.token)).toBe(true);
    expect(lm.validateLockToken('/locked/child', lock.token)).toBe(true); // depth infinity

    expect(lm.validateLockToken('/locked', 'bad-token')).toBe(false);

    lm.deleteLock(lock.token);
  });

  test('cleanupExpiredLocks removes expired locks', async () => {
    const lm = LockManager.getInstance();

    const lock = lm.createLock(
      '/short',
      { username: 'u' } as unknown as User,
      1,
      'exclusive',
      '0',
      false,
      'o'
    );

    // Poll until the lock is removed or timeout (3s)
    const deadline = Date.now() + 3000;
    let found = true;

    while (Date.now() < deadline) {
      const all = lm.getAllLocks();
      found = all.some((l) => l.token === lock.token);
      if (!found) break;
      // small delay
      await new Promise((res) => setTimeout(res, 100));
    }

    expect(found).toBe(false);
  });
});
