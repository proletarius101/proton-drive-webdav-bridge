import { describe, expect, test } from 'bun:test';
import { getClaimedAdditionalMetadata } from '../src/webdav/sdkHelpers.js';

import type { Result, Revision } from '@protontech/drive-sdk';
import { afterEach, beforeEach } from 'bun:test';
import { PerTestEnv, setupPerTestEnv } from './helpers/perTestEnv';

let __perTestEnv: PerTestEnv;
beforeEach(async () => {
  __perTestEnv = await setupPerTestEnv();
});
afterEach(async () => {
  await __perTestEnv.cleanup();
});

describe('getClaimedAdditionalMetadata helper', () => {
  test('returns claimedAdditionalMetadata from a Revision-shaped activeRevision', () => {
    const node = {
      activeRevision: {
        claimedAdditionalMetadata: { a: 'rev' },
      },
    } as const;

    expect(getClaimedAdditionalMetadata(node as any)).toEqual({ a: 'rev' });
  });

  test('returns claimedAdditionalMetadata from Result.ok activeRevision', () => {
    const node = {
      activeRevision: {
        ok: true,
        value: { claimedAdditionalMetadata: { b: 'res' } as Revision },
      } as Result<Revision, Error>,
    } as const;

    expect(getClaimedAdditionalMetadata(node as any)).toEqual({ b: 'res' });
  });

  test('falls back to node-level claimedAdditionalMetadata when activeRevision is degraded', () => {
    const node = {
      activeRevision: {
        ok: false,
        error: new Error('degraded'),
      } as Result<Revision, Error>,
      claimedAdditionalMetadata: { c: 'node' },
    } as const;

    expect(getClaimedAdditionalMetadata(node as any)).toEqual({ c: 'node' });
  });

  test('returns undefined for non-object or array claimed values', () => {
    const node1 = { claimedAdditionalMetadata: 'string' } as const;
    const node2 = { claimedAdditionalMetadata: ['array'] } as const;

    expect(getClaimedAdditionalMetadata(node1 as any)).toBeUndefined();
    expect(getClaimedAdditionalMetadata(node2 as any)).toBeUndefined();
  });
});
