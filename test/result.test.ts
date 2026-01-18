/**
 * Tests for Result type and utilities
 */
import { describe, test, expect } from 'bun:test';
import {
  ok,
  err,
  isOk,
  isErr,
  mapOk,
  mapErr,
  andThen,
  tap,
  tapErr,
  unwrap,
  unwrapOr,
  fromPromise,
  collectResults,
} from '../src/utils/result.js';

describe('Result type - Creation', () => {
  test('ok creates a success result', () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(42);
  });

  test('err creates a failure result', () => {
    const error = new Error('Failed');
    const result = err(error);
    expect(result.ok).toBe(false);
    expect(result.error).toBe(error);
  });
});

describe('Result type - Predicates', () => {
  test('isOk checks for success', () => {
    expect(isOk(ok(42))).toBe(true);
    expect(isOk(err(new Error()))).toBe(false);
  });

  test('isErr checks for failure', () => {
    expect(isErr(err(new Error()))).toBe(true);
    expect(isErr(ok(42))).toBe(false);
  });
});

describe('Result type - Mapping', () => {
  test('mapOk transforms success value', () => {
    const result = mapOk(ok(5), (x) => x * 2);
    expect(isOk(result)).toBe(true);
    if (result.ok) expect(result.value).toBe(10);
  });

  test('mapOk passes through errors', () => {
    const error = new Error('Failed');
    const result = mapOk(err(error), (_x: unknown) => 0);
    expect(isErr(result)).toBe(true);
    if (!result.ok) expect(result.error).toBe(error);
  });

  test('mapErr transforms error', () => {
    const result = mapErr(err('old'), (e) => `new: ${e}`);
    expect(isErr(result)).toBe(true);
    if (!result.ok) expect(result.error).toBe('new: old');
  });
});

describe('Result type - Chaining', () => {
  test('andThen chains operations', () => {
    const result = andThen(ok(5), (x) => ok(x * 2));
    expect(isOk(result)).toBe(true);
    if (result.ok) expect(result.value).toBe(10);
  });

  test('andThen passes through errors', () => {
    const error = new Error('Failed');
    const result = andThen(err(error), (_x) => ok(0));
    expect(isErr(result)).toBe(true);
    if (!result.ok) expect(result.error).toBe(error);
  });

  test('andThen can fail', () => {
    const result = andThen(ok(5), (_x) => err(new Error('Failed in chain')));
    expect(isErr(result)).toBe(true);
  });
});

describe('Result type - Side effects', () => {
  test('tap executes on success', () => {
    let called = false;
    tap(ok(42), () => {
      called = true;
    });
    expect(called).toBe(true);
  });

  test('tap does not execute on error', () => {
    let called = false;
    tap(err(new Error()), () => {
      called = true;
    });
    expect(called).toBe(false);
  });

  test('tapErr executes on error', () => {
    let called = false;
    tapErr(err(new Error()), () => {
      called = true;
    });
    expect(called).toBe(true);
  });

  test('tapErr does not execute on success', () => {
    let called = false;
    tapErr(ok(42), () => {
      called = true;
    });
    expect(called).toBe(false);
  });
});

describe('Result type - Unwrapping', () => {
  test('unwrap returns value on success', () => {
    const result = unwrap(ok(42));
    expect(result).toBe(42);
  });

  test('unwrap throws on error', () => {
    const error = new Error('Failed');
    expect(() => unwrap(err(error))).toThrow(error);
  });

  test('unwrapOr returns value on success', () => {
    expect(unwrapOr(ok(42), 0)).toBe(42);
  });

  test('unwrapOr returns fallback on error', () => {
    expect(unwrapOr(err(new Error()), 0)).toBe(0);
  });
});

describe('Result type - Promise integration', () => {
  test('fromPromise handles successful promise', async () => {
    const result = await fromPromise(() => Promise.resolve(42));
    expect(isOk(result)).toBe(true);
    if (result.ok) expect(result.value).toBe(42);
  });

  test('fromPromise handles rejected promise', async () => {
    const error = new Error('Failed');
    const result = await fromPromise(() => Promise.reject(error));
    expect(isErr(result)).toBe(true);
    if (!result.ok) expect(result.error).toBe(error);
  });

  test('fromPromise can transform error', async () => {
    const result = await fromPromise(
      () => Promise.reject(new Error('Original')),
      (err) => new Error(`Wrapped: ${err}`)
    );
    expect(isErr(result)).toBe(true);
  });
});

describe('Result type - Collection', () => {
  test('collectResults combines multiple successes', () => {
    const result = collectResults([ok(1), ok(2), ok(3)]);
    expect(isOk(result)).toBe(true);
    if (result.ok) expect(result.value).toEqual([1, 2, 3]);
  });

  test('collectResults returns first error', () => {
    const error = new Error('Failed');
    const result = collectResults([ok(1), err(error), ok(3)]);
    expect(isErr(result)).toBe(true);
    if (!result.ok) expect(result.error).toBe(error);
  });
});
