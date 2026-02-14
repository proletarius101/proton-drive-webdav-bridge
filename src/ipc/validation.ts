/**
 * IPC Request Validation Schemas
 *
 * This module defines validators for all IPC requests.
 * All handlers MUST validate incoming data against these schemas.
 * Can be replaced with Zod for more sophisticated validation later.
 */

/**
 * Simple validation result type (compatible with Zod)
 */
export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Simple validator function type
 */
type Validator<T> = (data: unknown) => ValidationResult<T>;

/**
 * Helper validators
 */
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

const isValidEmail = (v: unknown): v is string => {
  if (!isNonEmptyString(v)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
};

/**
 * Create a validator for an object with required properties
 */
const createObjectValidator = <T extends Record<string, unknown>>(
  schema: Record<string, (val: unknown) => boolean>
): Validator<T> => {
  return (data: unknown): ValidationResult<T> => {
    if (typeof data !== 'object' || data === null) {
      return { success: false, error: 'Expected object' };
    }

    const obj = data as Record<string, unknown>;
    const errors: string[] = [];

    for (const [key, validator] of Object.entries(schema)) {
      if (!validator(obj[key])) {
        errors.push(`Invalid field: ${key}`);
      }
    }

    if (errors.length > 0) {
      return { success: false, error: errors.join('; ') };
    }

    return { success: true, data: obj as T };
  };
};

/**
 * IPC Request Validators - keyed by channel name
 */
export const validators = {
  // Auth handlers
  'auth:login': createObjectValidator<{ email: string; password: string }>({
    email: isValidEmail,
    password: isNonEmptyString,
  }),

  'auth:submit2FA': createObjectValidator<{ code: string }>({
    code: isNonEmptyString,
  }),

  'auth:submitMailboxPassword': createObjectValidator<{ password: string }>({
    password: isNonEmptyString,
  }),

  // Undefined request validators
  'auth:logout': (): ValidationResult<undefined> => ({ success: true }),
  'auth:check': (): ValidationResult<undefined> => ({ success: true }),

  // WebDAV handlers
  'webdav:start': (data: unknown): ValidationResult<Record<string, unknown>> => {
    // Options are optional
    if (data === undefined) return { success: true, data: {} };
    if (typeof data === 'object' && data !== null) {
      return { success: true, data: data as Record<string, unknown> };
    }
    return { success: false, error: 'Expected object or undefined' };
  },
  'webdav:stop': (): ValidationResult<undefined> => ({ success: true }),
  'webdav:status': (): ValidationResult<undefined> => ({ success: true }),

  // Config handlers
  'config:get': (): ValidationResult<undefined> => ({ success: true }),
  'config:update': createObjectValidator<{ key: string; value: unknown }>({
    key: isNonEmptyString,
    value: () => true, // any value is acceptable
  }),

  // Platform handlers
  'platform:mountDrive': (): ValidationResult<undefined> => ({ success: true }),
  'platform:unmountDrive': (): ValidationResult<undefined> => ({ success: true }),
  'platform:checkMountStatus': (): ValidationResult<undefined> => ({ success: true }),
  'platform:openInFiles': (data: unknown): ValidationResult<{ path?: string }> => {
    if (data === undefined) return { success: true, data: {} };
    if (typeof data === 'object' && data !== null) {
      const obj = data as Record<string, unknown>;
      if (obj.path === undefined || isNonEmptyString(obj.path)) {
        return { success: true, data: { path: obj.path as string | undefined } };
      }
    }
    return { success: false, error: 'Expected object with optional path string' };
  },
};

/**
 * Validate an IPC request
 * @param channel The IPC channel name
 * @param data The request data
 * @returns Validation result
 */
export function validateIPCRequest(channel: string, data: unknown): ValidationResult<unknown> {
  const validator = validators[channel as keyof typeof validators];

  if (!validator) {
    return { success: false, error: `Unknown channel: ${channel}` };
  }

  return validator(data);
}

/**
 * Error message for validation failures
 */
export function getValidationErrorMessage(error: string): string {
  return `IPC validation failed: ${error}`;
}
