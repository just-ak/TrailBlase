import type { UnitSystem } from '@shared/domain/types';
import type { LatLon } from '@shared/geo/distance';
import { haversineDistance } from '@shared/geo/distance';
import {
  recordedSpeedMps,
  speedDistribution,
  type SpeedDistribution,
  type SpeedSample,
} from '@shared/geo/speedBands';
import type {
  MatchedEdge,
  RoutingProvider,
  TransportMode,
} from '@shared/routing/RoutingProvider';
import type {
  AttributeOwnerType,
  AttributeStatus,
} from '@shared/routing/results';
import type { Db } from '../db/client';
import * as cache from '../db/repositories/roadAttributes';
import { ServiceError } from './errors';
import * as routeService from './routeService';
import * as trackService from './trackService';

/**
 * Road attributes: posted speed limits and road classes along a geometry.
 *
 * ## This service never modifies geometry
 *
 * Map matching here is a **read**. It takes a shape, asks a provider what roads
 * it follows, and caches the answer. Requirement 3.7 and ADR 0011 §4 forbid
 * moving a track's points onto a road, because a recording is measured data,
 * and nothing in this file writes to `track_points` or `route_points`.
 *
 * ## Two speed series that never merge
 *
 * A **posted limit** is an attribute of the road, available for routes and
 * tracks alike once matched. A **recorded speed** comes from a track's own
 * timestamps and exists only where it has them. They are different facts with
 * different reliability, so they are computed by different functions, labelled
 * at the boundary, and never summed into one distribution. ADR 0011 §1.
 */

export type { AttributeOwnerType, AttributeStatus } from '@shared/routing/results';

/**
 * The geometry that is sent for matching, and that matched edge indices refer
 * back into.
 *
 * Exported because the profile has to resolve edge indices against exactly the
 * array that was matched. Resolving them against anything else — a track's full
 * points, say — would silently shift every road-class and speed band.
 */
export function matchedGeometry(
  db: Db,
  ownerType: AttributeOwnerType,
  ownerId: string,
): LatLon[] {
  return geometryOf(db, ownerType, ownerId);
}

function geometryOf(
  db: Db,
  ownerType: AttributeOwnerType,
  ownerId: string,
): LatLon[] {
  if (ownerType === 'route') {
    return routeService
      .get(db, ownerId)
      .points.map((p) => ({ lat: p.lat, lon: p.lon }));
  }

  /*
   * Tracks are matched from their **render cache**, not their full geometry.
   *
   * A 200,000-point track would be a request body of tens of megabytes and a
   * matching job far beyond what a provider will accept. The cache is a
   * simplified version of the same line, which is the right input for asking
   * "which roads does this follow" — the answer does not change at 11 cm
   * resolution. Matching the exact samples would also be slower and no more
   * correct.
   */
  const geometry = trackService.geometryFor(db, ownerId, 0);
  return geometry.segments.flatMap((segment) =>
    segment.points.map((p) => ({ lat: p.lat, lon: p.lon })),
  );
}

/**
 * Matches a geometry and caches the result.
 *
 * Returns the cached answer without calling the provider when the geometry has
 * not changed, which is what Requirement 6.2 asks for and what keeps a
 * properties panel from issuing a request on every selection.
 */
export async function match(
  db: Db,
  input: {
    ownerType: AttributeOwnerType;
    ownerId: string;
    provider: RoutingProvider;
    mode: TransportMode;
    /** Re-match even when the cache is fresh. For an explicit refresh. */
    force?: boolean | undefined;
  },
): Promise<AttributeStatus> {
  const shape = geometryOf(db, input.ownerType, input.ownerId);

  if (shape.length < 2) {
    throw new ServiceError(
      'INVALID_REQUEST',
      'There is not enough geometry here to match against roads.',
    );
  }

  const hash = cache.geometryHash(shape);

  if (input.force !== true) {
    const fresh = cache.findFresh(db, input.ownerType, input.ownerId, hash);
    if (fresh !== null) {
      return {
        provider: fresh.provider,
        fetchedAt: fresh.fetchedAt,
        stale: false,
        edgeCount: fresh.payload.edges.length,
        unmatchedPointCount: fresh.payload.unmatchedPointCount,
      };
    }
  }

  const result = await input.provider.match(shape, input.mode);
  const fetchedAt = Date.now();

  cache.upsert(db, {
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    provider: result.provider,
    // Hashed from the geometry we sent, not from what came back. The provider
    // returns a snapped shape, and hashing that would invalidate the cache on
    // the very next read.
    geometryHash: hash,
    fetchedAt,
    payload: {
      mode: result.mode,
      edges: result.edges,
      unmatchedPointCount: result.unmatchedPointCount,
    },
  });

  return {
    provider: result.provider,
    fetchedAt,
    stale: false,
    edgeCount: result.edges.length,
    unmatchedPointCount: result.unmatchedPointCount,
  };
}

/**
 * Reads cached attributes, reporting whether they are stale.
 *
 * Stale data is returned rather than hidden, because Requirement 8.4 asks for
 * exactly that when a provider is unreachable: what we have, labelled with its
 * age, beats an empty panel. The caller must show the age.
 */
export function cached(
  db: Db,
  ownerType: AttributeOwnerType,
  ownerId: string,
): { status: AttributeStatus; edges: MatchedEdge[] } | null {
  const row = cache.findAny(db, ownerType, ownerId);
  if (row === null) return null;

  const shape = geometryOf(db, ownerType, ownerId);
  const stale = cache.geometryHash(shape) !== row.geometryHash;

  return {
    status: {
      provider: row.provider,
      fetchedAt: row.fetchedAt,
      stale,
      edgeCount: row.payload.edges.length,
      unmatchedPointCount: row.payload.unmatchedPointCount,
    },
    edges: row.payload.edges,
  };
}

/**
 * Turns matched edges into distance-weighted speed samples.
 *
 * Every edge contributes its own length, and **any part of the geometry no edge
 * covers contributes an Unknown sample of the right size**. That second half is
 * what makes the Unknown band honest: without it, a route that matched only a
 * third of its length would report a distribution over that third and look
 * fully characterised.
 */
export function postedSpeedSamples(
  shape: readonly LatLon[],
  edges: readonly MatchedEdge[],
): SpeedSample[] {
  const samples: SpeedSample[] = [];
  const covered = new Set<number>();

  for (const edge of edges) {
    const from = Math.max(0, Math.min(shape.length - 1, edge.startIndex));
    const to = Math.max(0, Math.min(shape.length - 1, edge.endIndex));
    if (to <= from) continue;

    // Measured from our own geometry rather than trusting the reported length:
    // the provider's figure covers its matched edge, which may extend beyond
    // the part of it our shape actually traverses.
    let distanceM = 0;
    for (let i = from; i < to; i += 1) {
      const a = shape[i];
      const b = shape[i + 1];
      if (a === undefined || b === undefined) continue;
      distanceM += haversineDistance(a, b);
      covered.add(i);
    }

    samples.push({ distanceM, speedMps: edge.speedLimitMps });
  }

  // Everything no edge claimed.
  let unknownM = 0;
  for (let i = 0; i < shape.length - 1; i += 1) {
    if (covered.has(i)) continue;
    const a = shape[i];
    const b = shape[i + 1];
    if (a === undefined || b === undefined) continue;
    unknownM += haversineDistance(a, b);
  }
  if (unknownM > 0) samples.push({ distanceM: unknownM, speedMps: null });

  return samples;
}

/** Posted-limit distribution from the cache, or null when nothing is cached. */
export function postedDistribution(
  db: Db,
  ownerType: AttributeOwnerType,
  ownerId: string,
  units: UnitSystem,
): { distribution: SpeedDistribution; status: AttributeStatus } | null {
  const entry = cached(db, ownerType, ownerId);
  if (entry === null) return null;

  const shape = geometryOf(db, ownerType, ownerId);
  return {
    distribution: speedDistribution(
      postedSpeedSamples(shape, entry.edges),
      units,
      'posted',
    ),
    status: entry.status,
  };
}

/**
 * Recorded-speed distribution for a track.
 *
 * Needs no provider: the data is in the track's own timestamps. Returns null
 * when the recording is untimed, which is a different answer from "all speeds
 * unknown" — one means the question cannot be asked, the other means it was
 * asked and nothing came back.
 */
export function recordedDistribution(
  db: Db,
  trackId: string,
  units: UnitSystem,
): SpeedDistribution | null {
  const track = trackService.get(db, trackId);
  if (track.startedAt === null) return null;

  const samples: SpeedSample[] = [];

  for (const segment of track.segments) {
    for (let i = 0; i < segment.points.length - 1; i += 1) {
      const a = segment.points[i];
      const b = segment.points[i + 1];
      if (a === undefined || b === undefined) continue;

      const distanceM = haversineDistance(a, b);
      samples.push({
        distanceM,
        // Null for an untimed pair, which lands it in Unknown rather than
        // being dropped — the distance was still travelled.
        speedMps: recordedSpeedMps(distanceM, a.time, b.time),
      });
    }
  }

  return speedDistribution(samples, units, 'recorded');
}

export function clear(
  db: Db,
  ownerType: AttributeOwnerType,
  ownerId: string,
): void {
  cache.remove(db, ownerType, ownerId);
}
