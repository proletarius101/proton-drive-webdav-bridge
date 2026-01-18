/**
 * Result type pattern for handling success/failure without exceptions
 * Inspired by Rust's Result<T, E> and Railway-oriented programming
 *
 * Usage:
 *   const result = await someOperation();
 *   if (result.ok) {
 *     console.log('Value:', result.value);
 *   } else {
 *     console.error('Error:', result.error);
 *   }
 */

/**
 * Success result wrapping a value
 */
export interface Ok<T> {
  ok: true;
  value: T;
}

/**
 * Failure result wrapping an error
 */
export interface Err<E> {
  ok: false;
  error: E;
}

/**
 * Combined result type - either Ok<T> or Err<E>
 */
export type Result<T, E = Error> = Ok<T> | Err<E>;

/**
 * Create a success result
 */
export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

/**
 * Create a failure result
 */
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

/**
 * Check if result is ok
 */
export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok;

/**
 * Check if result is error
 */
export const isErr = <T, E>(result: Result<T, E>): result is Err<E> => !result.ok;

/**
 * Map a successful result to a new value
 */
export const mapOk = <T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> =>
  result.ok ? ok(fn(result.value)) : result;

/**
 * Map an error result to a new error
 */
export const mapErr = <T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> =>
  result.ok ? result : err(fn(result.error));

/**
 * Chain operations (flatMap/andThen)
 */
export const andThen = <T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> => (result.ok ? fn(result.value) : result);

/**
 * Execute a function for side effects on success
 */
export const tap = <T, E>(result: Result<T, E>, fn: (value: T) => void): Result<T, E> => {
  if (result.ok) fn(result.value);
  return result;
};

/**
 * Execute a function for side effects on error
 */
export const tapErr = <T, E>(result: Result<T, E>, fn: (error: E) => void): Result<T, E> => {
  if (!result.ok) fn(result.error);
  return result;
};

/**
 * Unwrap a result, throwing on error
 */
export const unwrap = <T, E extends Error>(result: Result<T, E>): T => {
  if (result.ok) return result.value;
  throw result.error;
};

/**
 * Unwrap with a fallback value
 */
export const unwrapOr = <T, E>(result: Result<T, E>, fallback: T): T =>
  result.ok ? result.value : fallback;

/**
 * Convert a Promise-returning function into a Result-returning function
 */
export const fromPromise = async <T, E extends Error = Error>(
  fn: () => Promise<T>,
  errorTransform?: (error: unknown) => E
): Promise<Result<T, E>> => {
  try {
    return ok(await fn());
  } catch (error) {
    const transformedError =
      errorTransform?.(error) || ((error instanceof Error ? error : new Error(String(error))) as E);
    return err(transformedError);
  }
};

/**
 * Collect multiple results into a single result
 * Returns Ok with array of values if all succeed, first error otherwise
 */
export const collectResults = <T, E>(results: Result<T, E>[]): Result<T[], E> => {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
};
