/**
 * WebDAV protocol errors - resource operations, methods, conflicts, locking.
 *
 * Covers HTTP errors from WebDAV operations (RFC 4918) including file/folder
 * operations, locking, permissions, and method handling.
 *
 * @example
 * if (!fileExists) {
 *   throw new NotFoundError('/path/to/file.txt');
 * }
 *
 * @see NotFoundError for missing resources (404)
 * @see ConflictError for operation conflicts (409)
 * @see LockedError for locked resources (423)
 * @see ForbiddenError for permission denied (403)
 * @see InsufficientStorageError for quota exceeded (507)
 */
import { AppError } from './AppError.js';

/**
 * Base class for WebDAV protocol errors.
 * All WebDAV errors set isPublic=true as they describe resource/protocol issues safe for clients.
 */
export class WebDAVError extends AppError {
  /**
   * Creates a new WebDAVError.
   *
   * @param message - Description of the WebDAV error
   * @param code - Error code for programmatic handling
   * @param statusCode - HTTP status code (4xx or 5xx)
   */
  constructor(message: string, code: string, statusCode: number) {
    super(message, code, statusCode, true);
    Object.setPrototypeOf(this, WebDAVError.prototype);
  }
}

/**
 * Error thrown when a requested resource is not found (404).
 *
 * Returned when trying to access, modify, or delete a file or folder that doesn't exist.
 *
 * @example
 * const file = await fs.stat(path).catch(() => null);
 * if (!file) {
 *   throw new NotFoundError(path);
 * }
 */
export class NotFoundError extends WebDAVError {
  /**
   * Creates a new NotFoundError.
   *
   * @param resource - Path or identifier of the missing resource
   */
  constructor(resource: string) {
    super(`${resource} not found.`, 'NOT_FOUND', 404);
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/**
 * Error thrown when operation creates a conflict (409).
 *
 * Examples: target exists when moving/copying, conflicting versions, concurrent modifications.
 *
 * @example
 * if (destExists) {
 *   throw new ConflictError('File already exists at destination');
 * }
 */
export class ConflictError extends WebDAVError {
  /**
   * Creates a new ConflictError.
   *
   * @param message - Description of the conflict
   * @param _reason - (deprecated, kept for compatibility)
   */
  constructor(message: string, _reason: string = 'Conflict') {
    super(message, 'CONFLICT', 409);
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
}

/**
 * Error thrown when resource is locked by another user/process (423).
 *
 * Prevents overwriting resources currently being edited.
 *
 * @example
 * if (resource.isLocked) {
 *   throw new LockedError('/shared/document.txt', resource.lockToken);
 * }
 */
export class LockedError extends WebDAVError {
  /**
   * Creates a new LockedError.
   *
   * @param resource - Path of the locked resource
   * @param lockToken - Optional token identifying the lock
   */
  constructor(resource: string, lockToken?: string) {
    const msg = lockToken
      ? `${resource} is locked with token ${lockToken}.`
      : `${resource} is locked.`;
    super(msg, 'LOCKED', 423);
    Object.setPrototypeOf(this, LockedError.prototype);
  }
}

/**
 * Error thrown when an HTTP method is not allowed on a resource (405).
 *
 * Examples: DELETE on a collection without recursive flag, PUT on a directory.
 *
 * @example
 * if (isDirectory && method === 'DELETE' && !recursive) {
 *   throw new MethodNotAllowedError('DELETE', path);
 * }
 */
export class MethodNotAllowedError extends WebDAVError {
  /**
   * Creates a new MethodNotAllowedError.
   *
   * @param method - The HTTP method (GET, POST, PUT, DELETE, etc.)
   * @param resource - The resource path the method was attempted on
   */
  constructor(method: string, resource: string) {
    super(`${method} not allowed on ${resource}.`, 'METHOD_NOT_ALLOWED', 405);
    Object.setPrototypeOf(this, MethodNotAllowedError.prototype);
  }
}

/**
 * Error thrown when an HTTP method is not supported by the server (501).
 *
 * Indicates the server doesn't implement this method (e.g., PROPFIND on non-WebDAV endpoint).
 *
 * @example
 * if (!supportsMethod(method)) {
 *   throw new MethodNotSupportedError('TRACE');
 * }
 */
export class MethodNotSupportedError extends WebDAVError {
  /**
   * Creates a new MethodNotSupportedError.
   *
   * @param method - The unsupported HTTP method
   */
  constructor(method: string) {
    super(`${method} is not supported by this server.`, 'METHOD_NOT_SUPPORTED', 501);
    Object.setPrototypeOf(this, MethodNotSupportedError.prototype);
  }
}

/**
 * Error thrown for malformed or invalid requests (400).
 *
 * Examples: invalid headers, malformed XML body, missing required parameters.
 *
 * @example
 * if (!request.headers['content-type']?.includes('xml')) {
 *   throw new BadRequestError('Request body must be valid XML');
 * }
 */
export class BadRequestError extends WebDAVError {
  /**
   * Creates a new BadRequestError.
   *
   * @param message - Description of what's wrong with the request
   */
  constructor(message: string) {
    super(message, 'BAD_REQUEST', 400);
    Object.setPrototypeOf(this, BadRequestError.prototype);
  }
}

/**
 * Error thrown when user lacks permission for the operation (403).
 *
 * Examples: trying to delete read-only file, accessing another user's folder.
 *
 * @example
 * if (!hasWritePermission(resource)) {
 *   throw new ForbiddenError('You do not have write permission for this resource');
 * }
 */
export class ForbiddenError extends WebDAVError {
  /**
   * Creates a new ForbiddenError.
   *
   * @param message - Description of the permission issue
   */
  constructor(message: string) {
    super(message, 'FORBIDDEN', 403);
    Object.setPrototypeOf(this, ForbiddenError.prototype);
  }
}

/**
 * Error thrown when server storage quota is exceeded (507).
 *
 * User has run out of storage space and cannot perform the requested write operation.
 *
 * @example
 * if (totalSize + fileSize > quotaLimit) {
 *   throw new InsufficientStorageError();
 * }
 */
export class InsufficientStorageError extends WebDAVError {
  /**
   * Creates a new InsufficientStorageError with standard message.
   */
  constructor() {
    super('Insufficient storage space available.', 'INSUFFICIENT_STORAGE', 507);
    Object.setPrototypeOf(this, InsufficientStorageError.prototype);
  }
}
