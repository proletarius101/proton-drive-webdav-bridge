/**
 * Shared test mocks and utilities
 * 
 * Provides reusable mock factories for common dependencies to avoid duplication
 * and ensure consistent mocking patterns across tests.
 */

import { mock } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';

// ============================================================================
// Mock State Management
// ============================================================================

interface MockState {
  credentials: any | null;
  config: any;
}

export function createMockState(): MockState {
  return {
    credentials: null,
    config: {
      webdav: { host: '127.0.0.1', port: 8080, https: false, requireAuth: true },
      remotePath: '/',
      cache: { enabled: true, ttlSeconds: 60, maxSizeMB: 100 },
      debug: false,
      autoStart: false,
      username: undefined,
    },
  };
}

/**
 * Reset test helpers state between tests
 * 
 * Call this in afterEach to ensure clean state between tests.
 * Clears mock state and any global stores.
 */
export function resetTestHelpers(state: MockState) {
  state.credentials = null;
  state.config = createMockState().config;
}

/**
 * Capture console output for testing
 * 
 * Temporarily replaces console.log to capture output, then restores it.
 * Returns the captured logs as an array of strings.
 * 
 * @example
 * const { logs } = captureConsole(() => {
 *   console.log("hello");
 * });
 * expect(logs).toEqual(["hello"]);
 */
export function captureConsole<T>(callback: () => T): { result: T; logs: string[] } {
  const logs: string[] = [];
  const original = console.log;
  console.log = (msg?: unknown) => {
    logs.push(String(msg ?? ''));
  };
  try {
    const result = callback();
    return { result, logs };
  } finally {
    console.log = original;
  }
}

/**
 * Capture console output for async functions
 */
export async function captureConsoleAsync<T>(
  callback: () => Promise<T>
): Promise<{ result: T; logs: string[] }> {
  const logs: string[] = [];
  const original = console.log;
  console.log = (msg?: unknown) => {
    logs.push(String(msg ?? ''));
  };
  try {
    const result = await callback();
    return { result, logs };
  } finally {
    console.log = original;
  }
}

// ============================================================================
// Keychain Mocks
// ============================================================================

export function createKeychainMocks(state: MockState) {
  return {
    storeCredentials: mock((creds: any) => {
      state.credentials = creds;
      return Promise.resolve();
    }),
    getStoredCredentials: mock(() => Promise.resolve(state.credentials)),
    deleteStoredCredentials: mock(() => {
      state.credentials = null;
      return Promise.resolve();
    }),
    hasStoredCredentials: mock(() => Promise.resolve(state.credentials !== null)),
    flushPendingWrites: mock(() => Promise.resolve()),
    getCredentialsFilePath: () => join(tmpdir(), 'test-credentials.enc'),
  };
}

// ============================================================================
// Config Mocks
// ============================================================================

export function createConfigMocks(state: MockState) {
  return {
    getConfig: mock(() => state.config),
    updateConfig: mock((updates: Partial<typeof state.config>) => {
      state.config = {
        ...state.config,
        ...updates,
        webdav: { ...state.config.webdav, ...(updates.webdav || {}) },
        cache: { ...state.config.cache, ...(updates.cache || {}) },
      };
      return state.config;
    }),
    loadConfig: mock(() => state.config),
    saveConfig: mock((config: any) => {
      state.config = config;
    }),
  };
}

// ============================================================================
// Auth Mocks
// ============================================================================

export function createAuthMocks() {
  const loginMock = mock(() =>
    Promise.resolve({ UID: 'user-123', AccessToken: 'token', RefreshToken: 'refresh' })
  );
  const submit2FAMock = mock(() =>
    Promise.resolve({ UID: 'user-123', AccessToken: 'token', RefreshToken: 'refresh' })
  );
  const submitMailboxPasswordMock = mock(() =>
    Promise.resolve({ UID: 'user-123', AccessToken: 'token', RefreshToken: 'refresh' })
  );
  const getReusableCredentialsMock = mock(() => ({
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
  const getSessionMock = mock(() => null);
  const refreshTokenMock = mock(() =>
    Promise.resolve({ UID: 'user-123', AccessToken: 'token', RefreshToken: 'refresh' })
  );
  const forkNewChildSessionMock = mock(() =>
    Promise.resolve({ UID: 'user-123', AccessToken: 'token', RefreshToken: 'refresh' })
  );
  const restoreSessionMock = mock(() =>
    Promise.resolve({ UID: 'user-123', AccessToken: 'token', RefreshToken: 'refresh' })
  );
  const logoutMock = mock(() => Promise.resolve());
  const restoreSessionFromStorageMock = mock(() => Promise.resolve({ username: 'testuser' }));

  return {
    ProtonAuth: class MockProtonAuth {
      login = loginMock;
      submit2FA = submit2FAMock;
      submitMailboxPassword = submitMailboxPasswordMock;
      getReusableCredentials = getReusableCredentialsMock;
      getSession = getSessionMock;
      refreshToken = refreshTokenMock;
      forkNewChildSession = forkNewChildSessionMock;
      restoreSession = restoreSessionMock;
      logout = logoutMock;
    },
    restoreSessionFromStorage: restoreSessionFromStorageMock,
    _loginMock: loginMock,
    _submit2FAMock: submit2FAMock,
    _submitMailboxPasswordMock: submitMailboxPasswordMock,
    _getReusableCredentialsMock: getReusableCredentialsMock,
    _restoreSessionFromStorageMock: restoreSessionFromStorageMock,
  };
}

// ============================================================================
// Paths Mocks
// ============================================================================

export function createPathsMocks(baseDir: string) {
  return {
    getPidFilePath: () => join(baseDir, 'pdb-test.pid'),
    getLogFilePath: () => join(baseDir, 'pdb-test.log'),
    getConfigFilePath: () => join(baseDir, 'config', 'config.json'),
    getConfigDir: () => join(baseDir, 'config'),
    getDataDir: () => join(baseDir, 'data'),
    getLogDir: () => join(baseDir, 'logs'),
    getCredentialsFilePath: () => join(baseDir, 'data', 'credentials.enc'),
  };
}

// ============================================================================
// Logger Mocks
// ============================================================================

export function createLoggerMocks() {
  return {
    logger: {
      info: mock(() => {}),
      error: mock(() => {}),
      warn: mock(() => {}),
      debug: mock(() => {}),
    },
    setDebugMode: mock(() => {}),
  };
}

// ============================================================================
// WebDAV Mocks
// ============================================================================

export function createWebDAVMocks() {
  const startMock = mock(() => Promise.resolve());
  const stopMock = mock(() => Promise.resolve());

  return {
    WebDAVServer: class MockWebDAVServer {
      start = startMock;
      stop = stopMock;
      getUrl = () => 'http://127.0.0.1:8080';
      getHttpServer = () => ({
        address: () => ({ port: 8080 }),
      });
    },
    _startMock: startMock,
    _stopMock: stopMock,
  };
}

// ============================================================================
// Prompt Mocks
// ============================================================================

export function createPromptMocks() {
  const mockInput = mock(({ message }: { message: string }) => {
    if (message.includes('2FA')) return Promise.resolve('123456');
    return Promise.resolve('testuser');
  });
  
  const mockPassword = mock(() => Promise.resolve('password123'));
  const mockConfirm = mock(() => Promise.resolve(true));

  return {
    input: mockInput,
    password: mockPassword,
    confirm: mockConfirm,
  };
}

// ============================================================================
// Complete Mock Setup
// ============================================================================

/**
 * Install all mocks for a test suite with isolated state
 * 
 * Usage:
 * ```typescript
 * const mockState = createMockState();
 * const mocks = setupAllMocks(mockState, baseDir);
 * ```
 */
export function setupAllMocks(state: MockState, baseDir: string) {
  const keychainMocks = createKeychainMocks(state);
  const configMocks = createConfigMocks(state);
  const authMocks = createAuthMocks();
  const pathsMocks = createPathsMocks(baseDir);
  const loggerMocks = createLoggerMocks();
  const webdavMocks = createWebDAVMocks();
  const promptMocks = createPromptMocks();

  // Install module mocks
  mock.module('../src/keychain.js', () => keychainMocks);
  mock.module('../src/config.js', () => configMocks);
  mock.module('../src/auth.js', () => authMocks);
  mock.module('../src/paths.js', () => pathsMocks);
  mock.module('../src/logger.js', () => loggerMocks);
  mock.module('../src/webdav/index.js', () => webdavMocks);
  mock.module('@inquirer/prompts', () => promptMocks);

  return {
    keychain: keychainMocks,
    config: configMocks,
    auth: authMocks,
    paths: pathsMocks,
    logger: loggerMocks,
    webdav: webdavMocks,
    prompts: promptMocks,
  };
}
