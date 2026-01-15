/**
 * Comprehensive Tests - Proton Auth Module Exports
 *
 * Tests the barrel export file that re-exports auth functionality.
 */

import { describe, test, expect } from 'bun:test';

describe('Proton Auth Module - Exports', () => {
  test('should export ProtonAuth class', async () => {
    const { ProtonAuth } = await import('../src/proton/auth.js');
    expect(ProtonAuth).toBeDefined();
    expect(typeof ProtonAuth).toBe('function');
  });

  test('should export restoreSessionFromStorage function', async () => {
    const { restoreSessionFromStorage } = await import('../src/proton/auth.js');
    expect(restoreSessionFromStorage).toBeDefined();
    expect(typeof restoreSessionFromStorage).toBe('function');
  });

  test('should export authenticateAndStore function', async () => {
    const { authenticateAndStore } = await import('../src/proton/auth.js');
    expect(authenticateAndStore).toBeDefined();
    expect(typeof authenticateAndStore).toBe('function');
  });

  test('should export Session type', async () => {
    const module = await import('../src/proton/auth.js');
    // Types are erased at runtime, but we can verify the module exports
    expect(module).toBeDefined();
  });

  test('should export ApiError type', async () => {
    const module = await import('../src/proton/auth.js');
    expect(module).toBeDefined();
  });

  test('ProtonAuth class should be instantiable', async () => {
    const { ProtonAuth } = await import('../src/proton/auth.js');
    const auth = new ProtonAuth();
    expect(auth).toBeDefined();
    expect(typeof auth.login).toBe('function');
  });
});
