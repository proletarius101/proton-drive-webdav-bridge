/**
 * Authentication errors - login, session, token issues
 */
import { AppError } from './AppError.js';

export class AuthenticationError extends AppError {
  constructor(message: string) {
    super(message, 'AUTHENTICATION_ERROR', 401, true);
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}

export class NotAuthenticatedError extends AuthenticationError {
  readonly code = 'NOT_AUTHENTICATED' as const;

  constructor() {
    super('Not authenticated. Please login first.');
    Object.setPrototypeOf(this, NotAuthenticatedError.prototype);
  }
}

export class InvalidCredentialsError extends AuthenticationError {
  readonly code = 'INVALID_CREDENTIALS' as const;

  constructor(reason: string = 'Invalid username or password') {
    super(reason);
    Object.setPrototypeOf(this, InvalidCredentialsError.prototype);
  }
}

export class TokenExpiredError extends AuthenticationError {
  readonly code = 'TOKEN_EXPIRED' as const;

  constructor() {
    super('Authentication token has expired. Please login again.');
    Object.setPrototypeOf(this, TokenExpiredError.prototype);
  }
}

export class TwoFactorRequiredError extends AuthenticationError {
  readonly code = 'TWO_FACTOR_REQUIRED' as const;

  constructor(readonly method: string) {
    super(`Two-factor authentication required (${method}).`);
    Object.setPrototypeOf(this, TwoFactorRequiredError.prototype);
  }
}

export class MailboxPasswordRequiredError extends AuthenticationError {
  readonly code = 'MAILBOX_PASSWORD_REQUIRED' as const;

  constructor() {
    super('Mailbox password required for this operation.');
    Object.setPrototypeOf(this, MailboxPasswordRequiredError.prototype);
  }
}
