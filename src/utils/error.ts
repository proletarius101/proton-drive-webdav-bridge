/**
 * Error utilities and helpers.
 *
 * Provides common patterns for error handling, including message extraction,
 * error type conversion, and safe serialization for logging.
 */
import { AppError, ApiError, ProtonApiError } from '../errors/index.js';

/**
 * Extract error message from an unknown error value.
 *
 * Safely extracts message from various error types: Error, string, objects with message property, etc.
 * Falls back to String() conversion for other types.
 *
 * @param error - The error to extract message from (can be any type)
 * @returns The extracted error message
 *
 * @example
 * getErrorMessage(new Error('Something failed')); // 'Something failed'
 * getErrorMessage('Simple string error'); // 'Simple string error'
 * getErrorMessage({ message: 'Object error' }); // 'Object error'
 * getErrorMessage(404); // '404'
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
 * Convert any error value to an AppError instance.
 *
 * Provides typed error handling in catch blocks. If the error is already an AppError,
 * returns it as-is. Otherwise, converts it based on characteristics (status code, API code, etc).
 *
 * @param error - The error to convert (can be any type)
 * @returns An AppError instance wrapping the original error
 *
 * @example
 * try {
 *   await someAsyncOp();
 * } catch (error) {
 *   const appError = toAppError(error);
 *   logger.error(appError.code, appError.message);
 *   res.status(appError.statusCode).json({ message: appError.getPublicMessage() });
 * }
 *
 * @example
 * // Converts API response errors to ApiError
 * const apiError = toAppError({ statusCode: 502, message: 'API Error' });
 * // Returns ApiError with statusCode 502
 *
 * @example
 * // Wraps unknown errors with default AppError
 * const appError = toAppError('Something went wrong');
 * // Returns AppError with code 'UNKNOWN_ERROR' and statusCode 500
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
 * Safe JSON stringify that handles circular references and large values.
 *
 * Useful for logging errors and complex objects without crashing on circular references.
 * Truncates strings longer than 200 characters and stops recursion at max depth.
 *
 * @param obj - Object to stringify
 * @param maxDepth - Maximum recursion depth (default: 3)
 * @returns JSON string, or String(obj) if JSON.stringify fails
 *
 * @example
 * const error = new Error('Failed');
 * (error as any).circular = error; // Create circular reference
 * safeStringify(error); // Safely handles circular reference
 * // '[Circular]' is shown for circular references
 *
 * @example
 * const largeString = 'x'.repeat(1000);
 * const obj = { data: largeString };
 * safeStringify(obj);
 * // Truncates long strings: "xxx...""
 *
 * @example
 * const deepObj = { a: { b: { c: { d: { e: { f: 'value' } } } } } };
 * safeStringify(deepObj);
 * // Stops at maxDepth: "[max depth reached]"
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
