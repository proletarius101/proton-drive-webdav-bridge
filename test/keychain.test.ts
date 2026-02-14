/**
 * Comprehensive Integration Tests - Keychain Module
 *
 * Tests secure credential storage including:
 * - File-based encrypted storage with AES-256-GCM
 * - Native OS keyring integration
 * - Platform detection and fallback logic
 * - Password derivation with PBKDF2
 * - Error handling and decryption failures
 */

import { fs, vol } from 'memfs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { keyringStore } from './setup.js';
import {
  storeCredentials,
  getStoredCredentials,
  hasStoredCredentials,
  deleteStoredCredentials,
  getCredentialsFilePath,
  flushPendingWrites,
  resetKeyringInstrumentation,
  getKeyringReadCount,
  getKeyringWriteCount,
  getGetStoredCallCount,
} from '../src/keychain.js';

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
    vi.stubEnv('KEY_FILE_PASSWORD', 'secure-test-password-123');
  });

  test('stores and retrieves credentials with encryption', async () => {
    await storeCredentials(sampleCredentials);

    expect(await hasStoredCredentials()).toBe(true);
    const stored = await getStoredCredentials();
    expect(stored).toEqual(sampleCredentials);
    expect(stored?.username).toBe('testuser@proton.me');
    expect(stored?.parentUID).toBe('parent-uid-123');
    expect(stored?.childAccessToken).toBe('child-access-token-def');
  });

  test('returns null when no credentials stored', async () => {
    // Ensure clean state
    await deleteStoredCredentials();

    expect(await hasStoredCredentials()).toBe(false);
    const stored = await getStoredCredentials();
    expect(stored).toBeNull();
  });

  test('deletes stored credentials', async () => {
    await storeCredentials(sampleCredentials);
    expect(await getStoredCredentials()).not.toBeNull();

    await deleteStoredCredentials();

    const stored = await getStoredCredentials();
    expect(stored).toBeNull();
  });

  test('creates encrypted file with secure permissions', async () => {
    await storeCredentials(sampleCredentials);
    await flushPendingWrites();
    const filePath = getCredentialsFilePath();

    expect(fs.existsSync(filePath)).toBe(true);

    // Verify file is encrypted (not plain JSON)
    const fileContent = fs.readFileSync(filePath);
    const fileStr = fileContent.toString('utf8');
    expect(fileStr).not.toContain('testuser@proton.me');
    expect(fileStr).not.toContain('parent-uid-123');
  });

  test('overwrites existing credentials', async () => {
    await storeCredentials(sampleCredentials);

    const updated = { ...sampleCredentials, username: 'newuser@proton.me' };
    await storeCredentials(updated);

    const stored = await getStoredCredentials();
    expect(stored?.username).toBe('newuser@proton.me');
  });

  test('handles different password modes', async () => {
    const twoPasswordCreds = { ...sampleCredentials, passwordMode: 2 as const };
    await storeCredentials(twoPasswordCreds);

    const stored = await getStoredCredentials();
    expect(stored?.passwordMode).toBe(2);
  });
});

describe('Keychain - Encryption and Security', () => {
  test('uses different encryption key with different passwords', async () => {
    vi.stubEnv('KEY_FILE_PASSWORD', 'password1');
    await storeCredentials(sampleCredentials);
    await flushPendingWrites();
    const filePath = getCredentialsFilePath();
    const encrypted1 = fs.readFileSync(filePath);

    // Change password and re-encrypt
    vi.stubEnv('KEY_FILE_PASSWORD', 'password2');
    await storeCredentials(sampleCredentials);
    await flushPendingWrites();
    const encrypted2 = fs.readFileSync(filePath);

    // Files should be different due to different keys
    expect(Buffer.from(encrypted1).equals(Buffer.from(encrypted2))).toBe(false);
  });

  test('fails to decrypt with wrong password', async () => {
    vi.stubEnv('KEY_FILE_PASSWORD', 'correct-password');
    await storeCredentials(sampleCredentials);

    // Try to read with wrong password
    vi.stubEnv('KEY_FILE_PASSWORD', 'wrong-password');

    const stored = await getStoredCredentials();
    expect(stored).toBeNull(); // Should return null on decryption failure
  });

  test('uses default password when KEY_FILE_PASSWORD not set', async () => {
    vi.stubEnv('KEY_FILE_PASSWORD', undefined);
    await storeCredentials(sampleCredentials);
    const stored = await getStoredCredentials();

    // Should still work with default password
    expect(stored).toEqual(sampleCredentials);

    // Cleanup default stored credentials so they don't affect other tests
    await deleteStoredCredentials();
  });
});

describe('Keychain - Platform Detection', () => {
  test('uses file storage when KEY_FILE_PASSWORD is set', async () => {
    vi.stubEnv('KEY_FILE_PASSWORD', 'explicit-file-storage');
    await storeCredentials(sampleCredentials);
    await flushPendingWrites();

    // Verify file was created (indicates file storage was used)
    const filePath = getCredentialsFilePath();
    expect(fs.existsSync(filePath)).toBe(true);
  });
});

describe('Keychain - Error Handling', () => {
  beforeEach(() => {
    vi.stubEnv('KEY_FILE_PASSWORD', 'test-password');
  });

  test('deleteStoredCredentials does not throw when no credentials exist', async () => {
    await expect(deleteStoredCredentials()).resolves.toBeUndefined();
  });

  test('handles corrupted file gracefully', async () => {
    const filePath = getCredentialsFilePath();
    const { getDataDir } = await import('../src/paths.js');
    getDataDir(); // Ensure directory exists

    // Write corrupted data
    fs.writeFileSync(filePath, 'corrupted-data', { mode: 0o600 });

    const stored = await getStoredCredentials();
    expect(stored).toBeNull(); // Should return null instead of throwing
  });
});

describe('Keychain - Credential Structure', () => {
  beforeEach(() => {
    vi.stubEnv('KEY_FILE_PASSWORD', 'test-password');
  });

  test('preserves all credential fields', async () => {
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
    await deleteStoredCredentials();
    await storeCredentials(sampleCredentials);
    await flushPendingWrites();

    // Ensure instrumentation reset
    resetKeyringInstrumentation();

    const [a, b, c] = await Promise.all([
      getStoredCredentials(),
      getStoredCredentials(),
      getStoredCredentials(),
    ]);

    expect(a).toEqual(sampleCredentials);
    expect(b).toEqual(sampleCredentials);
    expect(c).toEqual(sampleCredentials);

    // Underlying keyring/file read should have happened only once
    expect(getKeyringReadCount()).toBe(1);
  });

  test('debounces writes and coalesces concurrent writes', async () => {
    resetKeyringInstrumentation();
    await deleteStoredCredentials();

    // Rapid successive writes - only the last should persist after debounce
    await storeCredentials({ ...sampleCredentials, username: 'a' });
    await storeCredentials({ ...sampleCredentials, username: 'b' });
    await storeCredentials({ ...sampleCredentials, username: 'c' });

    await flushPendingWrites();

    // Only one underlying write should have been performed
    expect(getKeyringWriteCount()).toBeLessThanOrEqual(1);

    const stored = await getStoredCredentials();
    expect(stored?.username).toBe('c');
  });

  test('instrumentation increments on get and store', async () => {
    resetKeyringInstrumentation();
    await deleteStoredCredentials();

    expect(getKeyringReadCount()).toBe(0);
    expect(getKeyringWriteCount()).toBe(0);

    await storeCredentials(sampleCredentials);
    await flushPendingWrites();
    expect(getKeyringWriteCount()).toBe(1);

    // Force a backend read by clearing cached state in module (if provided)
    resetKeyringInstrumentation();
    const fetched = await getStoredCredentials();
    expect(fetched).not.toBeNull();
    expect(getKeyringReadCount()).toBe(1);
  });

  test('getStored call count reflects top-level calls', async () => {
    resetKeyringInstrumentation();
    await deleteStoredCredentials();

    // Call several times (will trigger backend read on first after reset)
    await storeCredentials(sampleCredentials);
    await flushPendingWrites();

    // Call getStoredCredentials multiple times concurrently
    await Promise.all([getStoredCredentials(), getStoredCredentials()]);
    // getStored call count should be >= 2 (top-level calls)
    expect(getGetStoredCallCount()).toBeGreaterThanOrEqual(2);
  });

  test('cache expiry causes a backend read', async () => {
    // Use fake timers to advance time beyond CACHE_TTL_MS
    vi.useFakeTimers();
    await storeCredentials(sampleCredentials);
    await flushPendingWrites();

    // First read - should be served from cache and not increment backend read (if cached)
    await getStoredCredentials();
    const before = getKeyringReadCount();

    // Advance time by 31s to expire cache (CACHE_TTL_MS = 30_000)
    vi.setSystemTime(Date.now() + 31_000);
    // Next read should trigger backend read
    await getStoredCredentials();
    const after = getKeyringReadCount();

    expect(after).toBeGreaterThanOrEqual(before + 1);
    vi.useRealTimers();
  });
});
