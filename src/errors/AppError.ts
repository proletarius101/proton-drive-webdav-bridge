/**
 * Base application error with structured information
 * All domain errors should extend this class for consistency
 */
export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number = 500,
    readonly isPublic: boolean = false,
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
   * Convert error to JSON-serializable format for logging/responses
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
   * Get safe error message for HTTP responses (hides internal details)
   */
  getPublicMessage(): string {
    return this.isPublic ? this.message : 'Internal Server Error';
  }
}
