import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

const sampleCredentials = {
  parentUID: 'parent-uid',
  parentAccessToken: 'parent-access',
  parentRefreshToken: 'parent-refresh',
  childUID: 'child-uid',
  childAccessToken: 'child-access',
  childRefreshToken: 'child-refresh',
  SaltedKeyPass: 'salted-key',
  UserID: 'user-id',
  username: 'user@example.com',
  passwordMode: 1 as const,
};

describe('keychain file storage', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'pdb-keychain-'));
    process.env.XDG_DATA_HOME = baseDir;
    process.env.KEYRING_PASSWORD = 'test-password';
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    delete process.env.KEYRING_PASSWORD;
  });

  it('stores and retrieves credentials', async () => {
    const { storeCredentials, getStoredCredentials, hasStoredCredentials } = await import(
      `../src/keychain.ts?cache=${Date.now()}`
    );

    await storeCredentials(sampleCredentials);

    expect(await hasStoredCredentials()).toBe(true);
    const stored = await getStoredCredentials();
    expect(stored).toEqual(sampleCredentials);
  });

  it('deletes credentials', async () => {
    const { storeCredentials, getStoredCredentials, deleteStoredCredentials } = await import(
      `../src/keychain.ts?cache=${Date.now()}`
    );

    await storeCredentials(sampleCredentials);
    await deleteStoredCredentials();

    const stored = await getStoredCredentials();
    expect(stored).toBeNull();
  });
});
