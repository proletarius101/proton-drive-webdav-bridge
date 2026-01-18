/**
 * API and network errors
 */
import { AppError } from './AppError.js';

export class ApiError extends AppError {
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

export class NetworkError extends ApiError {
  readonly code = 'NETWORK_ERROR';

  constructor(message: string, originalError?: Error) {
    super(`Network error: ${message}`, 503, undefined, originalError);
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

export class TimeoutError extends ApiError {
  readonly code = 'TIMEOUT';

  constructor(message: string = 'Request timeout') {
    super(message, 504);
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

export class ProtonApiError extends ApiError {
  readonly code = 'PROTON_API_ERROR';

  constructor(
    message: string,
    readonly apiCode?: number,
    readonly apiResponse?: Record<string, unknown>
  ) {
    super(`Proton API error: ${message}`, 502);
    Object.setPrototypeOf(this, ProtonApiError.prototype);
  }

  toJSON() {
    return {
      ...super.toJSON(),
      apiCode: this.apiCode,
      apiResponse: this.apiResponse,
    };
  }
}
