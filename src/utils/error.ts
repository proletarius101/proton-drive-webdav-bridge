/**
 * Error utilities and helpers
 * Provides common patterns for error handling
 */
import { AppError, ApiError, ProtonApiError } from '../errors/index.js';

/**
 * Extract error message from unknown error
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as Record<string, unknown>).message);
  }
  return String(error);
}

/**
 * Convert unknown error to AppError
 * Useful in catch blocks to ensure typed error handling
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  const message = getErrorMessage(error);

  // If it looks like an API error, wrap it
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if ('status' in obj || 'statusCode' in obj) {
      const status = (obj.status ?? obj.statusCode) as number;
      return new ApiError(message, status);
    }
    if ('code' in obj) {
      return new ProtonApiError(message, obj.code as number, obj);
    }
  }

  // Default to generic AppError
  return new AppError(message, 'UNKNOWN_ERROR', 500, false, error);
}

/**
 * Safe JSON stringify for logging (prevents circular refs)
 */
export function safeStringify(obj: unknown, maxDepth: number = 3): string {
  const seen = new WeakSet();

  const replacer =
    (depth: number) =>
    (_key: string, value: unknown): unknown => {
      if (depth > maxDepth) return '[max depth reached]';

      if (typeof value === 'object' && value !== null) {
        if (seen.has(value as object)) {
          return '[Circular]';
        }
        seen.add(value as object);
      }

      // Truncate long strings
      if (typeof value === 'string' && value.length > 200) {
        return `${value.slice(0, 197)}...`;
      }

      return value;
    };

  try {
    return JSON.stringify(
      obj,
      replacer(0) as (this: unknown, key: string, value: unknown) => unknown
    );
  } catch {
    return String(obj);
  }
}
