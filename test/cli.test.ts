/**
 * Integration Tests - CLI Commands
 *
 * Executes command actions with safe mocks for external dependencies.
 */

import { afterEach, beforeEach, describe, expect, vi, test } from 'vitest';
import { Command } from 'commander';
import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { registerAuthCommand } from '../src/cli/auth.js';
import { registerStartCommand } from '../src/cli/start.js';
import { registerStopCommand } from '../src/cli/stop.js';
import { registerStatusCommand } from '../src/cli/status.js';
import * as keychainModule from '../src/keychain.js';

// ============================================================================
// Mocks
// ============================================================================

const { keychainMocks } = vi.hoisted(() => ({
  keychainMocks: {
    hasStoredCredentials: vi.fn(() => Promise.resolve(false)),
    storeCredentials: vi.fn(() => Promise.resolve()),
    deleteStoredCredentials: vi.fn(() => Promise.resolve()),
    getStoredCredentials: vi.fn(() => Promise.resolve({ username: 'testuser' })),
  },
}));

vi.mock('../src/keychain.js', () => keychainMocks);

vi.mock('../src/auth.js', () => ({
  ProtonAuth: class MockProtonAuth {
    login = vi.fn(() =>
      Promise.resolve({ UID: 'user-123', AccessToken: 'token', RefreshToken: 'refresh' })
    );
    submit2FA = vi.fn(() =>
      Promise.resolve({ UID: 'user-123', AccessToken: 'token', RefreshToken: 'refresh' })
    );
    submitMailboxPassword = vi.fn(() =>
      Promise.resolve({ UID: 'user-123', AccessToken: 'token', RefreshToken: 'refresh' })
    );
    getReusableCredentials = vi.fn(() => ({
      parentUID: 'parent-uid',
      parentAccessToken: 'parent-access',
      parentRefreshToken: 'parent-refresh',
      childUID: 'child-uid',
      childAccessToken: 'child-access',
      childRefreshToken: 'child-refresh',
      SaltedKeyPass: 'salted-key',
      UserID: 'user-id',
      passwordMode: 1 as const,
    }));
    getSession = vi.fn(() => null);
    refreshToken = vi.fn(() =>
      Promise.resolve({
        UID: 'user-123',
        AccessToken: 'token',
        RefreshToken: 'refresh',
      })
    );
    forkNewChildSession = vi.fn(() =>
      Promise.resolve({
        UID: 'user-123',
        AccessToken: 'token',
        RefreshToken: 'refresh',
      })
    );
    restoreSession = vi.fn(() =>
      Promise.resolve({
        UID: 'user-123',
        AccessToken: 'token',
        RefreshToken: 'refresh',
      })
    );
    logout = vi.fn(() => Promise.resolve());
  },
  restoreSessionFromStorage: vi.fn(() => Promise.resolve({ username: 'testuser' })),
}));

vi.mock('../src/config.js', () => ({
  loadConfig: vi.fn(() => ({
    webdav: {
      host: '127.0.0.1',
      port: 8080,
      https: false,
      requireAuth: true,
    },
    debug: false,
    remotePath: '/',
  })),
  getConfig: vi.fn(() => ({
    webdav: {
      host: '127.0.0.1',
      port: 8080,
      https: false,
      requireAuth: true,
    },
    debug: false,
    remotePath: '/',
  })),
  updateConfig: vi.fn(() => {}),
}));

const mockStart = vi.fn(() => Promise.resolve());
const mockStop = vi.fn(() => Promise.resolve());

vi.mock('../src/webdav/index.js', () => ({
  WebDAVServer: class MockWebDAVServer {
    start = mockStart;
    stop = mockStop;
    getUrl = () => 'http://127.0.0.1:8080';
    getHttpServer = () => ({
      address: () => ({ port: 8080 }),
    });
  },
}));

const pidFilePath = join(tmpdir(), 'pdb-test.pid');
const logFilePath = join(tmpdir(), 'pdb-test.log');

vi.mock('../src/paths.js', () => ({
  getPidFilePath: () => pidFilePath,
  getLogFilePath: () => logFilePath,
  getConfigDir: () => join(tmpdir(), 'pdb-config'),
  getDataDir: () => join(tmpdir(), 'pdb-data'),
  getLogDir: () => join(tmpdir(), 'pdb-logs'),
  getCredentialsFilePath: () => join(tmpdir(), 'pdb-creds.json'),
}));

vi.mock('../src/logger.js', () => ({
  logger: {
    info: vi.fn(() => {}),
    error: vi.fn(() => {}),
    warn: vi.fn(() => {}),
    debug: vi.fn(() => {}),
  },
  setDebugMode: vi.fn(() => {}),
}));

const { mockInput, mockPassword, mockConfirm } = vi.hoisted(() => ({
  mockInput: vi.fn(({ message }: { message: string }) => {
    if (message.includes('2FA')) return Promise.resolve('123456');
    return Promise.resolve('testuser');
  }),
  mockPassword: vi.fn(() => Promise.resolve('password123')),
  mockConfirm: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@inquirer/prompts', () => ({
  input: mockInput,
  password: mockPassword,
  confirm: mockConfirm,
}));

// ============================================================================
// Helpers
// ============================================================================

const createProgram = () => {
  const program = new Command();
  program.exitOverride();
  registerAuthCommand(program);
  registerStartCommand(program);
  registerStopCommand(program);
  registerStatusCommand(program);
  return program;
};

const captureConsole = () => {
  const originalLog = console.log;
  const originalError = console.error;
  const logs: string[] = [];
  const errors: string[] = [];

  console.log = ((message?: unknown, ...args: unknown[]) => {
    const text = [message, ...args].map((val) => String(val)).join(' ');
    logs.push(text);
  }) as typeof console.log;

  console.error = ((message?: unknown, ...args: unknown[]) => {
    const text = [message, ...args].map((val) => String(val)).join(' ');
    errors.push(text);
  }) as typeof console.error;

  return {
    logs,
    errors,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
    },
  };
};

// ============================================================================
// Tests
// ============================================================================


// ============================================================================
// Test Helper - Access Mocked Keychain Functions
// ============================================================================

describe('CLI - Auth Commands', () => {
  beforeEach(() => {
    // Force file-based encrypted storage for keyring (not testing keyring itself)
    process.env.KEY_FILE_PASSWORD = 'test-keyring-password';

    keychainMocks.hasStoredCredentials.mockClear();
    keychainMocks.storeCredentials.mockClear();
    keychainMocks.deleteStoredCredentials.mockClear();
    mockInput.mockClear();
    mockPassword.mockClear();
    mockConfirm.mockClear();

    keychainMocks.hasStoredCredentials.mockReturnValue(Promise.resolve(false));
    mockInput.mockReturnValue(Promise.resolve('testuser'));
    mockPassword.mockReturnValue(Promise.resolve('password123'));
    mockConfirm.mockReturnValue(Promise.resolve(true));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    delete process.env.KEY_FILE_PASSWORD;
  });

  test('auth login should store credentials', async () => {
    const program = createProgram();
    await program.parseAsync(['auth', 'login', '--username', 'user@example.com'], {
      from: 'user',
    });

    expect(keychainMocks.storeCredentials).toHaveBeenCalled();
    const call = keychainMocks.storeCredentials.mock.calls.at(0)?.at(0) as unknown as { username: string };
    expect(call.username).toBe('user@example.com');
  });

  test('auth login should respect cancel when already logged in', async () => {
    keychainMocks.hasStoredCredentials.mockReturnValue(Promise.resolve(true));
    mockConfirm.mockReturnValue(Promise.resolve(false));

    const program = createProgram();
    await program.parseAsync(['auth', 'login', '--username', 'user@example.com'], {
      from: 'user',
    });

    expect(keychainMocks.storeCredentials).not.toHaveBeenCalled();
  });

  test('auth logout should delete stored credentials', async () => {
    keychainMocks.hasStoredCredentials.mockReturnValue(Promise.resolve(true));
    mockConfirm.mockReturnValue(Promise.resolve(true));

    const program = createProgram();
    await program.parseAsync(['auth', 'logout'], { from: 'user' });

    expect(keychainMocks.deleteStoredCredentials).toHaveBeenCalled();
  });

  test('auth status should report username', async () => {
    keychainMocks.hasStoredCredentials.mockReturnValue(Promise.resolve(true));

    const capture = captureConsole();
    try {
      const program = createProgram();
      await program.parseAsync(['auth', 'status'], { from: 'user' });

      const output = capture.logs.join('\n');
      expect(output).toContain('Logged in as');
      expect(output).toContain('testuser');
    } finally {
      capture.restore();
    }
  });
});

describe('CLI - Start Command', () => {
  beforeEach(() => {
    mockStart.mockClear();
    keychainMocks.hasStoredCredentials.mockReturnValue(Promise.resolve(true));
    // Force file-based encrypted storage for keyring (not testing keyring itself)
    process.env.KEY_FILE_PASSWORD = 'test-keyring-password';
    if (existsSync(pidFilePath)) {
      unlinkSync(pidFilePath);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    if (existsSync(pidFilePath)) {
      unlinkSync(pidFilePath);
    }
    delete process.env.KEY_FILE_PASSWORD;
  });

  test('start should invoke WebDAV server', async () => {
    const program = createProgram();
    await program.parseAsync(['start', '--host', '127.0.0.1', '--port', '9999', '--no-auth'], {
      from: 'user',
    });

    expect(mockStart).toHaveBeenCalled();
    expect(existsSync(pidFilePath)).toBe(true);
  });

  test('start should exit when not logged in', async () => {
    keychainMocks.hasStoredCredentials.mockReturnValue(Promise.resolve(false));
    const program = createProgram();

    const originalExit = process.exit;
    process.exit = ((code?: number) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as never;

    try {
      await program.parseAsync(['start'], { from: 'user' });
      expect(true).toBe(false);
    } catch (error) {
      expect(String(error)).toContain('exit:1');
      expect(mockStart).not.toHaveBeenCalled();
    } finally {
      process.exit = originalExit;
    }
  });
});

describe('CLI - Stop Command', () => {
  beforeEach(() => {
    // Force file-based encrypted storage for keyring (not testing keyring itself)
    process.env.KEY_FILE_PASSWORD = 'test-keyring-password';
    if (existsSync(pidFilePath)) {
      unlinkSync(pidFilePath);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    if (existsSync(pidFilePath)) {
      unlinkSync(pidFilePath);
    }
    delete process.env.KEY_FILE_PASSWORD;
  });

  test('stop should report when no PID file exists', async () => {
    const capture = captureConsole();
    try {
      const program = createProgram();
      await program.parseAsync(['stop'], { from: 'user' });

      const output = capture.logs.join('\n');
      expect(output).toContain('Server is not running');
    } finally {
      capture.restore();
    }
  });

  test('stop should remove stale PID file when process not running', async () => {
    writeFileSync(pidFilePath, String(process.pid));

    const originalKill = process.kill;

    process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
      if (signal === 0 || signal === undefined) {
        throw new Error('Process not running');
      }
      return true;
    }) as typeof process.kill;

    try {
      const program = createProgram();
      await program.parseAsync(['stop'], { from: 'user' });
      expect(existsSync(pidFilePath)).toBe(false);
    } finally {
      process.kill = originalKill;
    }
  });

  test('stop command should register --force option', () => {
    const program = new Command();
    registerStopCommand(program);

    const stopCmd = program.commands.find((cmd) => cmd.name() === 'stop');
    const forceOption = stopCmd?.options.find((opt) => opt.long === '--force');

    expect(forceOption).toBeDefined();
  });
});

describe('CLI - Status Command', () => {
  beforeEach(() => {
    // Force file-based encrypted storage for keyring (not testing keyring itself)
    process.env.KEY_FILE_PASSWORD = 'test-keyring-password';
    keychainMocks.hasStoredCredentials.mockReturnValue(Promise.resolve(true));
    if (existsSync(pidFilePath)) {
      unlinkSync(pidFilePath);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    if (existsSync(pidFilePath)) {
      unlinkSync(pidFilePath);
    }
    delete process.env.KEY_FILE_PASSWORD;
  });

  test('status --json should output JSON with server and auth info', async () => {
    writeFileSync(pidFilePath, String(process.pid));

    const originalKill = process.kill;
    process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
      if (signal === 0 || signal === undefined) {
        return true;
      }
      return true;
    }) as typeof process.kill;

    const capture = captureConsole();
    try {
      const program = createProgram();
      await program.parseAsync(['status', '--json'], { from: 'user' });

      const output = capture.logs.join('\n');
      const parsed = JSON.parse(output) as {
        server: { running: boolean };
        auth: { loggedIn: boolean; username: string | null };
      };

      expect(parsed.server.running).toBe(true);
      expect(parsed.auth.loggedIn).toBe(true);
      expect(parsed.auth.username).toBe('testuser');
    } finally {
      capture.restore();
      process.kill = originalKill;
    }
  });
});
