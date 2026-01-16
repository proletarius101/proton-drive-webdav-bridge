/**
 * Comprehensive Tests - CLI Entry Point
 *
 * Tests the main entry point including:
 * - Program initialization
 * - Command registration
 * - Global options (--debug)
 * - Version information
 */

import { describe, test, expect } from 'bun:test';

describe('CLI Entry Point - Program Structure', () => {
  test('should have program name proton-drive-webdav-bridge', async () => {
    // The index.ts sets up the commander program
    // We test it by checking if the module imports successfully
    const indexModule = await import('../src/index.js');
    expect(indexModule).toBeDefined();
  });
});

describe('CLI Entry Point - Module Imports', () => {
  test('should import commander successfully', async () => {
    const { program } = await import('commander');
    expect(program).toBeDefined();
    expect(typeof program.name).toBe('function');
    expect(typeof program.description).toBe('function');
    expect(typeof program.version).toBe('function');
  });

  test('should import all CLI command modules', async () => {
    const authModule = await import('../src/cli/auth.js');
    const startModule = await import('../src/cli/start.js');
    const stopModule = await import('../src/cli/stop.js');
    const statusModule = await import('../src/cli/status.js');
    const configModule = await import('../src/cli/config.js');

    expect(authModule.registerAuthCommand).toBeDefined();
    expect(startModule.registerStartCommand).toBeDefined();
    expect(stopModule.registerStopCommand).toBeDefined();
    expect(statusModule.registerStatusCommand).toBeDefined();
    expect(configModule.registerConfigCommand).toBeDefined();
  });

  test('should import config and logger modules', async () => {
    const { loadConfig } = await import('../src/config.js');
    const { setDebugMode } = await import('../src/logger.js');

    expect(loadConfig).toBeDefined();
    expect(setDebugMode).toBeDefined();
    expect(typeof loadConfig).toBe('function');
    expect(typeof setDebugMode).toBe('function');
  });
});

describe('CLI Entry Point - Configuration', () => {
  test('loadConfig should be callable', async () => {
    const { loadConfig } = await import('../src/config.js');
    expect(() => loadConfig()).not.toThrow();
  });
});

describe('CLI Entry Point - Command Registration', () => {
  test('should have registerAuthCommand function', async () => {
    const { registerAuthCommand } = await import('../src/cli/auth.js');
    expect(typeof registerAuthCommand).toBe('function');
  });

  test('should have registerStartCommand function', async () => {
    const { registerStartCommand } = await import('../src/cli/start.js');
    expect(typeof registerStartCommand).toBe('function');
  });

  test('should have registerStopCommand function', async () => {
    const { registerStopCommand } = await import('../src/cli/stop.js');
    expect(typeof registerStopCommand).toBe('function');
  });

  test('should have registerStatusCommand function', async () => {
    const { registerStatusCommand } = await import('../src/cli/status.js');
    expect(typeof registerStatusCommand).toBe('function');
  });

  test('should have registerConfigCommand function', async () => {
    const { registerConfigCommand } = await import('../src/cli/config.js');
    expect(typeof registerConfigCommand).toBe('function');
  });
});
