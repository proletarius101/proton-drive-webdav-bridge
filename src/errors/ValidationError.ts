/**
 * Validation errors - triggered by invalid user input
 */
import { AppError } from './AppError.js';

export class ValidationError extends AppError {
  constructor(message: string, readonly details?: Record<string, string>) {
    super(message, 'VALIDATION_ERROR', 400, true);
    Object.setPrototypeOf(this, ValidationError.prototype);
  }

  toJSON() {
    return {
      ...super.toJSON(),
      details: this.details,
    };
  }
}

export class InvalidPathError extends ValidationError {
  readonly code = 'INVALID_PATH' as const;

  constructor(path: string, reason: string = 'Invalid path') {
    super(`${reason}: ${path}`, { path, reason });
    Object.setPrototypeOf(this, InvalidPathError.prototype);
  }
}

export class InvalidConfigError extends ValidationError {
  readonly code = 'INVALID_CONFIG' as const;

  constructor(field: string, reason: string) {
    super(`Invalid configuration for "${field}": ${reason}`, { field, reason });
    Object.setPrototypeOf(this, InvalidConfigError.prototype);
  }
}

export class InvalidRequestError extends ValidationError {
  readonly code = 'INVALID_REQUEST' as const;

  constructor(message: string, details?: Record<string, string>) {
    super(message, details);
    Object.setPrototypeOf(this, InvalidRequestError.prototype);
  }
}
