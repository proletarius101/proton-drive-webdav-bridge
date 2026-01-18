/**
 * WebDAV protocol errors - resource, method, conflict issues
 */
import { AppError } from './AppError.js';

export class WebDAVError extends AppError {
  constructor(message: string, code: string, statusCode: number) {
    super(message, code, statusCode, true);
    Object.setPrototypeOf(this, WebDAVError.prototype);
  }
}

export class NotFoundError extends WebDAVError {
  constructor(resource: string) {
    super(`${resource} not found.`, 'NOT_FOUND', 404);
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

export class ConflictError extends WebDAVError {
  constructor(message: string, _reason: string = 'Conflict') {
    super(message, 'CONFLICT', 409);
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
}

export class LockedError extends WebDAVError {
  constructor(resource: string, lockToken?: string) {
    const msg = lockToken
      ? `${resource} is locked with token ${lockToken}.`
      : `${resource} is locked.`;
    super(msg, 'LOCKED', 423);
    Object.setPrototypeOf(this, LockedError.prototype);
  }
}

export class MethodNotAllowedError extends WebDAVError {
  constructor(method: string, resource: string) {
    super(`${method} not allowed on ${resource}.`, 'METHOD_NOT_ALLOWED', 405);
    Object.setPrototypeOf(this, MethodNotAllowedError.prototype);
  }
}

export class MethodNotSupportedError extends WebDAVError {
  constructor(method: string) {
    super(`${method} is not supported by this server.`, 'METHOD_NOT_SUPPORTED', 501);
    Object.setPrototypeOf(this, MethodNotSupportedError.prototype);
  }
}

export class BadRequestError extends WebDAVError {
  constructor(message: string) {
    super(message, 'BAD_REQUEST', 400);
    Object.setPrototypeOf(this, BadRequestError.prototype);
  }
}

export class ForbiddenError extends WebDAVError {
  constructor(message: string) {
    super(message, 'FORBIDDEN', 403);
    Object.setPrototypeOf(this, ForbiddenError.prototype);
  }
}

export class InsufficientStorageError extends WebDAVError {
  constructor() {
    super('Insufficient storage space available.', 'INSUFFICIENT_STORAGE', 507);
    Object.setPrototypeOf(this, InsufficientStorageError.prototype);
  }
}
