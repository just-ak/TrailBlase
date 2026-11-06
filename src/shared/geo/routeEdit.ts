import type { RoutePoint } from '../domain/types';
import { haversineDistance, type LatLon } from './distance';

/**
 * Pure array transforms for route geometry.
 *
 * Every edit gesture — move, insert, delete, reorder, reverse — is expressed
 * here as "old array in, new array out". The caller then persists the whole
 * array through `routes:setGeometry`, whose inverse is the same command with
 * the previous array. One command covers all of them, so there is no family of
 * hand-written inverses to drift out of step. See the Phase 2 design.
 *
 * Living in `shared/` means the renderer can compute the new geometry for an
 * immediate visual response while the main process remains the one that
 * validates and persists it.
 */

export function emptyPoint(lat: number, lon: number): RoutePoint {
  return { lat, lon, ele: null, name: null, symbol: null, notes: null };
}

export function appendPoint(
  points: readonly RoutePoint[],
  point: RoutePoint,
): RoutePoint[] {
  return [...points, point];
}

/** Moves a point, preserving its elevation, name, symbol and notes. */
export function movePoint(
  points: readonly RoutePoint[],
  index: number,
  lat: number,
  lon: number,
): RoutePoint[] {
  const existing = points[index];
  if (existing === undefined) return [...points];
  const next = [...points];
  // Elevation belongs to the old position and is now unknown for the new one.
  // Keeping the stale value would be inventing data; null is the honest answer.
  next[index] = { ...existing, lat, lon, ele: null };
  return next;
}

export function deletePoint(
  points: readonly RoutePoint[],
  index: number,
): RoutePoint[] {
  if (index < 0 || index >= points.length) return [...points];
  return points.filter((_, i) => i !== index);
}

/** Inserts at `index`, shifting the rest along. */
export function insertPointAt(
  points: readonly RoutePoint[],
  index: number,
  point: RoutePoint,
): RoutePoint[] {
  const clamped = Math.max(0, Math.min(points.length, index));
  return [...points.slice(0, clamped), point, ...points.slice(clamped)];
}

export function reversePoints(points: readonly RoutePoint[]): RoutePoint[] {
  return points.toReversed();
}

/**
 * Moves the point at `from` to `to`, for drag-reordering a point list.
 *
 * `to` is the index in the **resulting** array, after the point has been
 * removed — the standard array-move convention. So moving index 0 to index 2 of
 * a three-point route yields `[1, 2, 0]`, not `[1, 0, 2]`. Worth stating,
 * because the other reading is equally plausible and silently off by one.
 */
export function reorderPoint(
  points: readonly RoutePoint[],
  from: number,
  to: number,
): RoutePoint[] {
  const moved = points[from];
  if (moved === undefined) return [...points];
  const without = points.filter((_, i) => i !== from);
  const target = Math.max(0, Math.min(without.length, to));
  return [...without.slice(0, target), moved, ...without.slice(target)];
}

export interface SegmentHit {
  /** Index to insert at, i.e. the end vertex of the matched segment. */
  insertIndex: number;
  /** Closest point on that segment. */
  lat: number;
  lon: number;
  distanceM: number;
}

/**
 * Finds the closest point on a polyline to a given position.
 *
 * Used for click-on-segment insertion. Projection is done in a local planar
 * approximation — longitude scaled by cos(latitude) — rather than on the
 * sphere. Over a single route segment the error is far below the pixel the user
 * clicked, and it avoids a great-circle projection for no visible gain.
 */
export function closestSegment(
  points: readonly RoutePoint[],
  target: LatLon,
): SegmentHit | null {
  if (points.length < 2) return null;

  const scale = Math.cos((target.lat * Math.PI) / 180);
  const toPlane = (p: LatLon): [number, number] => [p.lon * scale, p.lat];
  const [tx, ty] = toPlane(target);

  let best: SegmentHit | null = null;

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined) continue;

    const [ax, ay] = toPlane(a);
    const [bx, by] = toPlane(b);
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;

    // A zero-length segment (duplicate points) projects onto its own vertex.
    const t =
      lengthSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((tx - ax) * dx + (ty - ay) * dy) / lengthSq));

    const lon = (ax + t * dx) / scale;
    const lat = ay + t * dy;
    const distanceM = haversineDistance(target, { lat, lon });

    if (best === null || distanceM < best.distanceM) {
      best = { insertIndex: i, lat, lon, distanceM };
    }
  }

  return best;
}

/** Index of the vertex nearest a position, or null for an empty route. */
export function closestVertex(
  points: readonly RoutePoint[],
  target: LatLon,
): { index: number; distanceM: number } | null {
  let best: { index: number; distanceM: number } | null = null;
  for (const [index, point] of points.entries()) {
    const distanceM = haversineDistance(target, point);
    if (best === null || distanceM < best.distanceM) {
      best = { index, distanceM };
    }
  }
  return best;
}
