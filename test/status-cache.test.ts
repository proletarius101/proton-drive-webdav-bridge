import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, beforeAll, describe, test, expect, mock } from 'bun:test';

// Shared mock factories for isolated state
import {
  createMockState,
  createKeychainMocks,
  createConfigMocks,
  resetTestHelpers,
  captureConsoleAsync,
} from './helpers/mocks.js';

const mockState = createMockState();
const keychainMocks = createKeychainMocks(mockState);
const configMocks = createConfigMocks(mockState);

mock.module('../src/keychain.js', () => keychainMocks);
mock.module('../src/config.js', () => configMocks);

// Use real modules
import { buildProgram } from '../src/index.js';

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
  let program: any;

  beforeAll(() => {
    // Build the CLI program once to avoid duplicate commander option registration
    program = buildProgram();
  });

  beforeEach(() => {
    // Reset mock state for isolation
    resetTestHelpers(mockState);
    keychainMocks.storeCredentials.mockClear();
    keychainMocks.getStoredCredentials.mockClear();
    configMocks.getConfig.mockClear();
    configMocks.updateConfig.mockClear();

    baseDir = mkdtempSync(join(tmpdir(), 'pdb-status-'));
    // Force file-based encrypted storage for keyring (not testing keyring itself)
    process.env.KEYRING_PASSWORD = 'test-keyring-password';
  });

  afterEach(async () => {
    mock.restore();
    mock.clearAllMocks();
    rmSync(baseDir, { recursive: true, force: true });
    delete process.env.KEYRING_PASSWORD;
  });

  test('status --json shows logged-in user with username from config', async () => {
    // Store credentials and username in config (mimics login flow)
    mockState.credentials = sample;
    mockState.config.username = sample.username;

    // Run the status command with captured console output
    const { logs } = await captureConsoleAsync(async () => {
      await program.parseAsync(['status', '--json'], { from: 'user' });
    });

    const out = logs.join('\n');
    const parsed = JSON.parse(out) as { auth: { loggedIn: boolean; username?: string } };

    expect(parsed.auth.loggedIn).toBe(true);
    expect(parsed.auth.username).toBe(sample.username);
  });

  test('status --json shows not logged in when no credentials exist', async () => {
    // Ensure clean slate (no credentials)
    mockState.credentials = null;
    mockState.config.username = undefined;

    // Run the status command with captured console output
    const { logs } = await captureConsoleAsync(async () => {
      await program.parseAsync(['status', '--json'], { from: 'user' });
    });

    const out = logs.join('\n');
    const parsed = JSON.parse(out) as { auth: { loggedIn: boolean; username?: string | null } };

    expect(parsed.auth.loggedIn).toBe(false);
    expect(parsed.auth.username).toBeNull();
  });
});
