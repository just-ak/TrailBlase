import { createHash, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { LatLon } from '@shared/geo/distance';
import type { MatchedEdge, TransportMode } from '@shared/routing/RoutingProvider';
import type { AttributeOwnerType } from '@shared/routing/results';
import type { Db } from '../client';
import { roadAttributes } from '../schema';

/**
 * The map-matched road attribute cache.
 *
 * A cache in the strict sense the architecture steering means: rebuildable from
 * the geometry plus a provider call, invalidated when the geometry changes, and
 * never the only copy of anything.
 *
 * Invalidation is by **content hash rather than by timestamp or a hook**. A
 * hook is something a future caller forgets; a `updatedAt` comparison breaks
 * the moment two edits land in the same millisecond. Recomputing the hash on
 * every read costs one pass over the coordinates and cannot go stale silently.
 */

export type { AttributeOwnerType } from '@shared/routing/results';

export interface RoadAttributePayload {
  mode: TransportMode;
  edges: MatchedEdge[];
  /** Points the provider could not match. Reported, never hidden. */
  unmatchedPointCount: number;
}

export interface CachedAttributes {
  provider: string;
  fetchedAt: number;
  payload: RoadAttributePayload;
}

/**
 * Fingerprints a geometry.
 *
 * Coordinates are rounded to six decimals — about 11 cm — before hashing. Two
 * reasons: it is far finer than any road-matching tolerance, and it stops a
 * float representation difference between a write and a read from presenting as
 * an invalidated cache. Rounding further would risk a real edit hashing the
 * same.
 *
 * The point count is mixed in so that a geometry which is a prefix of another
 * cannot collide with it.
 */
export function geometryHash(points: readonly LatLon[]): string {
  const hash = createHash('sha256');
  hash.update(`${points.length}:`);
  for (const point of points) {
    hash.update(`${point.lat.toFixed(6)},${point.lon.toFixed(6)};`);
  }
  return hash.digest('hex');
}

/**
 * Reads the cache, returning null when it is absent **or stale**.
 *
 * A stale row is not deleted here: a read is not a write, and the row is
 * overwritten by the next successful match anyway. Returning null is what
 * matters, because it means a caller can never be handed attributes computed
 * for different geometry.
 */
export function findFresh(
  db: Db,
  ownerType: AttributeOwnerType,
  ownerId: string,
  currentHash: string,
): CachedAttributes | null {
  const row = db
    .select()
    .from(roadAttributes)
    .where(
      and(
        eq(roadAttributes.ownerType, ownerType),
        eq(roadAttributes.ownerId, ownerId),
      ),
    )
    .get();

  if (row === undefined) return null;
  if (row.geometryHash !== currentHash) return null;

  return decode(row);
}

/**
 * Reads the cache regardless of staleness.
 *
 * Used for the "provider unreachable" path in Requirement 8.4: showing what we
 * have with its fetch date beats showing nothing. The caller is responsible for
 * labelling it, which is why this is a separate function rather than a flag —
 * an optional parameter would eventually be passed by accident.
 */
export function findAny(
  db: Db,
  ownerType: AttributeOwnerType,
  ownerId: string,
): (CachedAttributes & { stale: boolean; geometryHash: string }) | null {
  const row = db
    .select()
    .from(roadAttributes)
    .where(
      and(
        eq(roadAttributes.ownerType, ownerType),
        eq(roadAttributes.ownerId, ownerId),
      ),
    )
    .get();

  if (row === undefined) return null;
  const decoded = decode(row);
  return decoded === null
    ? null
    : { ...decoded, stale: false, geometryHash: row.geometryHash };
}

function decode(
  row: typeof roadAttributes.$inferSelect,
): CachedAttributes | null {
  try {
    const parsed: unknown = JSON.parse(row.payload);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !Array.isArray((parsed as RoadAttributePayload).edges)
    ) {
      return null;
    }
    return {
      provider: row.provider,
      fetchedAt: row.fetchedAt,
      payload: parsed as RoadAttributePayload,
    };
  } catch {
    // A row written by a future version, or damaged. Treated as a cache miss,
    // which is always safe: the worst outcome is one extra provider call.
    return null;
  }
}

export function upsert(
  db: Db,
  values: {
    ownerType: AttributeOwnerType;
    ownerId: string;
    provider: string;
    geometryHash: string;
    fetchedAt: number;
    payload: RoadAttributePayload;
  },
): void {
  db.insert(roadAttributes)
    .values({
      id: randomUUID(),
      ownerType: values.ownerType,
      ownerId: values.ownerId,
      provider: values.provider,
      geometryHash: values.geometryHash,
      fetchedAt: values.fetchedAt,
      payload: JSON.stringify(values.payload),
    })
    // One row per object: re-matching replaces rather than accumulates, so the
    // table cannot grow with edit history.
    .onConflictDoUpdate({
      target: [roadAttributes.ownerType, roadAttributes.ownerId],
      set: {
        provider: values.provider,
        geometryHash: values.geometryHash,
        fetchedAt: values.fetchedAt,
        payload: JSON.stringify(values.payload),
      },
    })
    .run();
}

export function remove(
  db: Db,
  ownerType: AttributeOwnerType,
  ownerId: string,
): void {
  db.delete(roadAttributes)
    .where(
      and(
        eq(roadAttributes.ownerType, ownerType),
        eq(roadAttributes.ownerId, ownerId),
      ),
    )
    .run();
}
