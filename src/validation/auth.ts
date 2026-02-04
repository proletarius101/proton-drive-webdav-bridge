/**
 * Authentication validation utilities.
 *
 * Validates authentication credentials, email addresses, passwords, and other
 * auth-related inputs. All user-provided authentication data should be validated
 * through these functions before use.
 *
 * @example
 * const basicAuthResult = parseBasicAuth(authHeader);
 * if (basicAuthResult.ok) {
 *   const { username, password } = basicAuthResult.value;
 *   // Authenticate user
 * } else {
 *   throw basicAuthResult.error; // InvalidRequestError
 * }
 *
 * @see parseBasicAuth for HTTP Basic authentication
 * @see validateEmail for email address validation
 * @see validatePasswordStrength for password requirements
 * @see validateTotpCode for TOTP code validation
 */
import { InvalidRequestError } from '../errors/index.js';
import type { Result } from '../utils/result.js';
import { err, ok } from '../utils/result.js';

/**
 * Parse and validate HTTP Basic authentication header.
 *
 * Extracts username and password from a Basic authorization header.
 * Format: `Authorization: Basic <base64(username:password)>`
 *
 * @param authHeader - The Authorization header value (e.g., "Basic dXNlcjpwYXNz")
 * @returns Ok({ username, password }) if valid, Err(InvalidRequestError) if invalid
 *
 * @example
 * const result = parseBasicAuth('Basic dXNlcjpwYXNzd29yZA==');
 * if (result.ok) {
 *   console.log(result.value.username); // 'user'
 *   console.log(result.value.password); // 'password'
 * }
 *
 * @example
 * // Invalid base64
 * parseBasicAuth('Basic !!!invalid!!!');
 * // result.ok === false
 * // Throws InvalidRequestError
 *
 * @example
 * // Missing colon separator
 * parseBasicAuth('Basic dXNlcm5hbWU='); // no colon
 * // result.ok === false
 */
export function parseBasicAuth(
  authHeader: string
): Result<{ username: string; password: string }, InvalidRequestError> {
  if (!authHeader || typeof authHeader !== 'string') {
    return err(new InvalidRequestError('Missing or invalid Authorization header'));
  }

  const match = authHeader.match(/^Basic\s+(.+)$/i);
  if (!match || !match[1]) {
    return err(new InvalidRequestError('Invalid Basic auth format. Expected: "Basic <base64>"'));
  }

  let credentials: string;
  try {
    credentials = Buffer.from(match[1], 'base64').toString('utf8');
  } catch {
    return err(new InvalidRequestError('Invalid Base64 encoding in Authorization header'));
  }

  const colonIndex = credentials.indexOf(':');
  if (colonIndex === -1) {
    return err(new InvalidRequestError('Invalid Basic auth format. Expected: "username:password"'));
  }

  const username = credentials.slice(0, colonIndex);
  const password = credentials.slice(colonIndex + 1);

  if (!username || !password) {
    return err(
      new InvalidRequestError('Invalid Basic auth. Username and password must not be empty')
    );
  }

  return ok({ username, password });
}

/**
 * Validate email address format.
 *
 * Performs basic email validation (not fully RFC 5322 compliant, but sufficient
 * for most use cases). Trims whitespace automatically.
 *
 * @param email - The email address to validate
 * @returns Ok(trimmedEmail) if valid, Err(InvalidRequestError) if invalid
 *
 * @example
 * const result = validateEmail('user@example.com');
 * if (result.ok) {
 *   const email = result.value; // 'user@example.com'
 * }
 *
 * @example
 * validateEmail('invalid.email'); // Missing @domain
 * // result.ok === false
 *
 * @example
 * validateEmail('user @ example.com'); // Space in domain
 * // result.ok === false
 */
export function validateEmail(email: string): Result<string, InvalidRequestError> {
  if (!email || typeof email !== 'string') {
    return err(new InvalidRequestError('Email is required and must be a string'));
  }

  const trimmed = email.trim();

  // Basic email validation (not RFC 5322 complete, but sufficient)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) {
    return err(new InvalidRequestError(`Invalid email format: ${email}`));
  }

  return ok(trimmed);
}

/**
 * Validate password strength against minimum length requirement.
 *
 * @param password - The password to validate
 * @param minLength - Minimum required length (default: 8)
 * @returns Ok(password) if valid, Err(InvalidRequestError) if invalid
 *
 * @example
 * const result = validatePasswordStrength('SecurePass123', 12);
 * if (result.ok) {
 *   const pwd = result.value; // 'SecurePass123'
 * }
 *
 * @example
 * validatePasswordStrength('short', 8);
 * // result.ok === false
 * // Error: "Password must be at least 8 characters long"
 */
export function validatePasswordStrength(
  password: string,
  minLength: number = 8
): Result<string, InvalidRequestError> {
  if (!password || typeof password !== 'string') {
    return err(new InvalidRequestError('Password is required and must be a string'));
  }

  if (password.length < minLength) {
    return err(new InvalidRequestError(`Password must be at least ${minLength} characters long`));
  }

  return ok(password);
}

/**
 * Validate TOTP (Time-based One-Time Password) code format.
 *
 * Validates that the code is a 6-8 digit number as produced by authenticator apps.
 * Trims whitespace automatically.
 *
 * @param code - The TOTP code to validate
 * @returns Ok(trimmedCode) if valid, Err(InvalidRequestError) if invalid
 *
 * @example
 * const result = validateTotpCode('123456');
 * if (result.ok) {
 *   const code = result.value; // '123456'
 * }
 *
 * @example
 * validateTotpCode('abc123'); // Contains letters
 * // result.ok === false
 *
 * @example
 * validateTotpCode('12345'); // Too short
 * // result.ok === false
 */
export function validateTotpCode(code: string): Result<string, InvalidRequestError> {
  if (!code || typeof code !== 'string') {
    return err(new InvalidRequestError('TOTP code is required and must be a string'));
  }

  const trimmed = code.trim();

  // Accept 6-8 digits (some authenticators use different lengths)
  if (!/^\d{6,8}$/.test(trimmed)) {
    return err(new InvalidRequestError('TOTP code must be 6-8 digits'));
  }

  return ok(trimmed);
}
