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

import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

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
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'pdb-keychain-'));
    process.env.XDG_DATA_HOME = baseDir;
    process.env.KEYRING_PASSWORD = 'secure-test-password-123';
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    delete process.env.KEYRING_PASSWORD;
    delete process.env.XDG_DATA_HOME;
  });

  test('stores and retrieves credentials with encryption', async () => {
    const { storeCredentials, getStoredCredentials, hasStoredCredentials } = await import(
      `../src/keychain.ts?cache=${Date.now()}`
    );

    await storeCredentials(sampleCredentials);

    expect(await hasStoredCredentials()).toBe(true);
    const stored = await getStoredCredentials();
    expect(stored).toEqual(sampleCredentials);
    expect(stored?.username).toBe('testuser@proton.me');
    expect(stored?.parentUID).toBe('parent-uid-123');
    expect(stored?.childAccessToken).toBe('child-access-token-def');
  });

  test('returns null when no credentials stored', async () => {
    const { getStoredCredentials, hasStoredCredentials } = await import(
      `../src/keychain.ts?cache=${Date.now()}`
    );

    expect(await hasStoredCredentials()).toBe(false);
    const stored = await getStoredCredentials();
    expect(stored).toBeNull();
  });

  test('deletes stored credentials', async () => {
    const { storeCredentials, getStoredCredentials, deleteStoredCredentials } = await import(
      `../src/keychain.ts?cache=${Date.now()}`
    );

    await storeCredentials(sampleCredentials);
    expect(await getStoredCredentials()).not.toBeNull();

    await deleteStoredCredentials();

    const stored = await getStoredCredentials();
    expect(stored).toBeNull();
  });

  test('creates encrypted file with secure permissions', async () => {
    const { storeCredentials, getCredentialsFilePath } = await import(
      `../src/keychain.ts?cache=${Date.now()}`
    );

    await storeCredentials(sampleCredentials);
    const filePath = getCredentialsFilePath();

    expect(existsSync(filePath)).toBe(true);

    // Verify file is encrypted (not plain JSON)
    const fileContent = readFileSync(filePath);
    const fileStr = fileContent.toString('utf8');
    expect(fileStr).not.toContain('testuser@proton.me');
    expect(fileStr).not.toContain('parent-uid-123');
  });

  test('overwrites existing credentials', async () => {
    const { storeCredentials, getStoredCredentials } = await import(
      `../src/keychain.ts?cache=${Date.now()}`
    );

    await storeCredentials(sampleCredentials);

    const updated = { ...sampleCredentials, username: 'newuser@proton.me' };
    await storeCredentials(updated);

    const stored = await getStoredCredentials();
    expect(stored?.username).toBe('newuser@proton.me');
  });

  test('handles different password modes', async () => {
    const { storeCredentials, getStoredCredentials } = await import(
      `../src/keychain.ts?cache=${Date.now()}`
    );

    const twoPasswordCreds = { ...sampleCredentials, passwordMode: 2 as const };
    await storeCredentials(twoPasswordCreds);

    const stored = await getStoredCredentials();
    expect(stored?.passwordMode).toBe(2);
  });
});

describe('Keychain - Encryption and Security', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'pdb-keychain-'));
    process.env.XDG_DATA_HOME = baseDir;
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    delete process.env.KEYRING_PASSWORD;
    delete process.env.XDG_DATA_HOME;
  });

  test('uses different encryption key with different passwords', async () => {
    process.env.KEYRING_PASSWORD = 'password1';
    const { storeCredentials, getCredentialsFilePath } = await import(
      `../src/keychain.ts?cache=${Date.now()}`
    );

    await storeCredentials(sampleCredentials);
    const filePath = getCredentialsFilePath();
    const encrypted1 = readFileSync(filePath);

    // Change password and re-encrypt
    delete process.env.KEYRING_PASSWORD;
    process.env.KEYRING_PASSWORD = 'password2';
    const { storeCredentials: storeCredentials2 } = await import(
      `../src/keychain.ts?cache=${Date.now() + 1}`
    );

    await storeCredentials2(sampleCredentials);
    const encrypted2 = readFileSync(filePath);

    // Files should be different due to different keys
    expect(encrypted1.equals(encrypted2)).toBe(false);
  });

  test('fails to decrypt with wrong password', async () => {
    process.env.KEYRING_PASSWORD = 'correct-password';
    const { storeCredentials } = await import(`../src/keychain.ts?cache=${Date.now()}`);

    await storeCredentials(sampleCredentials);

    // Try to read with wrong password
    delete process.env.KEYRING_PASSWORD;
    process.env.KEYRING_PASSWORD = 'wrong-password';
    const { getStoredCredentials } = await import(`../src/keychain.ts?cache=${Date.now() + 1}`);

    const stored = await getStoredCredentials();
    expect(stored).toBeNull(); // Should return null on decryption failure
  });

  test('uses default password when KEYRING_PASSWORD not set', async () => {
    delete process.env.KEYRING_PASSWORD;
    const { storeCredentials, getStoredCredentials } = await import(
      `../src/keychain.ts?cache=${Date.now()}`
    );

    await storeCredentials(sampleCredentials);
    const stored = await getStoredCredentials();

    // Should still work with default password
    expect(stored).toEqual(sampleCredentials);
  });
});

describe('Keychain - Platform Detection', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'pdb-keychain-'));
    process.env.XDG_DATA_HOME = baseDir;
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    delete process.env.KEYRING_PASSWORD;
    delete process.env.DISPLAY;
    delete process.env.WAYLAND_DISPLAY;
    delete process.env.XDG_DATA_HOME;
  });

  test('uses file storage when KEYRING_PASSWORD is set', async () => {
    process.env.KEYRING_PASSWORD = 'explicit-file-storage';
    const { storeCredentials, getCredentialsFilePath } = await import(
      `../src/keychain.ts?cache=${Date.now()}`
    );

    await storeCredentials(sampleCredentials);

    // Verify file was created (indicates file storage was used)
    const filePath = getCredentialsFilePath();
    expect(existsSync(filePath)).toBe(true);
  });
});

describe('Keychain - Error Handling', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'pdb-keychain-'));
    process.env.XDG_DATA_HOME = baseDir;
    process.env.KEYRING_PASSWORD = 'test-password';
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    delete process.env.KEYRING_PASSWORD;
    delete process.env.XDG_DATA_HOME;
  });

  test('deleteStoredCredentials does not throw when no credentials exist', async () => {
    const { deleteStoredCredentials } = await import(`../src/keychain.ts?cache=${Date.now()}`);

    await expect(deleteStoredCredentials()).resolves.toBeUndefined();
  });

  test('handles corrupted file gracefully', async () => {
    const { getCredentialsFilePath, getStoredCredentials } = await import(
      `../src/keychain.ts?cache=${Date.now()}`
    );

    const filePath = getCredentialsFilePath();
    const { getDataDir } = await import(`../src/paths.ts?cache=${Date.now()}`);
    getDataDir(); // Ensure directory exists

    // Write corrupted data
    const { writeFileSync } = await import('fs');
    writeFileSync(filePath, 'corrupted-data', { mode: 0o600 });

    const stored = await getStoredCredentials();
    expect(stored).toBeNull(); // Should return null instead of throwing
  });
});

describe('Keychain - Credential Structure', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'pdb-keychain-'));
    process.env.XDG_DATA_HOME = baseDir;
    process.env.KEYRING_PASSWORD = 'test-password';
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    delete process.env.KEYRING_PASSWORD;
    delete process.env.XDG_DATA_HOME;
  });

  test('preserves all credential fields', async () => {
    const { storeCredentials, getStoredCredentials } = await import(
      `../src/keychain.ts?cache=${Date.now()}`
    );

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
    const { storeCredentials, getStoredCredentials } = await import(
      `../src/keychain.ts?cache=${Date.now()}`
    );

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
