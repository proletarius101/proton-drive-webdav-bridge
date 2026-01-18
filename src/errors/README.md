# Error Handling Infrastructure

This directory contains the error handling layer for proton-drive-bridge, providing structured, type-safe error handling with best practices.

## Structure

```
src/
├── errors/                 # Error type definitions
│   ├── AppError.ts        # Base error class
│   ├── ValidationError.ts # Input validation errors
│   ├── AuthenticationError.ts
│   ├── WebDAVError.ts     # WebDAV protocol errors
│   ├── ApiError.ts        # Network/API errors
│   └── index.ts           # Central export
├── utils/
│   ├── result.ts          # Result<T, E> type and helpers
│   └── error.ts           # Error conversion utilities
└── validation/            # Input validators
    ├── path.ts            # Path validation
    ├── auth.ts            # Authentication validation
    ├── config.ts          # Configuration validation
    └── index.ts           # Central export
```

## Quick Start

### Using Error Types

```typescript
import { NotFoundError, ValidationError, NotAuthenticatedError } from './errors/index.js';

// Throw structured errors with automatic HTTP status codes
throw new NotFoundError('/file.txt');           // 404
throw new ValidationError('Invalid input');     // 400
throw new NotAuthenticatedError();              // 401
```

### Using Result Pattern

```typescript
import { Result, ok, err, isOk } from './utils/result.js';

// Return results instead of throwing
function divide(a: number, b: number): Result<number, string> {
  if (b === 0) return err('Cannot divide by zero');
  return ok(a / b);
}

// Handle results
const result = divide(10, 2);
if (result.ok) {
  console.log('Result:', result.value);
} else {
  console.error('Error:', result.error);
}
```

### Validating Input

```typescript
import { validatePathSafety, parseBasicAuth } from './validation/index.js';

// Path validation (prevents traversal attacks)
const pathResult = validatePathSafety('/home/user/file.txt');
if (pathResult.ok) {
  const safePath = pathResult.value;
  // Use safe path
}

// Authentication validation
const authResult = parseBasicAuth('Basic dXNlcjpwYXNz');
if (authResult.ok) {
  const { username, password } = authResult.value;
  // Authenticate user
}
```

## Error Types

### AppError (Base)
All errors extend `AppError`:
- `code`: Machine-readable error code
- `statusCode`: HTTP status code
- `isPublic`: Whether safe to send to client
- `getPublicMessage()`: Safe message for HTTP responses

### ValidationError
Input validation errors (400):
- `InvalidPathError`: Path traversal or format issues
- `InvalidConfigError`: Configuration problems
- `InvalidRequestError`: Malformed requests

### AuthenticationError
Auth-related errors (401):
- `NotAuthenticatedError`: Missing credentials
- `InvalidCredentialsError`: Wrong password/username
- `TokenExpiredError`: Session timeout
- `TwoFactorRequiredError`: 2FA needed
- `MailboxPasswordRequiredError`: Mailbox password required

### WebDAVError
WebDAV protocol errors:
- `NotFoundError` (404)
- `ConflictError` (409)
- `LockedError` (423)
- `MethodNotAllowedError` (405)
- `ForbiddenError` (403)
- `BadRequestError` (400)

### ApiError
External API errors (5xx):
- `NetworkError` (503): Connection issues
- `TimeoutError` (504): Request timeout
- `ProtonApiError` (502): Proton API failure

## Result Pattern

The `Result<T, E>` type represents either success (Ok) or failure (Err):

```typescript
type Result<T, E = Error> = 
  | { ok: true; value: T }
  | { ok: false; error: E };
```

### Core Functions
- `ok(value)`: Create success result
- `err(error)`: Create failure result
- `isOk(result)`: Check if success
- `isErr(result)`: Check if failure
- `mapOk(result, fn)`: Transform success value
- `mapErr(result, fn)`: Transform error
- `andThen(result, fn)`: Chain operations
- `unwrap(result)`: Extract value or throw
- `unwrapOr(result, fallback)`: Extract value with fallback
- `tap(result, fn)`: Execute side effect on success
- `tapErr(result, fn)`: Execute side effect on error
- `fromPromise(fn)`: Convert Promise to Result
- `collectResults(results)`: Combine multiple results

## Validation Functions

### Path Validation (`validation/path.ts`)
- `normalizePath(path)`: Normalize and clean path
- `validatePathSafety(path)`: Reject traversal attacks
- `validateFilename(name)`: Validate single filename
- `combinePaths(base, rel)`: Safely combine paths
- `getParentPath(path)`: Extract parent directory
- `getFilename(path)`: Extract filename

### Auth Validation (`validation/auth.ts`)
- `parseBasicAuth(header)`: Parse HTTP Basic auth
- `validateEmail(email)`: Check email format
- `validatePasswordStrength(pwd)`: Check password length
- `validateTotpCode(code)`: Check TOTP format

### Config Validation (`validation/config.ts`)
- `validatePort(port)`: Check port range (1-65535)
- `validateHost(host)`: Check host format
- `validateBoolean(value)`: Parse boolean config
- `validateRequired(value, field)`: Check required field

## Error Handling Utilities

### `toAppError(error)`
Convert any error to `AppError`:
```typescript
try {
  await someOperation();
} catch (error) {
  const appError = toAppError(error);  // Typed!
  logger.error(appError);
}
```

### `getErrorMessage(error)`
Safely extract error message from unknown:
```typescript
const message = getErrorMessage(error);  // Always a string
```

### `safeStringify(obj)`
Serialize objects for logging (prevents circular refs):
```typescript
logger.debug('Error details:', safeStringify(error, 3));
```

## Best Practices

### 1. Validate Early
```typescript
// ✓ Good
const pathResult = validatePathSafety(path);
if (!pathResult.ok) return pathResult;  // Short-circuit early

// ✗ Bad
try {
  const path = unsafeInput;  // No validation
  // ... use path
} catch (error) {
  // Too late, error already occurred
}
```

### 2. Use Specific Error Types
```typescript
// ✓ Good
throw new NotFoundError('/file.txt');
throw new ValidationError('Invalid port');

// ✗ Bad
throw new Error('Not found');
throw new Error('Invalid');
```

### 3. Chain Results with andThen
```typescript
// ✓ Good - clear error path
const result = validatePathSafety(path)
  .ok ? combineWithOther(path) : err(pathError);

// ✗ Bad - multiple try-catch blocks
try {
  const path = validatePath(input);
  const result = combineWithOther(path);
} catch (error) {
  // Complex error handling
}
```

### 4. Distinguish Public vs Internal Errors
```typescript
// ✓ Good
throw new ValidationError('Invalid port');  // isPublic=true, safe to send
throw new ApiError('DB connection failed');  // isPublic=false, hide from client

// ✗ Bad
throw new Error('DB error: connection refused, host=192.168.1.1');
```

### 5. Log with Context
```typescript
// ✓ Good
logger.error('Failed to process request', {
  code: appError.code,
  path: validatedPath,
  statusCode: appError.statusCode,
});

// ✗ Bad
logger.error(appError.message);
```

## Testing

See `test/errors.test.ts`, `test/result.test.ts`, and `test/validation.test.ts` for comprehensive examples.

Run tests:
```bash
bun test test/errors.test.ts test/result.test.ts test/validation.test.ts
```

## Migration Guide

See `IMPLEMENTATION_GUIDE.ts` for detailed examples and migration checklist.

## References

- [Railway Oriented Programming](https://fsharpforfunandprofit.com/posts/recipe-part2/)
- [Rust Result Type](https://doc.rust-lang.org/std/result/)
- [Error Handling Best Practices](https://nodejs.org/en/docs/guides/nodejs-error-handling/)
