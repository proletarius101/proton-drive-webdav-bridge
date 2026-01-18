/**
 * API and network errors - external service failures.
 *
 * Covers network issues, timeouts, and failures when calling external APIs.
 * These errors indicate the application couldn't reach or get a response from
 * an external service.
 *
 * @example
 * try {
 *   await driveApi.listFiles();
 * } catch (error) {
 *   throw new ProtonApiError('Failed to list files', 500, response);
 * }
 *
 * @see NetworkError for connectivity issues (503)
 * @see TimeoutError for slow/unresponsive services (504)
 * @see ProtonApiError for Proton service failures (502)
 */
import { AppError } from './AppError.js';

/**
 * Base class for API and external service errors.
 * These are internal errors (not shown to clients) that result from failed external calls.
 */
export class ApiError extends AppError {
  /**
   * Creates a new ApiError.
   *
   * @param message - Description of the API error
   * @param statusCode - HTTP status code to return (default: 500)
   * @param originalStatus - Original status code from external service (optional)
   * @param originalError - The original error from the external service (optional)
   */
  constructor(
    message: string,
    readonly statusCode: number = 500,
    readonly originalStatus?: number,
    readonly originalError?: unknown
  ) {
    super(message, 'API_ERROR', statusCode, false, originalError);
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

/**
 * Error thrown when network connectivity fails (503).
 *
 * Indicates the application couldn't reach the external service (DNS failure,
 * connection refused, network unreachable, etc.).
 *
 * @example
 * try {
 *   await api.call();
 * } catch (error) {
 *   throw new NetworkError('Could not connect to Proton API', error as Error);
 * }
 */
export class NetworkError extends ApiError {
  readonly code = 'NETWORK_ERROR';

  /**
   * Creates a new NetworkError.
   *
   * @param message - Description of the network failure
   * @param originalError - The underlying network error
   */
  constructor(message: string, originalError?: Error) {
    super(`Network error: ${message}`, 503, undefined, originalError);
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

/**
 * Error thrown when request to external service times out (504).
 *
 * Indicates the service didn't respond within the timeout period.
 *
 * @example
 * const timeoutMs = 5000;
 * const controller = new AbortController();
 * const timeout = setTimeout(() => controller.abort(), timeoutMs);
 * try {
 *   await fetch(url, { signal: controller.signal });
 * } catch (error) {
 *   if (error.name === 'AbortError') {
 *     throw new TimeoutError('Proton API did not respond in time');
 *   }
 * }
 */
export class TimeoutError extends ApiError {
  readonly code = 'TIMEOUT';

  /**
   * Creates a new TimeoutError.
   *
   * @param message - Description of the timeout (default: 'Request timeout')
   */
  constructor(message: string = 'Request timeout') {
    super(message, 504);
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

/**
 * Error thrown when Proton API returns an error response (502).
 *
 * Indicates the API was reachable but returned an error status or error response.
 *
 * @example
 * const response = await driveApi.createFile();
 * if (!response.ok) {
 *   throw new ProtonApiError(
 *     'Failed to create file',
 *     response.code,
 *     response
 *   );
 * }
 */
export class ProtonApiError extends ApiError {
  readonly code = 'PROTON_API_ERROR';

  /**
   * Creates a new ProtonApiError.
   *
   * @param message - Description of the API error
   * @param apiCode - Error code from the Proton API response (optional)
   * @param apiResponse - The full API error response object (optional)
   */
  constructor(
    message: string,
    readonly apiCode?: number,
    readonly apiResponse?: Record<string, unknown>
  ) {
    super(`Proton API error: ${message}`, 502);
    Object.setPrototypeOf(this, ProtonApiError.prototype);
  }

  /**
   * Serialize error to JSON, including API-specific details.
   * Useful for logging and debugging.
   */
  toJSON() {
    return {
      ...super.toJSON(),
      apiCode: this.apiCode,
      apiResponse: this.apiResponse,
    };
  }
}
