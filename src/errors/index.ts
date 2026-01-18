/**
 * Central export for all error types
 * Provides unified error hierarchy for the application
 */
export { AppError } from './AppError.js';

export {
  ValidationError,
  InvalidPathError,
  InvalidConfigError,
  InvalidRequestError,
} from './ValidationError.js';

export {
  AuthenticationError,
  NotAuthenticatedError,
  InvalidCredentialsError,
  TokenExpiredError,
  TwoFactorRequiredError,
  MailboxPasswordRequiredError,
} from './AuthenticationError.js';

export {
  WebDAVError,
  NotFoundError,
  ConflictError,
  LockedError,
  MethodNotAllowedError,
  MethodNotSupportedError,
  BadRequestError,
  ForbiddenError,
  InsufficientStorageError,
} from './WebDAVError.js';

export { ApiError, NetworkError, TimeoutError, ProtonApiError } from './ApiError.js';
