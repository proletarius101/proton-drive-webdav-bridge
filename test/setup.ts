/**
 * Global test setup
 *
 * Loaded via setupFiles in vitest.config.ts before any test files run.
 * Provides global mocks for keyring access.
 *
 * See: https://main.vitest.dev/api/vi#vi-mock
 */

import { vi } from 'vitest';

/**
 * Mock @napi-rs/keyring with in-memory store for tests
 * This prevents tests from accessing the real system keyring
 */
export const keyringStore = new Map<string, string>();

vi.mock('@napi-rs/keyring', () => {
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
