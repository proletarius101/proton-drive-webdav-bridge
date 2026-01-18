/**
 * Authentication validation utilities
 * Validates credentials and authentication data
 */
import { InvalidRequestError } from '../errors/index.js';
import { Result, err, ok } from '../utils/result.js';

/**
 * Parse and validate Basic authentication header
 * Returns { username, password } or error
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
 * Validate email format (basic check)
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
 * Validate password strength
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
 * Validate TOTP code format (6-8 digits)
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
