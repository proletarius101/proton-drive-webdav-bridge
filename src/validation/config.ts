/**
 * Configuration validation utilities.
 *
 * Validates configuration parameters such as port numbers, hostnames, boolean values,
 * and required fields. Use these validators when loading and validating application config.
 *
 * @example
 * const portResult = validatePort(process.env.PORT || 3000);
 * if (portResult.ok) {
 *   const port = portResult.value; // Validated port number
 * } else {
 *   throw portResult.error; // InvalidConfigError
 * }
 *
 * @see validatePort for port number validation
 * @see validateHost for hostname/IP validation
 * @see validateBoolean for boolean config values
 * @see validateRequired for required field checking
 */
import { InvalidConfigError } from '../errors/index.js';
import type { Result } from '../utils/result.js';
import { err, ok } from '../utils/result.js';

/**
 * Validate port number.
 *
 * Accepts numbers and numeric strings. Validates range 1-65535 (valid port range).
 *
 * @param port - The port to validate (can be number or string)
 * @returns Ok(portNumber) if valid, Err(InvalidConfigError) if invalid
 *
 * @example
 * const result = validatePort(3000);
 * if (result.ok) {
 *   startServer(result.value); // 3000
 * }
 *
 * @example
 * validatePort('8080');
 * // result.ok === true, result.value === 8080
 *
 * @example
 * validatePort(0); // Too low
 * // result.ok === false
 * // Error: "Must be between 1 and 65535"
 *
 * @example
 * validatePort(99999); // Too high
 * // result.ok === false
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
 * Validate host/IP address.
 *
 * Performs basic validation of hostname or IP address format.
 * Accepts IPv4, IPv6 (with colons), and hostnames.
 *
 * @param host - The host to validate (must be string)
 * @returns Ok(trimmedHost) if valid, Err(InvalidConfigError) if invalid
 *
 * @example
 * validateHost('localhost');
 * // result.ok === true
 *
 * @example
 * validateHost('127.0.0.1');
 * // result.ok === true
 *
 * @example
 * validateHost('::1'); // IPv6
 * // result.ok === true
 *
 * @example
 * validateHost(''); // Empty
 * // result.ok === false
 * // Error: "Must not be empty"
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
 * Validate and parse boolean configuration value.
 *
 * Accepts:
 * - Native booleans: `true`, `false`
 * - String values: `"true"`, `"false"`, `"yes"`, `"no"`, `"1"`, `"0"` (case-insensitive)
 *
 * @param value - The value to parse as boolean
 * @returns Ok(booleanValue) if valid, Err(InvalidConfigError) if invalid
 *
 * @example
 * validateBoolean(true);
 * // result.ok === true, result.value === true
 *
 * @example
 * validateBoolean('true');
 * // result.ok === true, result.value === true
 *
 * @example
 * validateBoolean('yes');
 * // result.ok === true, result.value === true
 *
 * @example
 * validateBoolean('false');
 * // result.ok === true, result.value === false
 *
 * @example
 * validateBoolean('maybe');
 * // result.ok === false
 * // Error: 'Must be "true" or "false"'
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
 * Validate that a required configuration field is present.
 *
 * Checks that a value is not null, undefined, or empty string.
 *
 * @param value - The value to check
 * @param fieldName - Name of the field (for error message)
 * @returns Ok(value) if present, Err(InvalidConfigError) if missing
 *
 * @example
 * const result = validateRequired(process.env.API_KEY, 'API_KEY');
 * if (result.ok) {
 *   const apiKey = result.value as string;
 * }
 *
 * @example
 * validateRequired(null, 'DATABASE_URL');
 * // result.ok === false
 * // Error: 'DATABASE_URL: This field is required'
 *
 * @example
 * validateRequired('', 'DATABASE_URL');
 * // result.ok === false
 * // Error: 'DATABASE_URL: This field is required'
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
