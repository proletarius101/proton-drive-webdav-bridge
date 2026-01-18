import type { MaybeNode, NodeEntity, DegradedNode, Result, Revision } from '@protontech/drive-sdk';

/**
 * Type guard for SDK Result<T, E> shape
 */
export function isResult<T, E>(x: unknown): x is Result<T, E> {
  return typeof x === 'object' && x !== null && 'ok' in (x as any);
}

/**
 * Normalize unknown value into an object map if appropriate
 */
function normalizeObject(v: unknown): { [k: string]: unknown } | undefined {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as { [k: string]: unknown };
  }
  return undefined;
}

/**
 * Extract claimedAdditionalMetadata from various SDK node shapes.
 * Handles:
 * - NodeEntity with `activeRevision: Revision`
 * - DegradedNode with `activeRevision: Result<Revision, Error>`
 * - Node-level `claimedAdditionalMetadata` fallback
 */
export function getClaimedAdditionalMetadata(
  sdkNode: MaybeNode | NodeEntity | DegradedNode
): { [k: string]: unknown } | undefined {
  // If sdkNode itself is a Result (MaybeNode), unwrap it first
  if (isResult<unknown, unknown>(sdkNode)) {
    if (!sdkNode.ok) {
      // degraded overall node; try to fall back to node-level claimed metadata if present
      return normalizeObject(
        (sdkNode as unknown as { claimedAdditionalMetadata?: unknown }).claimedAdditionalMetadata
      );
    }
    const ent = sdkNode.value as NodeEntity;

    if (ent.activeRevision) {
      if (isResult<Revision, Error>(ent.activeRevision)) {
        if (ent.activeRevision.ok) {
          return normalizeObject(ent.activeRevision.value?.claimedAdditionalMetadata);
        }
        // degraded activeRevision - fall back to node-level claimed metadata if present
        return normalizeObject(
          (ent as unknown as { claimedAdditionalMetadata?: unknown }).claimedAdditionalMetadata
        );
      }

      return normalizeObject(ent.activeRevision.claimedAdditionalMetadata);
    }

    return normalizeObject(
      (ent as unknown as { claimedAdditionalMetadata?: unknown }).claimedAdditionalMetadata
    );
  }

  // NodeEntity or DegradedNode
  const n = sdkNode as NodeEntity | DegradedNode;
  if (n.activeRevision) {
    if (isResult<Revision, Error>(n.activeRevision)) {
      if (n.activeRevision.ok) {
        return normalizeObject(n.activeRevision.value?.claimedAdditionalMetadata);
      }

      // degraded activeRevision - fall back to node-level claimed metadata if present
      return normalizeObject(
        (n as unknown as { claimedAdditionalMetadata?: unknown }).claimedAdditionalMetadata
      );
    }

    return normalizeObject(n.activeRevision.claimedAdditionalMetadata);
  }

  return normalizeObject(
    (n as unknown as { claimedAdditionalMetadata?: unknown }).claimedAdditionalMetadata
  );
}

