/**
 * Integration Tests - CLI Commands
 *
 * Executes command actions with safe mocks for external dependencies.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Command } from 'commander';
import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { registerAuthCommand } from '../src/cli/auth.js';
import { registerStartCommand } from '../src/cli/start.js';
import { registerStopCommand } from '../src/cli/stop.js';
import { registerStatusCommand } from '../src/cli/status.js';

// ============================================================================
// Mocks
// ============================================================================

const mockHasStoredCredentials = mock(() => Promise.resolve(false));
const mockStoreCredentials = mock(() => Promise.resolve());
const mockDeleteStoredCredentials = mock(() => Promise.resolve());
const mockGetStoredCredentials = mock(() => Promise.resolve({ username: 'testuser' }));

mock.module('../src/keychain.js', () => ({
  hasStoredCredentials: mockHasStoredCredentials,
  storeCredentials: mockStoreCredentials,
  deleteStoredCredentials: mockDeleteStoredCredentials,
  getStoredCredentials: mockGetStoredCredentials,
}));

const mockLogin = mock(() =>
  Promise.resolve({ UID: 'user-123', AccessToken: 'token', RefreshToken: 'refresh' })
);
const mockSubmit2FA = mock(() =>
  Promise.resolve({ UID: 'user-123', AccessToken: 'token', RefreshToken: 'refresh' })
);
const mockSubmitMailboxPassword = mock(() =>
  Promise.resolve({ UID: 'user-123', AccessToken: 'token', RefreshToken: 'refresh' })
);
const mockGetReusableCredentials = mock(() => ({
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

mock.module('../src/auth.js', () => ({
  ProtonAuth: class MockProtonAuth {
    login = mockLogin;
    submit2FA = mockSubmit2FA;
    submitMailboxPassword = mockSubmitMailboxPassword;
    getReusableCredentials = mockGetReusableCredentials;
    getSession = mock(() => null);
    refreshToken = mock(() =>
      Promise.resolve({
        UID: 'user-123',
        AccessToken: 'token',
        RefreshToken: 'refresh',
      })
    );
    forkNewChildSession = mock(() =>
      Promise.resolve({
        UID: 'user-123',
        AccessToken: 'token',
        RefreshToken: 'refresh',
      })
    );
    restoreSession = mock(() =>
      Promise.resolve({
        UID: 'user-123',
        AccessToken: 'token',
        RefreshToken: 'refresh',
      })
    );
    logout = mock(() => Promise.resolve());
  },
  restoreSessionFromStorage: mock(() => Promise.resolve({ username: 'testuser' })),
}));

mock.module('../src/config.js', () => ({
  loadConfig: mock(() => ({
    webdav: {
      host: '127.0.0.1',
      port: 8080,
      https: false,
      requireAuth: true,
    },
    debug: false,
    remotePath: '/',
  })),
  getConfig: mock(() => ({
    webdav: {
      host: '127.0.0.1',
      port: 8080,
      https: false,
      requireAuth: true,
    },
    debug: false,
    remotePath: '/',
  })),
}));

const mockStart = mock(() => Promise.resolve());
const mockStop = mock(() => Promise.resolve());

mock.module('../src/webdav/index.js', () => ({
  WebDAVServer: class MockWebDAVServer {
    start = mockStart;
    stop = mockStop;
    getUrl = () => 'http://127.0.0.1:8080';
  },
}));

const pidFilePath = join(tmpdir(), 'pdb-test.pid');
const logFilePath = join(tmpdir(), 'pdb-test.log');

mock.module('../src/paths.js', () => ({
  getPidFilePath: () => pidFilePath,
  getLogFilePath: () => logFilePath,
  getConfigDir: () => join(tmpdir(), 'pdb-config'),
  getDataDir: () => join(tmpdir(), 'pdb-data'),
  getLogDir: () => join(tmpdir(), 'pdb-logs'),
}));

mock.module('../src/logger.js', () => ({
  logger: {
    info: mock(() => {}),
    error: mock(() => {}),
    warn: mock(() => {}),
    debug: mock(() => {}),
  },
  setDebugMode: mock(() => {}),
}));

const mockInput = mock(({ message }: { message: string }) => {
  if (message.includes('2FA')) return Promise.resolve('123456');
  return Promise.resolve('testuser');
});
const mockPassword = mock(() => Promise.resolve('password123'));
const mockConfirm = mock(() => Promise.resolve(true));

mock.module('@inquirer/prompts', () => ({
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

describe('CLI - Auth Commands', () => {
  beforeEach(() => {
    mockHasStoredCredentials.mockReset();
    mockStoreCredentials.mockReset();
    mockDeleteStoredCredentials.mockReset();
    mockInput.mockReset();
    mockPassword.mockReset();
    mockConfirm.mockReset();

    mockHasStoredCredentials.mockReturnValue(Promise.resolve(false));
    mockInput.mockReturnValue(Promise.resolve('testuser'));
    mockPassword.mockReturnValue(Promise.resolve('password123'));
    mockConfirm.mockReturnValue(Promise.resolve(true));
  });

  test('auth login should store credentials', async () => {
    const program = createProgram();
    await program.parseAsync(['auth', 'login', '--username', 'user@example.com'], {
      from: 'user',
    });

    expect(mockLogin).toHaveBeenCalled();
    expect(mockStoreCredentials).toHaveBeenCalled();
    const call = mockStoreCredentials.mock.calls.at(0)?.at(0) as unknown as { username: string };
    expect(call.username).toBe('user@example.com');
  });

  test('auth login should respect cancel when already logged in', async () => {
    mockHasStoredCredentials.mockReturnValue(Promise.resolve(true));
    mockConfirm.mockReturnValue(Promise.resolve(false));

    const program = createProgram();
    await program.parseAsync(['auth', 'login', '--username', 'user@example.com'], {
      from: 'user',
    });

    expect(mockStoreCredentials).not.toHaveBeenCalled();
  });

  test('auth logout should delete stored credentials', async () => {
    mockHasStoredCredentials.mockReturnValue(Promise.resolve(true));
    mockConfirm.mockReturnValue(Promise.resolve(true));

    const program = createProgram();
    await program.parseAsync(['auth', 'logout'], { from: 'user' });

    expect(mockDeleteStoredCredentials).toHaveBeenCalled();
  });

  test('auth status should report username', async () => {
    mockHasStoredCredentials.mockReturnValue(Promise.resolve(true));

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
    mockStart.mockReset();
    mockHasStoredCredentials.mockReturnValue(Promise.resolve(true));
    if (existsSync(pidFilePath)) {
      unlinkSync(pidFilePath);
    }
  });

  afterEach(() => {
    if (existsSync(pidFilePath)) {
      unlinkSync(pidFilePath);
    }
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
    mockHasStoredCredentials.mockReturnValue(Promise.resolve(false));
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
    if (existsSync(pidFilePath)) {
      unlinkSync(pidFilePath);
    }
  });

  afterEach(() => {
    if (existsSync(pidFilePath)) {
      unlinkSync(pidFilePath);
    }
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
    mockHasStoredCredentials.mockReturnValue(Promise.resolve(true));
    if (existsSync(pidFilePath)) {
      unlinkSync(pidFilePath);
    }
  });

  afterEach(() => {
    if (existsSync(pidFilePath)) {
      unlinkSync(pidFilePath);
    }
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
