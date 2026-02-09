import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

// Create module-level mockState object
const mockState = {
  credentials: null as any,
  config: {
    webdav: { host: '127.0.0.1', port: 8080, https: false, requireAuth: true },
    remotePath: '/',
    cache: { enabled: true, ttlSeconds: 60, maxSizeMB: 100 },
    debug: false,
    autoStart: false,
    username: undefined as string | undefined,
  },
};

// Create mocks directly in vi.hoisted to avoid import ordering issues
const { keychainMocks, configMocks } = vi.hoisted(() => ({
  keychainMocks: {
    hasStoredCredentials: vi.fn(async () => {
      return mockState.credentials !== null;
    }),
    storeCredentials: vi.fn(async (creds: any) => {
      mockState.credentials = creds;
    }),
    deleteStoredCredentials: vi.fn(async () => {
      mockState.credentials = null;
    }),
    getStoredCredentials: vi.fn(async () => mockState.credentials),
  },
  configMocks: {
    getConfig: vi.fn(() => mockState.config),
    updateConfig: vi.fn((updates: any) => {
      mockState.config = { ...mockState.config, ...updates };
    }),
  },
}));

vi.mock('../src/keychain.js', () => keychainMocks);
vi.mock('../src/config.js', () => ({
  ...configMocks,
  loadConfig: vi.fn(() => {}),
}));

vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(() => Promise.resolve('testuser')),
  password: vi.fn(() => Promise.resolve('password123')),
  confirm: vi.fn(() => Promise.resolve(true)),
}));

// Use real modules
import { Command } from 'commander';
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

// Helper to capture console output during async execution
async function captureConsoleAsync(fn: () => Promise<void>) {
  const logs: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  console.log = (...args: any[]) => logs.push(args.map(String).join(' '));
  console.error = (...args: any[]) => logs.push(args.map(String).join(' '));
  console.warn = (...args: any[]) => logs.push(args.map(String).join(' '));

  try {
    await fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }

  return { logs };
}

describe('CLI - status command', () => {
  let program: Command;

  beforeAll(() => {
    // Build the CLI program once to avoid duplicate commander option registration
    program = buildProgram();
  });

  beforeEach(() => {
    // Reset mocks for isolation
    keychainMocks.storeCredentials.mockClear();
    keychainMocks.getStoredCredentials.mockClear();
    configMocks.getConfig.mockClear();
    configMocks.updateConfig.mockClear();
    keychainMocks.hasStoredCredentials.mockClear();
    keychainMocks.deleteStoredCredentials.mockClear();

    // Force file-based encrypted storage for keyring (not testing keyring itself)
    vi.stubEnv('KEY_FILE_PASSWORD', 'test-keyring-password');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
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
