import type { LatLon } from './distance';

/**
 * Bearings and turn angles.
 *
 * The first angle maths in the project. Phase 4 needs it for the road-class and
 * profile bands; Phase 5 needs it for curvature scoring, which is why it is a
 * module of its own rather than a helper inside a consumer.
 *
 * Great-circle throughout, not the planar approximation used by `simplify.ts`
 * and `routeEdit.ts`. Those approximate because they compare distances over a
 * few hundred metres where the error is far below a screen pixel. A bearing is
 * an absolute direction, the error grows with latitude, and a curvature score
 * built on a biased bearing would be wrong in a way that looks plausible.
 */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/**
 * Initial bearing from `a` to `b`, in degrees clockwise from true north.
 *
 * "Initial" matters on a great circle: the bearing changes along the path, so
 * the value at the start is not the value at the end. Over a road segment the
 * difference is negligible, but naming it honestly avoids someone assuming
 * otherwise later.
 *
 * Returns a value in [0, 360). Null for coincident points, because two points
 * in the same place have no direction between them — not 0, which would read
 * as "due north".
 */
export function initialBearing(a: LatLon, b: LatLon): number | null {
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const dLon = (b.lon - a.lon) * DEG;

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  // Both zero means the points are coincident (or exactly antipodal, where a
  // bearing is genuinely undefined). Either way there is no answer to give.
  if (x === 0 && y === 0) return null;

  return normaliseBearing(Math.atan2(y, x) * RAD);
}

/** Wraps any angle into [0, 360). */
export function normaliseBearing(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * Signed difference between two bearings, in (-180, 180].
 *
 * Positive is a right turn, negative a left turn. Signed rather than absolute
 * because consecutive same-signed turns are a sequence of bends while
 * alternating signs are a wiggle, and curvature scoring needs to tell them
 * apart.
 *
 * The wrap is the whole reason this function exists: 350° to 10° is a 20° right
 * turn, not a 340° left one.
 */
export function bearingDelta(from: number, to: number): number {
  const delta = ((to - from + 540) % 360) - 180;
  // `-180` and `180` are the same turn; normalising to +180 keeps the range
  // half-open and the sign predictable.
  return delta === -180 ? 180 : delta;
}

/**
 * Turn angle at `b` on the path a → b → c, in degrees.
 *
 * Zero is straight ahead. Null when either leg has no bearing, which happens
 * with a duplicated point — a repeated coordinate is not a hairpin, and
 * returning 0 would claim it was straight.
 */
export function turnAngle(a: LatLon, b: LatLon, c: LatLon): number | null {
  const incoming = initialBearing(a, b);
  const outgoing = initialBearing(b, c);
  if (incoming === null || outgoing === null) return null;
  return bearingDelta(incoming, outgoing);
}

/**
 * Turn angle at every interior vertex of a polyline.
 *
 * Returns `points.length` entries with `null` at both ends, so an index into
 * this array is an index into the input. Returning a shorter array would make
 * every caller juggle an offset, which is exactly the kind of off-by-one that
 * silently mis-attributes a bend to the wrong place.
 */
export function turnAngles(points: readonly LatLon[]): (number | null)[] {
  const angles: (number | null)[] = Array.from(
    { length: points.length },
    () => null,
  );
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const c = points[i + 1];
    if (a === undefined || b === undefined || c === undefined) continue;
    angles[i] = turnAngle(a, b, c);
  }
  return angles;
}
