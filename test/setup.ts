/**
 * Global test setup
 * 
 * Loaded via --preload before any test files run.
 * Provides common mocks that all tests need (env-paths, etc.)
 */

import { mock } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';

// Global base path for test directories
export let pathsBase = join(tmpdir(), 'pdb-test-default');

export function setPathsBase(newBase: string) {
  pathsBase = newBase;
}

/**
 * Mock env-paths to use temporary directories for all tests
 * This prevents tests from touching real user directories
 */
mock.module('env-paths', () => ({
  default: () => ({
    config: join(pathsBase, 'config'),
    data: join(pathsBase, 'data'),
    log: join(pathsBase, 'log'),
    temp: join(pathsBase, 'temp'),
    cache: join(pathsBase, 'cache'),
  }),
}));

/**
 * Mock @napi-rs/keyring with in-memory store for tests
 * This prevents tests from accessing the real system keyring
 */
export const keyringStore = new Map<string, string>();

mock.module('@napi-rs/keyring', () => {
  class Entry {
    private key: string;
    constructor(
      private readonly service: string,
      private readonly username: string
    ) {
      this.key = `${service}:${username}`;
    }

    setPassword(password: string) {
      keyringStore.set(this.key, password);
    }

    getPassword() {
      return keyringStore.get(this.key) ?? null;
    }

    deletePassword() {
      keyringStore.delete(this.key);
    }
  }

  class AsyncEntry extends Entry {}

  return { Entry, AsyncEntry };
});
