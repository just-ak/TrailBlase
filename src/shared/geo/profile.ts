import { haversineDistance, type LatLon, type LatLonEle } from './distance';

/**
 * Profiles: a value plotted against distance along a route or track.
 *
 * One component draws elevation, speed and road class, so the shape of the data
 * is the same for all three and only the band's values differ. Keeping that in
 * one pure module means the chart has no arithmetic in it.
 *
 * A band with no data is **absent**, not a row of zeros. Requirement 5.6 is
 * explicit that an empty band must not be rendered as though it were a
 * measurement, and the easiest way to guarantee that is to make "no data" a
 * representable state here rather than a convention in the renderer.
 */

export interface ProfilePoint {
  /** Cumulative metres from the start. */
  distanceM: number;
  lat: number;
  lon: number;
}

/** Cumulative distance at each point. Index-aligned with the input. */
export function cumulativeDistances(points: readonly LatLon[]): number[] {
  const out: number[] = Array.from({ length: points.length }, () => 0);
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    if (prev === undefined || curr === undefined) continue;
    total += haversineDistance(prev, curr);
    out[i] = total;
  }
  return out;
}

export interface ElevationProfile {
  /** Metres from the start, index-aligned with `elevations`. */
  distancesM: number[];
  /** Metres. Null where the source carried none. */
  elevations: (number | null)[];
  totalDistanceM: number;
  minM: number | null;
  maxM: number | null;
  gainM: number | null;
  lossM: number | null;
}

/**
 * Builds an elevation profile, or returns null when there is no elevation.
 *
 * Null rather than a profile of nulls, so a caller cannot accidentally render
 * an axis for data that does not exist. A route with no barometer and a route
 * at sea level are different facts.
 */
export function elevationProfile(
  points: readonly LatLonEle[],
): ElevationProfile | null {
  if (points.length === 0) return null;

  const withElevation = points.filter(
    (p) => p.ele !== null && Number.isFinite(p.ele),
  );
  if (withElevation.length === 0) return null;

  const distancesM = cumulativeDistances(points);
  const elevations = points.map((p) =>
    p.ele !== null && Number.isFinite(p.ele) ? p.ele : null,
  );

  let min: number | null = null;
  let max: number | null = null;
  let gain = 0;
  let loss = 0;
  let previous: number | null = null;

  // Folded in one pass rather than `Math.min(...xs)`: a 200,000-point track
  // exceeds the argument limit and throws RangeError.
  for (const value of elevations) {
    if (value === null) continue;
    if (min === null || value < min) min = value;
    if (max === null || value > max) max = value;
    if (previous !== null) {
      const delta = value - previous;
      if (delta > 0) gain += delta;
      else loss -= delta;
    }
    previous = value;
  }

  return {
    distancesM,
    elevations,
    totalDistanceM: distancesM.at(-1) ?? 0,
    minM: min,
    maxM: max,
    gainM: gain,
    lossM: loss,
  };
}

/**
 * A stretch of route carrying one categorical or numeric value.
 *
 * Used for the speed and road-class bands, where the value holds over a span
 * rather than at a point.
 */
export interface ProfileSpan<T> {
  startM: number;
  endM: number;
  value: T | null;
}

/**
 * Converts index-based spans into distance-based spans.
 *
 * Map-matched edges are returned as index ranges into a shape; the chart needs
 * distance ranges. Doing the conversion here keeps index arithmetic out of the
 * renderer, where an off-by-one would mis-attribute a stretch of road to the
 * wrong part of the chart and look entirely plausible.
 */
export function spansFromIndices<T>(
  points: readonly LatLon[],
  spans: readonly { startIndex: number; endIndex: number; value: T | null }[],
): ProfileSpan<T>[] {
  const distances = cumulativeDistances(points);
  const last = distances.length - 1;

  const out: ProfileSpan<T>[] = [];
  for (const span of spans) {
    const from = Math.max(0, Math.min(last, span.startIndex));
    const to = Math.max(0, Math.min(last, span.endIndex));
    if (to <= from) continue;
    out.push({
      startM: distances[from] ?? 0,
      endM: distances[to] ?? 0,
      value: span.value,
    });
  }
  return out;
}

/**
 * Thins a profile to at most `maxPoints` for drawing.
 *
 * Even sampling by index, not Douglas-Peucker: this is a chart with a few
 * hundred pixels of width, the x axis is already monotonic, and keeping the
 * endpoints plus every nth point is both cheaper and visually
 * indistinguishable. `simplify.ts` exists for geometry, where shape fidelity
 * matters; here it would be the wrong tool.
 *
 * The caller is expected to tell the user the view is simplified —
 * Requirement 5.7.
 */
export function thinForDisplay<T>(
  values: readonly T[],
  maxPoints: number,
): { values: T[]; simplified: boolean } {
  if (maxPoints < 2 || values.length <= maxPoints) {
    return { values: [...values], simplified: false };
  }

  const step = (values.length - 1) / (maxPoints - 1);
  const out: T[] = [];
  for (let i = 0; i < maxPoints; i += 1) {
    const value = values[Math.round(i * step)];
    if (value !== undefined) out.push(value);
  }
  return { values: out, simplified: true };
}

/**
 * The point on a profile nearest a given distance.
 *
 * Backs the hover sync in both directions (Requirement 5.5). A binary search
 * because a 200,000-point track is profiled from its render cache but can still
 * be thousands of points, and this runs on every pointer move.
 */
export function indexAtDistance(
  distancesM: readonly number[],
  targetM: number,
): number | null {
  if (distancesM.length === 0) return null;

  let low = 0;
  let high = distancesM.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((distancesM[mid] ?? 0) < targetM) low = mid + 1;
    else high = mid;
  }

  // `low` is the first index at or past the target; the neighbour before it may
  // be closer.
  const before = low > 0 ? low - 1 : 0;
  const dBefore = Math.abs((distancesM[before] ?? 0) - targetM);
  const dAt = Math.abs((distancesM[low] ?? 0) - targetM);
  return dBefore < dAt ? before : low;
}
