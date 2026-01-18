/**
 * Tests for error types and error handling
 */
import { describe, test, expect } from 'bun:test';
import {
  AppError,
  ValidationError,
  InvalidPathError,
  NotAuthenticatedError,
  InvalidCredentialsError,
  WebDAVError,
  NotFoundError,
  LockedError,
  NetworkError,
} from '../src/errors/index.js';

describe('Error Types - AppError base class', () => {
  test('creates AppError with correct properties', () => {
    const error = new AppError('Test error', 'TEST_CODE', 400, true);
    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error.statusCode).toBe(400);
    expect(error.isPublic).toBe(true);
  });

  test('AppError toJSON includes all properties', () => {
    const error = new AppError('Test', 'CODE', 500, false);
    const json = error.toJSON();
    expect(json.code).toBe('CODE');
    expect(json.statusCode).toBe(500);
    expect(json.isPublic).toBe(false);
  });

  test('AppError.getPublicMessage hides internal errors', () => {
    const publicError = new AppError('Public message', 'CODE', 400, true);
    const privateError = new AppError('Internal details', 'CODE', 500, false);

    expect(publicError.getPublicMessage()).toBe('Public message');
    expect(privateError.getPublicMessage()).toBe('Internal Server Error');
  });
});

describe('Error Types - ValidationError hierarchy', () => {
  test('ValidationError is public by default', () => {
    const error = new ValidationError('Invalid input');
    expect(error.statusCode).toBe(400);
    expect(error.isPublic).toBe(true);
  });

  test('InvalidPathError includes path details', () => {
    const error = new InvalidPathError('/path/../traversal', 'Path traversal not allowed');
    expect(error.details).toEqual({
      path: '/path/../traversal',
      reason: 'Path traversal not allowed',
    });
    expect(error.code).toBe('INVALID_PATH');
  });
});

describe('Error Types - AuthenticationError hierarchy', () => {
  test('NotAuthenticatedError has 401 status', () => {
    const error = new NotAuthenticatedError();
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('NOT_AUTHENTICATED');
  });

  test('InvalidCredentialsError is public', () => {
    const error = new InvalidCredentialsError('Wrong password');
    expect(error.isPublic).toBe(true);
    expect(error.message).toContain('Wrong password');
  });
});

describe('Error Types - WebDAVError hierarchy', () => {
  test('NotFoundError has 404 status', () => {
    const error = new NotFoundError('/missing/file.txt');
    expect(error.statusCode).toBe(404);
    expect(error.message).toContain('not found');
  });

  test('LockedError has 423 status', () => {
    const error = new LockedError('/file.txt', 'lock-token-123');
    expect(error.statusCode).toBe(423);
    expect(error.message).toContain('locked');
  });
});

describe('Error Types - ApiError hierarchy', () => {
  test('NetworkError has 503 status', () => {
    const error = new NetworkError('Connection refused');
    expect(error.statusCode).toBe(503);
    expect(error.code).toBe('NETWORK_ERROR');
  });

  test('error instanceof checks work correctly', () => {
    const error = new NotFoundError('/file');
    expect(error instanceof WebDAVError).toBe(true);
    expect(error instanceof AppError).toBe(true);
  });
});
