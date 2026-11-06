import type { LatLon } from '@shared/geo/distance';

/**
 * Encoded polyline codec.
 *
 * Google's algorithm, which Valhalla also uses — **but at precision 6, not the
 * precision 5 that most documentation and most library defaults assume.**
 *
 * That mismatch is the single most dangerous detail in this integration,
 * because it fails quietly. Decoding a precision-6 string at precision 5 yields
 * coordinates ten times too large: a point in the Alps lands in the Arctic
 * Ocean, or off the planet entirely. Nothing throws. The map simply shows
 * nothing and the bug looks like a networking problem.
 *
 * Hence: the factor is a required argument with no default, and
 * `polyline.test.ts` asserts the ten-fold error explicitly so the trap is
 * documented by a failing-if-changed test rather than a comment.
 */

/** Valhalla's shape precision. */
export const VALHALLA_PRECISION = 6;

/** The precision most other services and libraries use. Here for contrast. */
export const GOOGLE_PRECISION = 5;

export class PolylineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolylineError';
  }
}

/**
 * Decodes an encoded polyline.
 *
 * `precision` is the number of decimal places the encoder used — 6 for
 * Valhalla, 5 for Google. There is deliberately no default.
 */
export function decodePolyline(
  encoded: string,
  precision: number,
): LatLon[] {
  if (!Number.isInteger(precision) || precision < 1 || precision > 9) {
    throw new PolylineError(
      `Polyline precision must be an integer between 1 and 9, got ${precision}.`,
    );
  }

  const factor = 10 ** precision;
  const points: LatLon[] = [];

  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    // Each coordinate is a varint of 5-bit chunks, zig-zag encoded so that a
    // negative delta survives the shift.
    let result = 1;
    let shift = 0;
    let byte: number;

    do {
      if (index >= encoded.length) {
        throw new PolylineError(
          'Encoded polyline ended mid-coordinate; the string is truncated.',
        );
      }
      byte = encoded.charCodeAt(index) - 63 - 1;
      index += 1;
      result += byte << shift;
      shift += 5;
    } while (byte >= 0x1f);

    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 1;
    shift = 0;

    do {
      if (index >= encoded.length) {
        throw new PolylineError(
          'Encoded polyline ended mid-coordinate; the string is truncated.',
        );
      }
      byte = encoded.charCodeAt(index) - 63 - 1;
      index += 1;
      result += byte << shift;
      shift += 5;
    } while (byte >= 0x1f);

    lon += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / factor, lon: lon / factor });
  }

  return points;
}

/**
 * Encodes a polyline.
 *
 * Used to send a long shape to `trace_attributes` without a multi-megabyte
 * JSON array of coordinate objects — the Valhalla docs note that shape input
 * can be large and recommend POST for exactly this reason.
 */
export function encodePolyline(
  points: readonly LatLon[],
  precision: number,
): string {
  const factor = 10 ** precision;
  let output = '';
  let lastLat = 0;
  let lastLon = 0;

  for (const point of points) {
    const lat = Math.round(point.lat * factor);
    const lon = Math.round(point.lon * factor);
    output += encodeSigned(lat - lastLat);
    output += encodeSigned(lon - lastLon);
    lastLat = lat;
    lastLon = lon;
  }

  return output;
}

function encodeSigned(value: number): string {
  let shifted = value < 0 ? ~(value << 1) : value << 1;
  let output = '';
  while (shifted >= 0x20) {
    output += String.fromCharCode((0x20 | (shifted & 0x1f)) + 63);
    shifted >>= 5;
  }
  output += String.fromCharCode(shifted + 63);
  return output;
}

/** Convenience for the only precision this project's adapter uses. */
export function decodeValhallaShape(encoded: string): LatLon[] {
  return decodePolyline(encoded, VALHALLA_PRECISION);
}
