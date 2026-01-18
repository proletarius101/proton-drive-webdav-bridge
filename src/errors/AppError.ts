/**
 * Base application error class.
 *
 * All application-specific errors inherit from this class to provide
 * consistent error handling, logging, and HTTP response generation throughout
 * the application. This serves as the foundation for structured error handling.
 *
 * @example
 * // Basic usage
 * throw new AppError('Operation failed', 'OP_FAILED', 500, false);
 *
 * @example
 * // Wrapping an original error
 * try {
 *   await someAsyncOperation();
 * } catch (error) {
 *   throw new AppError(
 *     'Failed to sync files',
 *     'SYNC_FAILED',
 *     500,
 *     false,
 *     error
 *   );
 * }
 *
 * @example
 * // Public error message (safe for client)
 * throw new AppError(
 *   'Invalid email address',
 *   'INVALID_EMAIL',
 *   400,
 *   true // isPublic=true means client sees this message
 * );
 *
 * @see ValidationError for input validation errors
 * @see AuthenticationError for authentication failures
 * @see WebDAVError for WebDAV protocol errors
 * @see ApiError for external API failures
 */
export class AppError extends Error {
  /**
   * Creates a new AppError instance.
   *
   * @param message - User-facing error message (shown when isPublic=true)
   * @param code - Unique error code for programmatic handling
   * @param statusCode - HTTP status code (default: 500)
   * @param isPublic - Whether message is safe for clients (default: false)
   * @param originalError - Original error being wrapped (optional)
   */
  constructor(
    message: string,
    /** Unique error code for programmatic handling (e.g., 'AUTH_FAILED', 'VALIDATION_ERROR') */
    readonly code: string,
    /** HTTP status code to return to client (e.g., 400, 401, 404, 500) */
    readonly statusCode: number = 500,
    /** Whether error message is safe to expose to clients */
    readonly isPublic: boolean = false,
    /** Original error object if this error wraps another error */
    readonly originalError?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, AppError.prototype);

    // Capture stack trace (only the last 10 frames for readability)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert error to JSON-serializable format for logging and responses.
   * Includes all public error information without exposing stack traces or internal details.
   *
   * @returns Object with name, message, code, statusCode, and isPublic flag
   *
   * @example
   * const error = new AppError('Op failed', 'OP_FAILED', 500);
   * console.log(error.toJSON());
   * // { name: 'AppError', message: 'Op failed', code: 'OP_FAILED', statusCode: 500, isPublic: false }
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      isPublic: this.isPublic,
    };
  }

  /**
   * Get safe error message for HTTP responses.
   * Returns the actual message if isPublic=true, otherwise returns generic message.
   * Always use this method when sending errors to clients.
   *
   * @returns Safe error message suitable for client display
   *
   * @example
   * const error = new AppError('Malformed request', 'BAD_REQUEST', 400, true);
   * console.log(error.getPublicMessage()); // 'Malformed request'
   *
   * @example
   * const error = new AppError('Database connection failed', 'DB_ERROR', 500);
   * console.log(error.getPublicMessage()); // 'Internal Server Error'
   */
  getPublicMessage(): string {
    return this.isPublic ? this.message : 'Internal Server Error';
  }
}
