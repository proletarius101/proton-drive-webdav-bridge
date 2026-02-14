/**
 * IPC Handler Utilities
 *
 * Helpers for secure IPC handler implementation, including timeout protection.
 */

/**
 * Wraps a handler promise with a timeout
 * @param promise The handler promise
 * @param ms Timeout in milliseconds (default: 30s)
 * @returns Promise that rejects on timeout
 */
export function withTimeout<T>(promise: Promise<T>, ms: number = 30000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => {
        reject(new Error(`IPC handler timeout after ${ms}ms`));
      }, ms)
    ),
  ]);
}

/**
 * Safely handle IPC errors and return a consistent error response
 * @param error The error to handle
 * @returns Error response object
 */
export function handleIPCError(error: unknown): { success: false; error: string } {
  const message = error instanceof Error ? error.message : String(error);
  const displayMessage = message.length > 500 ? message.substring(0, 500) + '...' : message;
  return {
    success: false,
    error: displayMessage,
  };
}

/**
 * Log IPC handler execution for debugging
 * @param channel The IPC channel
 * @param action 'start' or 'complete'
 */
export function logIPCHandler(channel: string, action: 'start' | 'complete' | 'error'): void {
  console.log(`[IPC] ${action.toUpperCase()} '${channel}'`);
}
