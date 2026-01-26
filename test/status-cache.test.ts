import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, test, expect, mock } from 'bun:test';

// Mock env-paths to keep data dir in temp
let pathsBase = join(tmpdir(), 'pdb-status-cache-default');

mock.module('env-paths', () => ({
  default: () => ({
    config: mkdtempSync(join(pathsBase, 'config')),
    data: mkdtempSync(join(pathsBase, 'data')),
    log: mkdtempSync(join(pathsBase, 'log')),
    temp: mkdtempSync(join(pathsBase, 'temp')),
    cache: mkdtempSync(join(pathsBase, 'cache')),
  }),
}));

// Use real modules
import { buildProgram } from '../src/index.js';
import { storeCredentials, flushPendingWrites, getKeyringReadCount, deleteStoredCredentials } from '../src/keychain.js';

const sample = {
  parentUID: 'p',
  parentAccessToken: 'a',
  parentRefreshToken: 'r',
  childUID: 'c',
  childAccessToken: 'ca',
  childRefreshToken: 'cr',
  SaltedKeyPass: 's',
  UserID: 'u',
  username: 'cached-user@proton.me',
  passwordMode: 1 as const,
};

describe('CLI - status uses status cache', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'pdb-status-cache-'));
    pathsBase = baseDir;
  });

  afterEach(async () => {
    try {
      await deleteStoredCredentials();
    } catch {}
    rmSync(baseDir, { recursive: true, force: true });
  });

  test('status --json prefers cache and avoids keyring reads', async () => {
    // Write credentials and flush (this will also write the status cache)
    await storeCredentials(sample);
    await flushPendingWrites();

    // Reset read count
    const readBefore = getKeyringReadCount();

    // Run the status command
    const program = buildProgram();
    const capture: string[] = [];
    const originalLog = console.log;
    console.log = (msg?: unknown) => {
      capture.push(String(msg ?? ''));
    };

    try {
      await program.parseAsync(['status', '--json'], { from: 'user' });
    } finally {
      console.log = originalLog;
    }

    const out = capture.join('\n');
    const parsed = JSON.parse(out) as { auth: { loggedIn: boolean; username?: string } };

    expect(parsed.auth.loggedIn).toBe(true);
    expect(parsed.auth.username).toBe(sample.username);

    // Confirm no additional backend reads (status should have used cache)
    const readAfter = getKeyringReadCount();
    expect(readAfter - readBefore).toBe(0);
  });
});
