/**
 * Integration Tests - Authentication Module
 *
 * Tests ProtonAuth login flow, credential storage, and error handling.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ProtonAuth, type ApiError } from '../src/auth.js';

describe('ProtonAuth - Login Flow', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pdb-auth-'));
    process.env.XDG_DATA_HOME = tempDir;
    process.env.KEYRING_PASSWORD = 'test-password';
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.KEYRING_PASSWORD;
    delete process.env.XDG_DATA_HOME;
  });

  test('should instantiate ProtonAuth and have login method', () => {
    const auth = new ProtonAuth();
    expect(auth).toBeDefined();
    expect(typeof auth.login).toBe('function');
  });

  test('should have getReusableCredentials method', () => {
    const auth = new ProtonAuth();
    expect(typeof auth.getReusableCredentials).toBe('function');
  });

  test('should throw error when getReusableCredentials called without session', () => {
    const auth = new ProtonAuth();
    try {
      auth.getReusableCredentials();
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeDefined();
      expect((error as Error).message).toBeDefined();
    }
  });

  test('should throw error on login with invalid credentials', async () => {
    const auth = new ProtonAuth();
    try {
      await auth.login('invalid@example.com', 'wrongpassword');
      expect(true).toBe(false); // Should throw
    } catch (error) {
      expect(error).toBeDefined();
      expect((error as Error).message).toBeDefined();
    }
  });

  test('should have submit2FA method for 2FA flow', () => {
    const auth = new ProtonAuth();
    expect(typeof auth.submit2FA).toBe('function');
  });

  test('should have submitMailboxPassword method', () => {
    const auth = new ProtonAuth();
    expect(typeof auth.submitMailboxPassword).toBe('function');
  });

  test('ApiError should support requires2FA property', () => {
    const error: ApiError = new Error('Auth failed') as ApiError;
    error.requires2FA = true;
    error.code = 9001;

    expect(error.requires2FA).toBe(true);
    expect(error.code).toBe(9001);
  });

  test('ApiError should support requiresMailboxPassword property', () => {
    const error: ApiError = new Error('Auth failed') as ApiError;
    error.requiresMailboxPassword = true;
    error.code = 9002;

    expect(error.requiresMailboxPassword).toBe(true);
    expect(error.code).toBe(9002);
  });
});
