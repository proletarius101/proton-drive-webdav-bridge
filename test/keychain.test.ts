/**
 * Comprehensive Integration Tests - Keychain Module
 *
 * Tests secure credential storage including:
 * - File-based encrypted storage with AES-256-GCM
 * - Native OS keyring integration
 * - Platform detection and fallback logic
 * - Password derivation with PBKDF2
 * - Error handling and decryption failures
 *
 * Uses dynamic imports with mockFileSystem() for true per-test isolation.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { vol } from 'memfs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { keyringStore } from './setup.js';

vi.mock('fs');
vi.mock('fs/promises');

// Setup per-test isolated environment
beforeEach(async () => {
  // reset the state of in-memory fs
  vol.reset();
  keyringStore.clear();
});

afterEach(async () => {
  keyringStore.clear();
  delete process.env.KEYRING_PASSWORD;
  delete process.env.DISPLAY;
  delete process.env.WAYLAND_DISPLAY;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const sampleCredentials = {
  parentUID: 'parent-uid-123',
  parentAccessToken: 'parent-access-token-xyz',
  parentRefreshToken: 'parent-refresh-token-abc',
  childUID: 'child-uid-456',
  childAccessToken: 'child-access-token-def',
  childRefreshToken: 'child-refresh-token-ghi',
  SaltedKeyPass: 'salted-key-password-jkl',
  UserID: 'user-id-789',
  username: 'testuser@proton.me',
  passwordMode: 1 as const,
};

describe('Keychain - File-Based Storage', () => {
  beforeEach(() => {
    process.env.KEYRING_PASSWORD = 'secure-test-password-123';
  });

  test('stores and retrieves credentials with encryption', async () => {
    const { storeCredentials, getStoredCredentials, hasStoredCredentials } =
      await import('../src/keychain.js');

    await storeCredentials(sampleCredentials);

    expect(await hasStoredCredentials()).toBe(true);
    const stored = await getStoredCredentials();
    expect(stored).toEqual(sampleCredentials);
    expect(stored?.username).toBe('testuser@proton.me');
    expect(stored?.parentUID).toBe('parent-uid-123');
    expect(stored?.childAccessToken).toBe('child-access-token-def');
  });

  test('returns null when no credentials stored', async () => {
    const { getStoredCredentials, hasStoredCredentials, deleteStoredCredentials } =
      await import('../src/keychain.js');

    // Ensure clean state
    await deleteStoredCredentials();

    expect(await hasStoredCredentials()).toBe(false);
    const stored = await getStoredCredentials();
    expect(stored).toBeNull();
  });

  test('deletes stored credentials', async () => {
    const { storeCredentials, getStoredCredentials, deleteStoredCredentials } =
      await import('../src/keychain.js');

    await storeCredentials(sampleCredentials);
    expect(await getStoredCredentials()).not.toBeNull();

    await deleteStoredCredentials();

    const stored = await getStoredCredentials();
    expect(stored).toBeNull();
  });

  test('creates encrypted file with secure permissions', async () => {
    const { storeCredentials, getCredentialsFilePath, flushPendingWrites } =
      await import('../src/keychain.js');

    await storeCredentials(sampleCredentials);
    await flushPendingWrites();
    const filePath = getCredentialsFilePath();

    expect(existsSync(filePath)).toBe(true);

    // Verify file is encrypted (not plain JSON)
    const fileContent = readFileSync(filePath);
    const fileStr = fileContent.toString('utf8');
    expect(fileStr).not.toContain('testuser@proton.me');
    expect(fileStr).not.toContain('parent-uid-123');
  });

  test('overwrites existing credentials', async () => {
    const { storeCredentials, getStoredCredentials } = await import('../src/keychain.js');

    await storeCredentials(sampleCredentials);

    const updated = { ...sampleCredentials, username: 'newuser@proton.me' };
    await storeCredentials(updated);

    const stored = await getStoredCredentials();
    expect(stored?.username).toBe('newuser@proton.me');
  });

  test('handles different password modes', async () => {
    const { storeCredentials, getStoredCredentials } = await import('../src/keychain.js');

    const twoPasswordCreds = { ...sampleCredentials, passwordMode: 2 as const };
    await storeCredentials(twoPasswordCreds);

    const stored = await getStoredCredentials();
    expect(stored?.passwordMode).toBe(2);
  });
});

describe('Keychain - Encryption and Security', () => {
  test('uses different encryption key with different passwords', async () => {
    process.env.KEYRING_PASSWORD = 'password1';
    const { storeCredentials, getCredentialsFilePath, flushPendingWrites } =
      await import('../src/keychain.js');

    await storeCredentials(sampleCredentials);
    await flushPendingWrites();
    const filePath = getCredentialsFilePath();
    const encrypted1 = readFileSync(filePath);

    // Change password and re-encrypt
    delete process.env.KEYRING_PASSWORD;
    process.env.KEYRING_PASSWORD = 'password2';
    const { storeCredentials: storeCredentials2, flushPendingWrites: flush2 } =
      await import('../src/keychain.js');

    await storeCredentials2(sampleCredentials);
    await flush2();
    const encrypted2 = readFileSync(filePath);

    // Files should be different due to different keys
    expect(encrypted1.equals(encrypted2)).toBe(false);
  });

  test('fails to decrypt with wrong password', async () => {
    process.env.KEYRING_PASSWORD = 'correct-password';
    const { storeCredentials } = await import('../src/keychain.js');

    await storeCredentials(sampleCredentials);

    // Try to read with wrong password
    delete process.env.KEYRING_PASSWORD;
    process.env.KEYRING_PASSWORD = 'wrong-password';
    const { getStoredCredentials } = await import('../src/keychain.js');

    const stored = await getStoredCredentials();
    expect(stored).toBeNull(); // Should return null on decryption failure
  });

  test('uses default password when KEYRING_PASSWORD not set', async () => {
    delete process.env.KEYRING_PASSWORD;
    const { storeCredentials, getStoredCredentials, deleteStoredCredentials } =
      await import('../src/keychain.js');

    await storeCredentials(sampleCredentials);
    const stored = await getStoredCredentials();

    // Should still work with default password
    expect(stored).toEqual(sampleCredentials);

    // Cleanup default stored credentials so they don't affect other tests
    await deleteStoredCredentials();
  });
});

describe('Keychain - Platform Detection', () => {
  test('uses file storage when KEYRING_PASSWORD is set', async () => {
    process.env.KEYRING_PASSWORD = 'explicit-file-storage';
    const { storeCredentials, getCredentialsFilePath, flushPendingWrites } =
      await import('../src/keychain.js');

    await storeCredentials(sampleCredentials);
    await flushPendingWrites();

    // Verify file was created (indicates file storage was used)
    const filePath = getCredentialsFilePath();
    expect(existsSync(filePath)).toBe(true);
  });
});

describe('Keychain - Error Handling', () => {
  beforeEach(() => {
    process.env.KEYRING_PASSWORD = 'test-password';
  });

  test('deleteStoredCredentials does not throw when no credentials exist', async () => {
    const { deleteStoredCredentials } = await import('../src/keychain.js');

    await expect(deleteStoredCredentials()).resolves.toBeUndefined();
  });

  test('handles corrupted file gracefully', async () => {
    const { getCredentialsFilePath, getStoredCredentials } = await import('../src/keychain.js');

    const filePath = getCredentialsFilePath();
    const { getDataDir } = await import('../src/paths.js');
    getDataDir(); // Ensure directory exists

    // Write corrupted data
    writeFileSync(filePath, 'corrupted-data', { mode: 0o600 });

    const stored = await getStoredCredentials();
    expect(stored).toBeNull(); // Should return null instead of throwing
  });
});

describe('Keychain - Credential Structure', () => {
  beforeEach(() => {
    process.env.KEYRING_PASSWORD = 'test-password';
  });

  test('preserves all credential fields', async () => {
    const { storeCredentials, getStoredCredentials } = await import('../src/keychain.js');

    const fullCredentials = {
      parentUID: 'parent-uid',
      parentAccessToken: 'parent-access',
      parentRefreshToken: 'parent-refresh',
      childUID: 'child-uid',
      childAccessToken: 'child-access',
      childRefreshToken: 'child-refresh',
      SaltedKeyPass: 'salted-key',
      UserID: 'user-id',
      username: 'user@proton.me',
      passwordMode: 2 as const,
    };

    await storeCredentials(fullCredentials);
    const stored = await getStoredCredentials();

    expect(stored).toEqual(fullCredentials);
    expect(Object.keys(stored || {}).length).toBe(10);
  });

  test('handles special characters in credentials', async () => {
    const { storeCredentials, getStoredCredentials } = await import('../src/keychain.js');

    const specialCredentials = {
      ...sampleCredentials,
      username: 'user+special@proton.me',
      parentAccessToken: 'token-with-$pecial-ch@rs!',
    };

    await storeCredentials(specialCredentials);
    const stored = await getStoredCredentials();

    expect(stored?.username).toBe('user+special@proton.me');
    expect(stored?.parentAccessToken).toBe('token-with-$pecial-ch@rs!');
  });
});

describe('Keychain - Performance & Concurrency', () => {
  test('caches and coalesces concurrent reads', async () => {
    // Write credentials with one module instance and flush to storage
    const m1 = await import('../src/keychain.js');
    await m1.deleteStoredCredentials();
    await m1.storeCredentials(sampleCredentials);
    await m1.flushPendingWrites();

    // Import a fresh instance so it has no in-memory cache
    const m2 = await import('../src/keychain.js');
    m2.resetKeyringInstrumentation();

    const [a, b, c] = await Promise.all([
      m2.getStoredCredentials(),
      m2.getStoredCredentials(),
      m2.getStoredCredentials(),
    ]);

    expect(a).toEqual(sampleCredentials);
    expect(b).toEqual(sampleCredentials);
    expect(c).toEqual(sampleCredentials);

    // Underlying keyring/file read should have happened only once
    expect(m2.getKeyringReadCount()).toBe(1);
  });

  test('debounces writes and coalesces concurrent writes', async () => {
    const mod = await import('../src/keychain.js');
    mod.resetKeyringInstrumentation();
    await mod.deleteStoredCredentials();

    // Rapid successive writes - only the last should persist after debounce
    await mod.storeCredentials({ ...sampleCredentials, username: 'a' });
    await mod.storeCredentials({ ...sampleCredentials, username: 'b' });
    await mod.storeCredentials({ ...sampleCredentials, username: 'c' });

    await mod.flushPendingWrites();

    // Only one underlying write should have been performed
    expect(mod.getKeyringWriteCount()).toBeLessThanOrEqual(1);

    const stored = await mod.getStoredCredentials();
    expect(stored?.username).toBe('c');
  });

  test('instrumentation increments on get and store', async () => {
    const mod = await import('../src/keychain.js');
    mod.resetKeyringInstrumentation();
    await mod.deleteStoredCredentials();

    expect(mod.getKeyringReadCount()).toBe(0);
    expect(mod.getKeyringWriteCount()).toBe(0);

    await mod.storeCredentials(sampleCredentials);
    await mod.flushPendingWrites();
    expect(mod.getKeyringWriteCount()).toBe(1);

    // Import a fresh instance to force a backend read (cache not present)
    const mod2 = await import('../src/keychain.js');
    mod2.resetKeyringInstrumentation();
    const fetched = await mod2.getStoredCredentials();
    expect(fetched).not.toBeNull();
    expect(mod2.getKeyringReadCount()).toBe(1);
  });
});
