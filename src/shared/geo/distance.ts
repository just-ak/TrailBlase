/**
 * Pure geometry maths. No dependencies, so import, statistics and the map can
 * all share it and unit tests need no Electron.
 *
 * All inputs are decimal degrees; all outputs are metres.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

export interface LatLonEle extends LatLon {
  /** Metres, or null when the source carried no elevation. */
  ele: number | null;
}

/** IUGG mean Earth radius in metres. */
const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Great-circle distance between two points, in metres.
 *
 * Haversine is used rather than Vincenty: for the distances involved in trip
 * planning the spherical error is well under the GPS noise floor, and it has no
 * convergence failure modes.
 */
export function haversineDistance(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cumulative length of a polyline, in metres. Fewer than two points is 0. */
export function pathDistance(points: readonly LatLon[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    if (prev === undefined || curr === undefined) continue;
    total += haversineDistance(prev, curr);
  }
  return total;
}

export interface ElevationStats {
  /** Null when no point carries elevation — never 0. */
  gain: number | null;
  loss: number | null;
  min: number | null;
  max: number | null;
}

/**
 * Cumulative ascent and descent.
 *
 * Returns nulls when the input carries no elevation at all, rather than zeros.
 * A flat route and a route with unknown elevation are different facts and the
 * UI must be able to tell them apart. See `.kiro/steering/architecture.md`.
 */
export function elevationStats(points: readonly LatLonEle[]): ElevationStats {
  const elevations = points
    .map((p) => p.ele)
    .filter((e): e is number => e !== null && Number.isFinite(e));

  if (elevations.length === 0) {
    return { gain: null, loss: null, min: null, max: null };
  }

  let gain = 0;
  let loss = 0;
  for (let i = 1; i < elevations.length; i += 1) {
    const prev = elevations[i - 1];
    const curr = elevations[i];
    if (prev === undefined || curr === undefined) continue;
    const delta = curr - prev;
    if (delta > 0) gain += delta;
    else loss -= delta;
  }

  return {
    gain,
    loss,
    min: Math.min(...elevations),
    max: Math.max(...elevations),
  };
}

export interface BoundingBox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

/** Null for an empty input: there is no such thing as an empty bounding box. */
export function boundingBox(points: readonly LatLon[]): BoundingBox | null {
  const first = points[0];
  if (first === undefined) return null;

  let minLat = first.lat;
  let maxLat = first.lat;
  let minLon = first.lon;
  let maxLon = first.lon;

  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }

  return { minLat, minLon, maxLat, maxLon };
}

export const isValidLat = (lat: number): boolean =>
  Number.isFinite(lat) && lat >= -90 && lat <= 90;

export const isValidLon = (lon: number): boolean =>
  Number.isFinite(lon) && lon >= -180 && lon <= 180;
