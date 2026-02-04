/**
 * Authentication error - user login, session, and token issues.
 *
 * Returned when authentication fails in any way (missing credentials, expired tokens,
 * invalid credentials, etc.). Returns HTTP 401 Unauthorized.
 *
 * @example
 * if (!token) {
 *   throw new NotAuthenticatedError();
 * }
 *
 * @see NotAuthenticatedError when no credentials provided
 * @see InvalidCredentialsError when credentials don't match
 * @see TokenExpiredError when session expired
 * @see TwoFactorRequiredError when 2FA needed
 * @see MailboxPasswordRequiredError when special auth needed
 */
import { AppError } from './AppError.js';

/**
 * Base class for authentication errors.
 * Automatically sets status code to 401 (Unauthorized) and isPublic to true.
 */
export class AuthenticationError extends AppError {
  /**
   * Creates a new AuthenticationError.
   *
   * @param message - User-facing error message describing the auth failure
   */
  constructor(message: string) {
    super(message, 'AUTHENTICATION_ERROR', 401, true);
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}

/**
 * Error thrown when request has no credentials (no auth header, missing token, etc.).
 *
 * Indicates that the request needs authentication but none was provided.
 *
 * @example
 * if (!authHeader) {
 *   throw new NotAuthenticatedError();
 * }
 */
export class NotAuthenticatedError extends AuthenticationError {
  override readonly code = 'NOT_AUTHENTICATED' as const;

  /**
   * Creates a new NotAuthenticatedError with standard message.
   */
  constructor() {
    super('Not authenticated. Please login first.');
    Object.setPrototypeOf(this, NotAuthenticatedError.prototype);
  }
}

/**
 * Error thrown when provided credentials (username/password, API key, etc.) don't match.
 *
 * Indicates authentication was attempted but failed verification.
 *
 * @example
 * const user = await db.users.findByEmail(email);
 * if (!user || !await verifyPassword(password, user.hash)) {
 *   throw new InvalidCredentialsError();
 * }
 */
export class InvalidCredentialsError extends AuthenticationError {
  override readonly code = 'INVALID_CREDENTIALS' as const;

  /**
   * Creates a new InvalidCredentialsError.
   *
   * @param reason - Why credentials were invalid (default: generic message)
   */
  constructor(reason: string = 'Invalid username or password') {
    super(reason);
    Object.setPrototypeOf(this, InvalidCredentialsError.prototype);
  }
}

/**
 * Error thrown when authentication token has expired and needs refresh/re-login.
 *
 * Indicates user must authenticate again to continue.
 *
 * @example
 * if (token.expiresAt < Date.now()) {
 *   throw new TokenExpiredError();
 * }
 */
export class TokenExpiredError extends AuthenticationError {
  override readonly code = 'TOKEN_EXPIRED' as const;

  /**
   * Creates a new TokenExpiredError with standard message.
   */
  constructor() {
    super('Authentication token has expired. Please login again.');
    Object.setPrototypeOf(this, TokenExpiredError.prototype);
  }
}

/**
 * Error thrown when two-factor authentication is required to proceed.
 *
 * Indicates user needs to provide second authentication factor (TOTP, SMS, etc.).
 *
 * @example
 * if (user.twoFactorEnabled && !verified2FA) {
 *   throw new TwoFactorRequiredError('TOTP');
 * }
 */
export class TwoFactorRequiredError extends AuthenticationError {
  override readonly code = 'TWO_FACTOR_REQUIRED' as const;

  /**
   * Creates a new TwoFactorRequiredError.
   *
   * @param method - The 2FA method required (e.g., 'TOTP', 'SMS', 'EMAIL')
   *
   * @example
   * throw new TwoFactorRequiredError('TOTP');
   */
  constructor(readonly method: string) {
    super(`Two-factor authentication required (${method}).`);
    Object.setPrototypeOf(this, TwoFactorRequiredError.prototype);
  }
}

/**
 * Error thrown when mailbox password is required for the operation.
 *
 * Some operations (e.g., accessing sensitive data) require the user to provide
 * their mailbox password in addition to account authentication.
 *
 * @example
 * if (operation.requiresMailboxPassword && !mailboxPasswordVerified) {
 *   throw new MailboxPasswordRequiredError();
 * }
 */
export class MailboxPasswordRequiredError extends AuthenticationError {
  override readonly code = 'MAILBOX_PASSWORD_REQUIRED' as const;

  /**
   * Creates a new MailboxPasswordRequiredError with standard message.
   */
  constructor() {
    super('Mailbox password required for this operation.');
    Object.setPrototypeOf(this, MailboxPasswordRequiredError.prototype);
  }
}
