/**
 * Configuration validation utilities
 */
import { InvalidConfigError } from '../errors/index.js';
import { Result, err, ok } from '../utils/result.js';

/**
 * Validate port number (1-65535)
 */
export function validatePort(port: unknown): Result<number, InvalidConfigError> {
  if (typeof port !== 'number' && typeof port !== 'string') {
    return err(new InvalidConfigError('port', 'Must be a number or string'));
  }

  const portNum = typeof port === 'string' ? parseInt(port, 10) : port;

  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    return err(new InvalidConfigError('port', 'Must be between 1 and 65535'));
  }

  return ok(portNum);
}

/**
 * Validate host/IP address (basic check)
 */
export function validateHost(host: unknown): Result<string, InvalidConfigError> {
  if (typeof host !== 'string') {
    return err(new InvalidConfigError('host', 'Must be a string'));
  }

  const trimmed = host.trim();

  if (!trimmed) {
    return err(new InvalidConfigError('host', 'Must not be empty'));
  }

  // Check for invalid characters (very basic validation)
  if (!/^[a-zA-Z0-9.\-:]+$/.test(trimmed)) {
    return err(new InvalidConfigError('host', 'Contains invalid characters'));
  }

  return ok(trimmed);
}

/**
 * Validate boolean configuration value
 */
export function validateBoolean(value: unknown): Result<boolean, InvalidConfigError> {
  if (typeof value === 'boolean') {
    return ok(value);
  }

  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'true' || lower === 'yes' || lower === '1') return ok(true);
    if (lower === 'false' || lower === 'no' || lower === '0') return ok(false);
    return err(new InvalidConfigError('boolean', 'Must be "true" or "false"'));
  }

  return err(new InvalidConfigError('boolean', 'Must be a boolean or string'));
}

/**
 * Validate configuration requirements (at least one value is set)
 */
export function validateRequired(
  value: unknown,
  fieldName: string
): Result<unknown, InvalidConfigError> {
  if (value === null || value === undefined || value === '') {
    return err(new InvalidConfigError(fieldName, 'This field is required'));
  }

  return ok(value);
}
