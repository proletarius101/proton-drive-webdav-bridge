/**
 * Path validation for WebDAV operations.
 *
 * Ensures paths are safe, normalized, and don't allow path traversal attacks or other
 * security issues. All paths used in WebDAV operations should be validated through these functions.
 *
 * @example
 * const result = validatePathSafety(userInput);
 * if (result.ok) {
 *   const safePath = result.value;
 *   // Use safePath in file operations
 * } else {
 *   throw result.error; // InvalidPathError
 * }
 *
 * @see normalizePath for path normalization
 * @see validatePathSafety for security validation
 * @see validateFilename for filename-only validation
 * @see combinePaths for safely combining paths
 */
import { InvalidPathError } from '../errors/index.js';
import { Result, err, ok } from '../utils/result.js';

/**
 * Normalize a WebDAV path to canonical form.
 *
 * - Ensures path starts with `/` (root prefix)
 * - Removes duplicate consecutive slashes
 * - Preserves trailing slash when present
 * - Does NOT perform security checks (use validatePathSafety for that)
 *
 * @param path - The path to normalize
 * @returns Normalized path (always starts with `/`)
 *
 * @example
 * normalizePath('foo/bar'); // '/foo/bar'
 * normalizePath('/foo//bar'); // '/foo/bar'
 * normalizePath('/foo/bar/'); // '/foo/bar/' (preserves trailing slash)
 * normalizePath(''); // '/'
 */
export function normalizePath(path: string): string {
  if (!path) return '/';

  // Ensure starts with /
  const normalized = path.startsWith('/') ? path : `/${path}`;

  // Remove duplicate slashes (but preserve single //)
  return normalized.replace(/\/+/g, '/');
}

/**
 * Check if a path contains path traversal attack patterns.
 *
 * Detects `..` and `./..` patterns that could allow access outside the intended directory.
 *
 * @param path - The path to check
 * @returns true if traversal patterns detected, false otherwise
 *
 * @example
 * containsPathTraversal('../../../etc/passwd'); // true
 * containsPathTraversal('/safe/path'); // false
 * containsPathTraversal('/./../file'); // true
 */
export function containsPathTraversal(path: string): boolean {
  return path.includes('..') || path.includes('./.');
}

/**
 * Validate WebDAV path for safety and security.
 *
 * Checks for:
 * - Path traversal attempts (`..`, `./..`)
 * - Control characters and null bytes
 * - Valid string input
 *
 * @param path - The path to validate
 * @returns Ok(normalizedPath) if valid, Err(InvalidPathError) if invalid
 *
 * @example
 * const result = validatePathSafety('/documents/file.txt');
 * if (result.ok) {
 *   useFile(result.value); // '/documents/file.txt'
 * } else {
 *   // Handle error
 * }
 *
 * @example
 * const result = validatePathSafety('../../../etc/passwd');
 * // result.ok === false
 * // result.error.code === 'INVALID_PATH'
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
 * Validate a filename (not a full path).
 *
 * Checks that the value is a valid filename without path separators.
 * Used when only the filename part of a path should be validated.
 *
 * Rejects:
 * - Empty or whitespace-only strings
 * - Filenames containing `/` or `\` (path separators)
 * - Control characters
 * - Path traversal patterns (`.`, `..`)
 *
 * @param filename - The filename to validate (must NOT include path separators)
 * @returns Ok(filename) if valid, Err(InvalidPathError) if invalid
 *
 * @example
 * const result = validateFilename('document.txt');
 * if (result.ok) {
 *   const safe = result.value; // 'document.txt'
 * }
 *
 * @example
 * validateFilename('../etc/passwd'); // error: contains path traversal
 * validateFilename('file/name.txt'); // error: contains path separator
 * validateFilename(''); // error: cannot be empty
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
 * Combine and validate a base path with a relative path.
 *
 * Safely joins a base path and relative path, then validates the result.
 * Prevents path traversal in either component.
 *
 * @param basePath - The base directory path (must be absolute, validated)
 * @param relativePath - The relative path to append (validated for traversal)
 * @returns Ok(combinedPath) if valid, Err(InvalidPathError) if invalid
 *
 * @example
 * const result = combinePaths('/documents', 'file.txt');
 * if (result.ok) {
 *   fs.read(result.value); // '/documents/file.txt'
 * }
 *
 * @example
 * // Path traversal attempt is caught
 * combinePaths('/documents', '../../../etc/passwd');
 * // result.ok === false
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
