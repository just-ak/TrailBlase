import type { LatLon } from './distance';

/**
 * Douglas-Peucker polyline simplification.
 *
 * Used for two different purposes, which is why it lives in `shared/`:
 * building the map's render cache for a large track, and the user-initiated
 * "simplify track" action.
 *
 * Distances are computed in a local planar approximation — longitude scaled by
 * cos(latitude) — rather than on the sphere. Over the span of a single track
 * the error is far below any tolerance a user would choose, and it keeps the
 * inner loop cheap, which matters at 200,000 points.
 *
 * Implemented iteratively with an explicit stack. The recursive form is
 * clearer, but a pathological track can nest deeply enough to overflow, and a
 * stack overflow on import is not an acceptable failure mode.
 */

const METRES_PER_DEGREE = 111_320;

/** Perpendicular distance from `point` to the segment `a`–`b`, in metres. */
function perpendicularDistance(point: LatLon, a: LatLon, b: LatLon): number {
  const scale = Math.cos((point.lat * Math.PI) / 180);

  const px = point.lon * scale;
  const py = point.lat;
  const ax = a.lon * scale;
  const ay = a.lat;
  const bx = b.lon * scale;
  const by = b.lat;

  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    // Degenerate segment: fall back to the distance from the shared endpoint.
    const ex = px - ax;
    const ey = py - ay;
    return Math.sqrt(ex * ex + ey * ey) * METRES_PER_DEGREE;
  }

  const t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  const clamped = Math.max(0, Math.min(1, t));
  const cx = ax + clamped * dx;
  const cy = ay + clamped * dy;

  const ex = px - cx;
  const ey = py - cy;
  return Math.sqrt(ex * ex + ey * ey) * METRES_PER_DEGREE;
}

/**
 * Returns the indices to keep, in ascending order.
 *
 * Indices rather than points, so a caller can carry along whatever per-point
 * data it has — elevation, timestamps — without this function knowing about it.
 */
export function simplifyIndices(
  points: readonly LatLon[],
  toleranceM: number,
): number[] {
  if (points.length <= 2) return points.map((_, i) => i);
  if (toleranceM <= 0) return points.map((_, i) => i);

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  // [start, end] index pairs still to examine.
  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    const [start, end] = frame;
    if (end - start < 2) continue;

    const a = points[start];
    const b = points[end];
    if (a === undefined || b === undefined) continue;

    let farthest = -1;
    let farthestDistance = -1;

    for (let i = start + 1; i < end; i += 1) {
      const candidate = points[i];
      if (candidate === undefined) continue;
      const distance = perpendicularDistance(candidate, a, b);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthest = i;
      }
    }

    if (farthest > 0 && farthestDistance > toleranceM) {
      keep[farthest] = 1;
      stack.push([start, farthest], [farthest, end]);
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < keep.length; i += 1) {
    if (keep[i] === 1) indices.push(i);
  }
  return indices;
}

/** Convenience wrapper preserving the element type. */
export function simplify<T extends LatLon>(
  points: readonly T[],
  toleranceM: number,
): T[] {
  const indices = simplifyIndices(points, toleranceM);
  const result: T[] = [];
  for (const index of indices) {
    const point = points[index];
    if (point !== undefined) result.push(point);
  }
  return result;
}

/**
 * Tolerance for the map's render cache at a given zoom.
 *
 * Roughly half a screen pixel at that zoom, so simplification is invisible
 * while cutting the point count enormously on a recorded track. Web Mercator
 * at zoom z has 256·2^z pixels for 360° of longitude.
 */
export function toleranceForZoom(zoom: number): number {
  const metresPerPixel = (METRES_PER_DEGREE * 360) / (256 * 2 ** zoom);
  return metresPerPixel / 2;
}
