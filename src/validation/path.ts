/**
 * Path validation for WebDAV operations
 * Ensures paths are safe, normalized, and don't allow path traversal attacks
 */
import { InvalidPathError } from '../errors/index.js';
import { Result, err, ok } from '../utils/result.js';

/**
 * Normalize a WebDAV path
 * - Ensures it starts with /
 * - Removes duplicate slashes
 * - Does NOT remove trailing slash (WebDAV spec requirement)
 */
export function normalizePath(path: string): string {
  if (!path) return '/';

  // Ensure starts with /
  const normalized = path.startsWith('/') ? path : `/${path}`;

  // Remove duplicate slashes (but preserve single //)
  return normalized.replace(/\/+/g, '/');
}

/**
 * Check if a path contains path traversal attempts (..)
 */
export function containsPathTraversal(path: string): boolean {
  return path.includes('..') || path.includes('./.');
}

/**
 * Validate WebDAV path safety
 * Returns Ok if valid, Err with ValidationError if invalid
 */
export function validatePathSafety(path: string): Result<string, InvalidPathError> {
  if (!path || typeof path !== 'string') {
    return err(new InvalidPathError('', 'Path is required and must be a string'));
  }

  const normalized = normalizePath(path);

  if (containsPathTraversal(normalized)) {
    return err(new InvalidPathError(path, 'Path traversal not allowed'));
  }

  // Ensure path is valid for use in URLs (doesn't contain control characters)
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(normalized)) {
    return err(new InvalidPathError(path, 'Path contains invalid control characters'));
  }

  return ok(normalized);
}

/**
 * Validate a filename (not a full path)
 */
export function validateFilename(filename: string): Result<string, InvalidPathError> {
  if (!filename || typeof filename !== 'string') {
    return err(new InvalidPathError('', 'Filename is required and must be a string'));
  }

  // Reject empty or whitespace-only
  if (!filename.trim()) {
    return err(new InvalidPathError(filename, 'Filename cannot be empty'));
  }

  // Reject if contains path separators (must be filename, not path)
  if (filename.includes('/') || filename.includes('\\')) {
    return err(new InvalidPathError(filename, 'Filename cannot contain path separators'));
  }

  // Reject control characters
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(filename)) {
    return err(new InvalidPathError(filename, 'Filename contains invalid control characters'));
  }

  // Reject if it looks like path traversal
  if (filename === '..' || filename === '.' || filename.includes('..')) {
    return err(new InvalidPathError(filename, 'Filename cannot contain path traversal patterns'));
  }

  return ok(filename);
}

/**
 * Combine and validate a base path with a relative path
 */
export function combinePaths(
  basePath: string,
  relativePath: string
): Result<string, InvalidPathError> {
  // Validate both parts
  const baseResult = validatePathSafety(basePath);
  if (!baseResult.ok) return baseResult;

  if (!relativePath || typeof relativePath !== 'string') {
    return err(new InvalidPathError('', 'Relative path is required and must be a string'));
  }

  // Validate relative path
  const relativeResult = validatePathSafety(relativePath);
  if (!relativeResult.ok) return relativeResult;

  // If relative path is root, return base
  if (relativeResult.value === '/') {
    return ok(baseResult.value);
  }

  // Combine and normalize
  const base = baseResult.value.endsWith('/') ? baseResult.value.slice(0, -1) : baseResult.value;
  const relative = relativeResult.value.startsWith('/')
    ? relativeResult.value
    : `/${relativeResult.value}`;
  const combined = `${base}${relative}`;

  return validatePathSafety(combined);
}

/**
 * Extract parent path from a path
 */
export function getParentPath(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === '/') return '/';

  const trimmed = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  const lastSlash = trimmed.lastIndexOf('/');

  if (lastSlash <= 0) return '/';
  return trimmed.slice(0, lastSlash);
}

/**
 * Extract filename from a path
 */
export function getFilename(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === '/') return '/';

  const trimmed = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  const lastSlash = trimmed.lastIndexOf('/');

  if (lastSlash === -1) return trimmed;
  return trimmed.slice(lastSlash + 1);
}
