/**
 * Result type pattern for handling success/failure without exceptions.
 *
 * Provides a type-safe way to represent operations that can fail without using exceptions.
 * Inspired by Rust's Result<T, E> and Railway-oriented programming.
 *
 * @example
 * // Using result pattern instead of try/catch
 * const result = await readFile(path);
 * if (result.ok) {
 *   console.log('Content:', result.value);
 * } else {
 *   console.error('Error:', result.error.message);
 * }
 *
 * @example
 * // Chaining results with andThen
 * const result = validateInput(input)
 *   .andThen(validate)
 *   .andThen(process)
 *   .mapErr(e => new ValidationError(e.message));
 *
 * @see https://doc.rust-lang.org/std/result/
 */

/**
 * Success result wrapping a value.
 *
 * @template T - The type of the wrapped value
 *
 * @example
 * const result: Ok<string> = { ok: true, value: 'success' };
 */
export interface Ok<T> {
  /** Indicates this is a successful result */
  ok: true;
  /** The successful value */
  value: T;
}

/**
 * Failure result wrapping an error.
 *
 * @template E - The type of the wrapped error
 *
 * @example
 * const result: Err<Error> = { ok: false, error: new Error('failed') };
 */
export interface Err<E> {
  /** Indicates this is a failed result */
  ok: false;
  /** The error value */
  error: E;
}

/**
 * Combined result type - either Ok<T> or Err<E>.
 *
 * Use this type to represent operations that can either succeed with a value or fail with an error.
 *
 * @template T - The type of successful value
 * @template E - The type of error (defaults to Error)
 *
 * @example
 * function divide(a: number, b: number): Result<number, string> {
 *   if (b === 0) return err('Division by zero');
 *   return ok(a / b);
 * }
 */
export type Result<T, E = Error> = Ok<T> | Err<E>;

/**
 * Create a success result wrapping a value.
 *
 * @template T - The type of the value
 * @param value - The successful value
 * @returns A success result containing the value
 *
 * @example
 * const result = ok(42); // Ok<number>
 * const result = ok('hello'); // Ok<string>
 */
export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

/**
 * Create a failure result wrapping an error.
 *
 * @template E - The type of the error
 * @param error - The error value
 * @returns A failure result containing the error
 *
 * @example
 * const result = err(new Error('Something went wrong'));
 * const result = err('Invalid input');
 */
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

/**
 * Type guard to check if a result is successful.
 *
 * Narrows the result type to Ok<T> if true.
 *
 * @template T - The type of successful value
 * @template E - The type of error
 * @param result - The result to check
 * @returns true if result is successful
 *
 * @example
 * const result = someOperation();
 * if (isOk(result)) {
 *   console.log(result.value); // result is Ok<T>
 * }
 */
export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok;

/**
 * Type guard to check if a result is an error.
 *
 * Narrows the result type to Err<E> if true.
 *
 * @template T - The type of successful value
 * @template E - The type of error
 * @param result - The result to check
 * @returns true if result is an error
 *
 * @example
 * const result = someOperation();
 * if (isErr(result)) {
 *   console.error(result.error); // result is Err<E>
 * }
 */
export const isErr = <T, E>(result: Result<T, E>): result is Err<E> => !result.ok;

/**
 * Map a successful result to a new value, leaving errors unchanged.
 *
 * @template T - The type of the original value
 * @template U - The type of the new value
 * @template E - The type of error
 * @param result - The result to map
 * @param fn - Function to apply to the successful value
 * @returns A result with the mapped value or the original error
 *
 * @example
 * const result = ok(5);
 * const mapped = mapOk(result, x => x * 2); // ok(10)
 *
 * @example
 * const result = err(new Error('failed'));
 * const mapped = mapOk(result, x => x * 2); // err(Error('failed'))
 */
export const mapOk = <T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> =>
  result.ok ? ok(fn(result.value)) : result;

/**
 * Map an error result to a new error, leaving success unchanged.
 *
 * @template T - The type of successful value
 * @template E - The type of the original error
 * @template F - The type of the new error
 * @param result - The result to map
 * @param fn - Function to apply to the error
 * @returns A result with the mapped error or the original value
 *
 * @example
 * const result = err(new Error('failed'));
 * const mapped = mapErr(result, e => new ValidationError(e.message));
 */
export const mapErr = <T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> =>
  result.ok ? result : err(fn(result.error));

/**
 * Chain operations (monadic bind, also known as flatMap).
 *
 * Applies a function that returns a Result to the successful value,
 * allowing composition of operations that can fail.
 *
 * @template T - The type of the original value
 * @template U - The type of the new value
 * @template E - The type of error
 * @param result - The result to chain from
 * @param fn - Function that returns a Result
 * @returns The result of fn if input was Ok, otherwise the original error
 *
 * @example
 * const parseResult = parseInput(input);
 * const validateResult = andThen(parseResult, validateInput);
 * const processResult = andThen(validateResult, processInput);
 */
export const andThen = <T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> => (result.ok ? fn(result.value) : result);

/**
 * Execute a function for side effects on success, then return the result unchanged.
 *
 * Useful for logging, state updates, or other side effects without changing the result.
 *
 * @template T - The type of successful value
 * @template E - The type of error
 * @param result - The result to inspect
 * @param fn - Function to execute if result is successful
 * @returns The original result unchanged
 *
 * @example
 * const result = ok(42);
 * const logged = tap(result, value => console.log('Value:', value));
 * // Logs: "Value: 42"
 * // logged === result
 */
export const tap = <T, E>(result: Result<T, E>, fn: (value: T) => void): Result<T, E> => {
  if (result.ok) fn(result.value);
  return result;
};

/**
 * Execute a function for side effects on error, then return the result unchanged.
 *
 * Useful for error logging or recovery attempts without changing the result.
 *
 * @template T - The type of successful value
 * @template E - The type of error
 * @param result - The result to inspect
 * @param fn - Function to execute if result is an error
 * @returns The original result unchanged
 *
 * @example
 * const result = err(new Error('failed'));
 * const logged = tapErr(result, error => logger.error(error.message));
 * // Logs the error
 * // logged === result
 */
export const tapErr = <T, E>(result: Result<T, E>, fn: (error: E) => void): Result<T, E> => {
  if (!result.ok) fn(result.error);
  return result;
};

/**
 * Extract the value from a successful result, throwing the error if it failed.
 *
 * Use this when you're confident the result succeeded, or want exceptions for errors.
 *
 * @template T - The type of successful value
 * @template E - The type of error (must extend Error)
 * @param result - The result to unwrap
 * @returns The successful value
 * @throws The error if result failed
 *
 * @example
 * const result = ok(42);
 * const value = unwrap(result); // 42
 *
 * @example
 * const result = err(new Error('failed'));
 * unwrap(result); // throws Error('failed')
 */
export const unwrap = <T, E extends Error>(result: Result<T, E>): T => {
  if (result.ok) return result.value;
  throw result.error;
};

/**
 * Extract the value from a successful result, or return a fallback value if it failed.
 *
 * @template T - The type of successful value
 * @template E - The type of error
 * @param result - The result to unwrap
 * @param fallback - Value to return if result failed
 * @returns The successful value or the fallback
 *
 * @example
 * const result = ok(42);
 * unwrapOr(result, 0); // 42
 *
 * @example
 * const result = err(new Error('failed'));
 * unwrapOr(result, 0); // 0
 */
export const unwrapOr = <T, E>(result: Result<T, E>, fallback: T): T =>
  result.ok ? result.value : fallback;

/**
 * Convert a Promise-returning operation into a Result-returning operation.
 *
 * Wraps Promise rejection/errors into the Result type for composition.
 *
 * @template T - The type of successful value
 * @template E - The type of error
 * @param fn - Function that returns a Promise
 * @param errorTransform - Optional function to transform caught errors (default: uses Error directly)
 * @returns A Promise that resolves to a Result
 *
 * @example
 * const result = await fromPromise(
 *   () => fetch('/api/data').then(r => r.json())
 * );
 *
 * @example
 * const result = await fromPromise(
 *   () => fs.promises.readFile('file.txt'),
 *   error => new AppError('Read failed', 'FILE_READ_ERROR', 500, false, error)
 * );
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
 * Collect multiple results into a single result.
 *
 * If all results are successful, returns Ok with an array of all values.
 * If any result failed, returns the first error encountered.
 *
 * @template T - The type of successful values
 * @template E - The type of errors
 * @param results - Array of results to collect
 * @returns Ok with array of values if all succeed, first Err otherwise
 *
 * @example
 * const results = [ok(1), ok(2), ok(3)];
 * const collected = collectResults(results);
 * // collected === ok([1, 2, 3])
 *
 * @example
 * const results = [ok(1), err('error'), ok(3)];
 * const collected = collectResults(results);
 * // collected === err('error')
 */
export const collectResults = <T, E>(results: Result<T, E>[]): Result<T[], E> => {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
};
