/**
 * Tests for validation utilities
 */
import { describe, test, expect } from 'bun:test';
import {
  normalizePath,
  validatePathSafety,
  validateFilename,
  combinePaths,
  getParentPath,
  getFilename,
  parseBasicAuth,
  validateEmail,
  validatePort,
  validateHost,
} from '../src/validation/index.js';

describe('Path validation - Normalization', () => {
  test('normalizePath ensures leading slash', () => {
    expect(normalizePath('file.txt')).toBe('/file.txt');
    expect(normalizePath('/file.txt')).toBe('/file.txt');
  });

  test('normalizePath removes duplicate slashes', () => {
    expect(normalizePath('//path//to///file')).toBe('/path/to/file');
  });

  test('normalizePath handles root', () => {
    expect(normalizePath('')).toBe('/');
    expect(normalizePath('/')).toBe('/');
  });
});

describe('Path validation - Safety checks', () => {
  test('validatePathSafety accepts valid paths', () => {
    const result = validatePathSafety('/home/user/file.txt');
    expect(result.ok).toBe(true);
  });

  test('validatePathSafety rejects path traversal', () => {
    const result = validatePathSafety('/path/../etc/passwd');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_PATH');
  });

  test('validatePathSafety rejects non-strings', () => {
    const result = validatePathSafety(null as unknown as string);
    expect(result.ok).toBe(false);
  });
});

describe('Path validation - Filename validation', () => {
  test('validateFilename accepts valid filenames', () => {
    const result = validateFilename('document.txt');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('document.txt');
  });

  test('validateFilename rejects path separators', () => {
    const result = validateFilename('path/to/file.txt');
    expect(result.ok).toBe(false);
  });

  test('validateFilename rejects traversal patterns', () => {
    const result = validateFilename('..');
    expect(result.ok).toBe(false);
  });
});

describe('Path validation - Path operations', () => {
  test('combinePaths joins valid paths', () => {
    const result = combinePaths('/home', 'user/file.txt');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('/home/user/file.txt');
  });

  test('combinePaths rejects traversal in parts', () => {
    const result = combinePaths('/home', '../etc');
    expect(result.ok).toBe(false);
  });

  test('getParentPath extracts parent directory', () => {
    expect(getParentPath('/home/user/file.txt')).toBe('/home/user');
    expect(getParentPath('/file.txt')).toBe('/');
    expect(getParentPath('/')).toBe('/');
  });

  test('getFilename extracts filename from path', () => {
    expect(getFilename('/home/user/file.txt')).toBe('file.txt');
    expect(getFilename('/file.txt')).toBe('file.txt');
    expect(getFilename('/')).toBe('/');
  });
});

describe('Auth validation - Basic auth parsing', () => {
  test('parseBasicAuth parses valid credentials', () => {
    const credentials = Buffer.from('user:password').toString('base64');
    const result = parseBasicAuth(`Basic ${credentials}`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.username).toBe('user');
      expect(result.value.password).toBe('password');
    }
  });

  test('parseBasicAuth rejects invalid format', () => {
    const result = parseBasicAuth('Bearer token123');
    expect(result.ok).toBe(false);
  });

  test('parseBasicAuth rejects malformed base64', () => {
    const result = parseBasicAuth('Basic not-base64!@#$');
    expect(result.ok).toBe(false);
  });
});

describe('Auth validation - Email validation', () => {
  test('validateEmail accepts valid emails', () => {
    const result = validateEmail('user@example.com');
    expect(result.ok).toBe(true);
  });

  test('validateEmail rejects invalid emails', () => {
    const result = validateEmail('invalid-email');
    expect(result.ok).toBe(false);
  });
});

describe('Config validation - Port validation', () => {
  test('validatePort accepts valid port numbers', () => {
    expect(validatePort(8080).ok).toBe(true);
    expect(validatePort('3000').ok).toBe(true);
  });

  test('validatePort rejects invalid port numbers', () => {
    expect(validatePort(0).ok).toBe(false);
    expect(validatePort(99999).ok).toBe(false);
    expect(validatePort(-1).ok).toBe(false);
  });
});

describe('Config validation - Host validation', () => {
  test('validateHost accepts valid hosts', () => {
    expect(validateHost('localhost').ok).toBe(true);
    expect(validateHost('127.0.0.1').ok).toBe(true);
    expect(validateHost('example.com').ok).toBe(true);
  });

  test('validateHost rejects invalid hosts', () => {
    expect(validateHost('').ok).toBe(false);
    expect(validateHost('invalid@host').ok).toBe(false);
  });
});
