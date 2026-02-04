/**
 * Validation error - triggered by invalid user input.
 *
 * Used when input validation fails (e.g., invalid request parameters, malformed paths,
 * invalid email addresses). Returns HTTP 400 Bad Request with client-visible message.
 *
 * @example
 * throw new ValidationError('Missing required field: email');
 *
 * @see InvalidPathError for path-specific validation
 * @see InvalidConfigError for configuration validation
 * @see InvalidRequestError for request body validation
 */
import { AppError } from './AppError.js';

/**
 * Base class for validation errors.
 * Automatically sets status code to 400 (Bad Request) and isPublic to true
 * since validation errors are meant for clients to understand what's wrong.
 */
export class ValidationError extends AppError {
  /**
   * Creates a new ValidationError.
   *
   * @param message - Description of what validation failed
   * @param details - Optional key-value pairs with detailed validation errors
   *
   * @example
   * new ValidationError('Form validation failed', {
   *   email: 'Invalid email format',
   *   password: 'Password too short'
   * })
   */
  constructor(
    message: string,
    readonly details?: Record<string, string>
  ) {
    super(message, 'VALIDATION_ERROR', 400, true);
    Object.setPrototypeOf(this, ValidationError.prototype);
  }

  /**
   * Serialize error to JSON, including validation details.
   * Useful for sending detailed error responses to clients.
   */
  override toJSON() {
    return {
      ...super.toJSON(),
      details: this.details,
    };
  }
}

/**
 * Error for invalid file system paths.
 *
 * Triggered when a path is unsafe (contains traversal attempts, invalid characters,
 * or otherwise violates security constraints).
 *
 * @example
 * throw new InvalidPathError('../../../etc/passwd', 'Path traversal detected');
 *
 * @example
 * throw new InvalidPathError('file\0name.txt', 'Contains null bytes');
 */
export class InvalidPathError extends ValidationError {
  override readonly code = 'INVALID_PATH' as const;

  /**
   * Creates a new InvalidPathError.
   *
   * @param path - The invalid path
   * @param reason - Why the path is invalid (default: 'Invalid path')
   */
  constructor(path: string, reason: string = 'Invalid path') {
    super(`${reason}: ${path}`, { path, reason });
    Object.setPrototypeOf(this, InvalidPathError.prototype);
  }
}

/**
 * Error for invalid configuration values.
 *
 * Triggered when configuration parameters don't meet requirements
 * (e.g., invalid port number, malformed host, missing required field).
 *
 * @example
 * throw new InvalidConfigError('port', 'Must be between 1 and 65535');
 *
 * @example
 * throw new InvalidConfigError('host', 'Invalid IP address format');
 */
export class InvalidConfigError extends ValidationError {
  override readonly code = 'INVALID_CONFIG' as const;

  /**
   * Creates a new InvalidConfigError.
   *
   * @param field - Name of the configuration field that failed validation
   * @param reason - Why the value is invalid
   */
  constructor(field: string, reason: string) {
    super(`Invalid configuration for "${field}": ${reason}`, { field, reason });
    Object.setPrototypeOf(this, InvalidConfigError.prototype);
  }
}

/**
 * Error for invalid HTTP request payloads.
 *
 * Triggered when request body or parameters don't match expected schema
 * or fail validation rules.
 *
 * @example
 * throw new InvalidRequestError('Request body must be JSON', {
 *   contentType: 'Expected application/json'
 * });
 *
 * @example
 * throw new InvalidRequestError('Missing required fields', {
 *   email: 'Email is required',
 *   password: 'Password is required'
 * });
 */
export class InvalidRequestError extends ValidationError {
  override readonly code = 'INVALID_REQUEST' as const;

  /**
   * Creates a new InvalidRequestError.
   *
   * @param message - General description of what's wrong with the request
   * @param details - Optional field-specific validation errors
   */
  constructor(message: string, details?: Record<string, string>) {
    super(message, details);
    Object.setPrototypeOf(this, InvalidRequestError.prototype);
  }
}
