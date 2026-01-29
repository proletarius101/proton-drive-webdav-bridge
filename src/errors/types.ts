/**
 * Command Error Types - TypeScript Discriminated Union
 *
 * These types mirror the Rust CommandError enum for type-safe error handling
 * in the frontend. Each error type includes a code for machine-readable
 * discrimination and a message for user display.
 */

// Error codes - matches Rust CommandError variants
export const ErrorCodes = {
  SIDECAR_ALREADY_RUNNING: 'SIDECAR_ALREADY_RUNNING',
  SIDECAR_NOT_RUNNING: 'SIDECAR_NOT_RUNNING',
  SIDECAR_SPAWN_FAILED: 'SIDECAR_SPAWN_FAILED',
  SIDECAR_COMMAND_FAILED: 'SIDECAR_COMMAND_FAILED',
  INVALID_PORT: 'INVALID_PORT',
  PORT_IN_USE: 'PORT_IN_USE',
  INVALID_EMAIL: 'INVALID_EMAIL',
  AUTH_FAILED: 'AUTH_FAILED',
  SERVER_INIT_TIMEOUT: 'SERVER_INIT_TIMEOUT',
  MOUNT_TIMEOUT: 'MOUNT_TIMEOUT',
  SERVER_NOT_RUNNING: 'SERVER_NOT_RUNNING',
  GIO_ERROR: 'GIO_ERROR',
  IO_ERROR: 'IO_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * CommandError - Discriminated union of all possible command errors
 *
 * Usage:
 * ```typescript
 * try {
 *   await invoke('start_sidecar');
 * } catch (error) {
 *   const err = error as CommandError;
 *   switch (err.code) {
 *     case ErrorCodes.SIDECAR_ALREADY_RUNNING:
 *       console.log('Already running');
 *       break;
 *     case ErrorCodes.SIDECAR_SPAWN_FAILED:
 *       console.log('Failed to start:', err.message);
 *       break;
 *     default:
 *       console.error('Unknown error:', err.message);
 *   }
 * }
 * ```
 */
export type CommandError =
  | { code: 'SIDECAR_ALREADY_RUNNING'; message: string }
  | { code: 'SIDECAR_NOT_RUNNING'; message: string }
  | { code: 'SIDECAR_SPAWN_FAILED'; message: string }
  | { code: 'SIDECAR_COMMAND_FAILED'; message: string }
  | { code: 'INVALID_PORT'; message: string }
  | { code: 'PORT_IN_USE'; message: string }
  | { code: 'INVALID_EMAIL'; message: string }
  | { code: 'AUTH_FAILED'; message: string }
  | { code: 'SERVER_INIT_TIMEOUT'; message: string }
  | { code: 'MOUNT_TIMEOUT'; message: string }
  | { code: 'SERVER_NOT_RUNNING'; message: string }
  | { code: 'GIO_ERROR'; message: string }
  | { code: 'IO_ERROR'; message: string }
  | { code: 'UNKNOWN_ERROR'; message: string };

/**
 * Type guard to check if an error is a CommandError
 */
export function isCommandError(error: unknown): error is CommandError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    typeof (error as any).code === 'string' &&
    typeof (error as any).message === 'string'
  );
}

/**
 * Extract error message from a CommandError or unknown error
 */
export function getErrorMessage(error: unknown): string {
  if (isCommandError(error)) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * User-friendly error messages for common error codes
 */
export const ErrorMessages: Record<ErrorCode, string> = {
  SIDECAR_ALREADY_RUNNING: 'The WebDAV server is already running.',
  SIDECAR_NOT_RUNNING: 'The WebDAV server is not running.',
  SIDECAR_SPAWN_FAILED: 'Failed to start the WebDAV server.',
  SIDECAR_COMMAND_FAILED: 'WebDAV server command failed.',
  INVALID_PORT: 'Invalid port number. Please use a port between 1024 and 65535.',
  PORT_IN_USE: 'The specified port is already in use. Please choose a different port.',
  INVALID_EMAIL: 'Invalid email address format.',
  AUTH_FAILED: 'Authentication failed. Please check your credentials.',
  SERVER_INIT_TIMEOUT: 'Server initialization timed out. Please try again.',
  MOUNT_TIMEOUT: 'Mount operation timed out. The drive may not be accessible.',
  SERVER_NOT_RUNNING: 'The WebDAV server is not running. Please start it first.',
  GIO_ERROR: 'File system mounting error. Please try again.',
  IO_ERROR: 'An input/output error occurred.',
  UNKNOWN_ERROR: 'An unexpected error occurred. Please try again.',
};
