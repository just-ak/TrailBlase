import { describe, expect, it } from 'vitest';
import {
  decodePolyline,
  decodeValhallaShape,
  encodePolyline,
  GOOGLE_PRECISION,
  PolylineError,
  VALHALLA_PRECISION,
} from './polyline';

describe('decodePolyline', () => {
  /*
   * The canonical example from Google's encoded-polyline documentation, which
   * every implementation of this algorithm is expected to reproduce. Decoding
   * it correctly is evidence that this is the standard algorithm and not an
   * approximation of it — which matters, because the only other check available
   * is a round trip against our own encoder, and that would pass even if both
   * halves were wrong in the same way.
   */
  const GOOGLE_EXAMPLE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

  it('reproduces the documented precision-5 example', () => {
    const points = decodePolyline(GOOGLE_EXAMPLE, GOOGLE_PRECISION);
    expect(points).toHaveLength(3);
    expect(points[0]?.lat).toBeCloseTo(38.5, 5);
    expect(points[0]?.lon).toBeCloseTo(-120.2, 5);
    expect(points[1]?.lat).toBeCloseTo(40.7, 5);
    expect(points[1]?.lon).toBeCloseTo(-120.95, 5);
    expect(points[2]?.lat).toBeCloseTo(43.252, 5);
    expect(points[2]?.lon).toBeCloseTo(-126.453, 5);
  });

  /*
   * The trap this module exists to prevent.
   *
   * Valhalla encodes at precision 6. Decoding its output at precision 5 does
   * not throw — it silently returns coordinates ten times too large, which puts
   * an Alpine route somewhere past the north pole. The symptom is a blank map,
   * and the usual first guess is a network problem.
   */
  it('is wrong by a factor of ten at the wrong precision, silently', () => {
    const alps = [{ lat: 46.5197, lon: 8.012 }];
    const encoded = encodePolyline(alps, VALHALLA_PRECISION);

    const correct = decodePolyline(encoded, VALHALLA_PRECISION);
    expect(correct[0]?.lat).toBeCloseTo(46.5197, 6);

    const wrong = decodePolyline(encoded, GOOGLE_PRECISION);
    // No exception, just a nonsensical coordinate.
    expect(wrong[0]?.lat).toBeCloseTo(465.197, 3);
    expect(Math.abs(wrong[0]?.lat ?? 0)).toBeGreaterThan(90);
  });

  it('rejects an out-of-range precision rather than guessing', () => {
    expect(() => decodePolyline('abc', 0)).toThrow(PolylineError);
    expect(() => decodePolyline('abc', 12)).toThrow(PolylineError);
    expect(() => decodePolyline('abc', 6.5)).toThrow(PolylineError);
  });

  it('decodes an empty string to no points', () => {
    expect(decodePolyline('', VALHALLA_PRECISION)).toEqual([]);
  });

  it('throws on a truncated string rather than returning a partial point', () => {
    const encoded = encodePolyline(
      [
        { lat: 46.5, lon: 8 },
        { lat: 46.6, lon: 8.1 },
      ],
      VALHALLA_PRECISION,
    );
    // Dropping the final character leaves a coordinate half-read.
    expect(() =>
      decodePolyline(encoded.slice(0, -1), VALHALLA_PRECISION),
    ).toThrow(/truncated/);
  });
});

describe('round trip at Valhalla precision', () => {
  it('preserves six decimal places exactly', () => {
    const points = [
      { lat: 46.519712, lon: 8.012012 },
      { lat: 46.523145, lon: 8.016899 },
      { lat: 46.531001, lon: 8.025512 },
    ];

    const decoded = decodeValhallaShape(
      encodePolyline(points, VALHALLA_PRECISION),
    );

    expect(decoded).toHaveLength(points.length);
    for (const [index, point] of points.entries()) {
      expect(decoded[index]?.lat).toBeCloseTo(point.lat, 6);
      expect(decoded[index]?.lon).toBeCloseTo(point.lon, 6);
    }
  });

  // Six decimals is about 11 cm. Anything finer is lost, which is acceptable
  // for road geometry but must be a known limit rather than a surprise.
  it('quantises below six decimals, which is the format not a bug', () => {
    const decoded = decodeValhallaShape(
      encodePolyline([{ lat: 46.5197129999, lon: 8.0120129999 }], VALHALLA_PRECISION),
    );
    expect(decoded[0]?.lat).toBeCloseTo(46.519713, 6);
    expect(decoded[0]?.lat).not.toBe(46.5197129999);
  });

  it('handles negative and zero coordinates', () => {
    const points = [
      { lat: 0, lon: 0 },
      { lat: -33.8688, lon: 151.2093 },
      { lat: -54.8019, lon: -68.303 },
    ];
    const decoded = decodeValhallaShape(
      encodePolyline(points, VALHALLA_PRECISION),
    );
    for (const [index, point] of points.entries()) {
      expect(decoded[index]?.lat).toBeCloseTo(point.lat, 6);
      expect(decoded[index]?.lon).toBeCloseTo(point.lon, 6);
    }
  });

  it('handles a crossing of the antimeridian', () => {
    const points = [
      { lat: 0, lon: 179.999999 },
      { lat: 0, lon: -179.999999 },
    ];
    const decoded = decodeValhallaShape(
      encodePolyline(points, VALHALLA_PRECISION),
    );
    expect(decoded[0]?.lon).toBeCloseTo(179.999999, 6);
    expect(decoded[1]?.lon).toBeCloseTo(-179.999999, 6);
  });

  it('survives a long shape', () => {
    const points = Array.from({ length: 20_000 }, (_, i) => ({
      lat: 46.5 + i * 1e-5,
      lon: 8 + i * 1e-5,
    }));
    const decoded = decodeValhallaShape(
      encodePolyline(points, VALHALLA_PRECISION),
    );
    expect(decoded).toHaveLength(20_000);
    expect(decoded.at(-1)?.lat).toBeCloseTo(points.at(-1)?.lat as number, 6);
  });

  it('encodes a repeated point as a zero delta rather than dropping it', () => {
    const points = [
      { lat: 46.5, lon: 8 },
      { lat: 46.5, lon: 8 },
    ];
    expect(
      decodeValhallaShape(encodePolyline(points, VALHALLA_PRECISION)),
    ).toHaveLength(2);
  });

  it('round-trips an empty list', () => {
    expect(encodePolyline([], VALHALLA_PRECISION)).toBe('');
  });
});
