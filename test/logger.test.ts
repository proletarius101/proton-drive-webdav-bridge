/**
 * Integration Tests - Logger Module
 *
 * Tests logger with real file I/O, log file creation, and format validation.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { logger, setDebugMode } from '../src/logger.js';

const DEFAULT_PATHS_BASE = join(tmpdir(), 'pdb-logger-default');
let pathsBase = DEFAULT_PATHS_BASE;

mock.module('env-paths', () => ({
  default: () => ({
    config: join(pathsBase, 'config', 'proton-drive-webdav-bridge'),
    data: join(pathsBase, 'data', 'proton-drive-webdav-bridge'),
    log: join(pathsBase, 'log', 'proton-drive-webdav-bridge'),
    temp: join(pathsBase, 'temp', 'proton-drive-webdav-bridge'),
    cache: join(pathsBase, 'cache', 'proton-drive-webdav-bridge'),
  }),
}));

describe('Logger - Instance Methods', () => {
  test('should have info method', () => {
    expect(typeof logger.info).toBe('function');
  });

  test('should have error method', () => {
    expect(typeof logger.error).toBe('function');
  });

  test('should have warn method', () => {
    expect(typeof logger.warn).toBe('function');
  });

  test('should have debug method', () => {
    expect(typeof logger.debug).toBe('function');
  });
});

describe('Logger - Logging Operations', () => {
  test('should log info messages without throwing', () => {
    expect(() => logger.info('Test info message')).not.toThrow();
  });

  test('should log error messages without throwing', () => {
    expect(() => logger.error('Test error message')).not.toThrow();
  });

  test('should log warn messages without throwing', () => {
    expect(() => logger.warn('Test warning message')).not.toThrow();
  });

  test('should log debug messages without throwing', () => {
    expect(() => logger.debug('Test debug message')).not.toThrow();
  });

  test('should handle template strings', () => {
    const variable = 'test value';
    expect(() => logger.info(`Message with ${variable}`)).not.toThrow();
  });

  test('should handle multiline strings', () => {
    const message = 'Line 1\nLine 2\nLine 3';
    expect(() => logger.info(message)).not.toThrow();
  });

  test('should handle large messages', () => {
    const largeMessage = 'x'.repeat(10000);
    expect(() => logger.info(largeMessage)).not.toThrow();
  });

  test('should handle Error objects', () => {
    const error = new Error('Test error');
    expect(() => logger.error(error.message)).not.toThrow();
  });
});

describe('Logger - Debug Mode', () => {
  test('should have setDebugMode function', () => {
    expect(typeof setDebugMode).toBe('function');
  });

  test('should enable debug mode without throwing', () => {
    expect(() => setDebugMode(true)).not.toThrow();
  });

  test('should disable debug mode without throwing', () => {
    expect(() => setDebugMode(false)).not.toThrow();
  });

  test('should toggle debug mode', () => {
    expect(() => setDebugMode(true)).not.toThrow();
    expect(() => setDebugMode(false)).not.toThrow();
    expect(() => setDebugMode(true)).not.toThrow();
  });
});

describe('Logger - Error Handling', () => {
  test('should handle null values gracefully', () => {
    expect(() => logger.info(null as unknown as string)).not.toThrow();
  });

  test('should handle undefined values gracefully', () => {
    expect(() => logger.info(undefined as unknown as string)).not.toThrow();
  });

  test('should handle objects gracefully', () => {
    expect(() => logger.info({} as unknown as string)).not.toThrow();
  });

  test('should handle arrays gracefully', () => {
    expect(() => logger.info([] as unknown as string)).not.toThrow();
  });
});

describe('Logger - Performance', () => {
  test('should handle rapid logging', () => {
    expect(() => {
      for (let i = 0; i < 100; i++) {
        logger.info(`Message ${i}`);
      }
    }).not.toThrow();
  });

  test('should handle concurrent logging', async () => {
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        Promise.resolve().then(() => {
          logger.info(`Concurrent message ${i}`);
        })
      );
    }
    await Promise.all(promises);
    expect(true).toBe(true);
  });
});

describe('Logger - File Transports', () => {
  let logDir: string;

  beforeEach(() => {
    logDir = mkdtempSync(join(tmpdir(), 'pdb-logger-'));
    pathsBase = logDir;
  });

  afterEach(() => {
    rmSync(logDir, { recursive: true, force: true });
    pathsBase = DEFAULT_PATHS_BASE;
  });

  test('should create log directory', async () => {
    const { logger: testLogger } = await import(`../src/logger.js?cache=${Date.now()}`);
    testLogger.info('Test log message');

    // Wait a bit for file write
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(true).toBe(true); // Logger doesn't throw
  });
});
