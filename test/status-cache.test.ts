import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, test, expect, mock } from 'bun:test';

// Mock env-paths to keep data dir in temp
let pathsBase = join(tmpdir(), 'pdb-status-default');
let mockPaths = {
  config: join(pathsBase, 'config'),
  data: join(pathsBase, 'data'),
  log: join(pathsBase, 'log'),
  temp: join(pathsBase, 'temp'),
  cache: join(pathsBase, 'cache'),
};

mock.module('env-paths', () => ({
  default: () => mockPaths,
}));

// Use real modules
import { buildProgram } from '../src/index.js';
import { storeCredentials, flushPendingWrites, deleteStoredCredentials } from '../src/keychain.js';
import { updateConfig, getConfig } from '../src/config.js';

const sample = {
  parentUID: 'p',
  parentAccessToken: 'a',
  parentRefreshToken: 'r',
  childUID: 'c',
  childAccessToken: 'ca',
  childRefreshToken: 'cr',
  SaltedKeyPass: 's',
  UserID: 'u',
  username: 'test-user@proton.me',
  passwordMode: 1 as const,
};

describe('CLI - status command', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'pdb-status-'));
    pathsBase = baseDir;
    mockPaths = {
      config: mkdtempSync(join(pathsBase, 'config')),
      data: mkdtempSync(join(pathsBase, 'data')),
      log: mkdtempSync(join(pathsBase, 'log')),
      temp: mkdtempSync(join(pathsBase, 'temp')),
      cache: mkdtempSync(join(pathsBase, 'cache')),
    };
    // Force file-based encrypted storage for keyring (not testing keyring itself)
    process.env.KEYRING_PASSWORD = 'test-keyring-password';
  });

  afterEach(async () => {
    try {
      await deleteStoredCredentials();
    } catch {}
    rmSync(baseDir, { recursive: true, force: true });
    delete process.env.KEYRING_PASSWORD;
  });

  test('status --json shows logged-in user with username from config', async () => {
    // Store credentials and username in config (mimics login flow)
    await storeCredentials(sample);
    updateConfig({ username: sample.username });
    await flushPendingWrites();

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
  });

  test('status --json shows not logged in when no credentials exist', async () => {
    // Ensure clean slate (no credentials)
    try {
      await deleteStoredCredentials();
    } catch {}

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
    const parsed = JSON.parse(out) as { auth: { loggedIn: boolean; username?: string | null } };

    expect(parsed.auth.loggedIn).toBe(false);
    expect(parsed.auth.username).toBeNull();
  });
});
