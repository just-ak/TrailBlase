import { describe, expect, it } from 'vitest';
import {
  boundingBox,
  elevationStats,
  haversineDistance,
  isValidLat,
  isValidLon,
  pathDistance,
} from './distance';

describe('haversineDistance', () => {
  it('is zero for identical points', () => {
    expect(haversineDistance({ lat: 46.8, lon: 8.2 }, { lat: 46.8, lon: 8.2 })).toBe(0);
  });

  it('matches a known reference distance', () => {
    // Greenwich observatory to the Eiffel Tower, ~334 km.
    const d = haversineDistance(
      { lat: 51.4769, lon: -0.0005 },
      { lat: 48.8584, lon: 2.2945 },
    );
    expect(d).toBeGreaterThan(333_000);
    expect(d).toBeLessThan(336_000);
  });

  it('approximates one degree of latitude as ~111 km', () => {
    const d = haversineDistance({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });

  it('is symmetric', () => {
    const a = { lat: 10, lon: 20 };
    const b = { lat: -30, lon: 140 };
    expect(haversineDistance(a, b)).toBeCloseTo(haversineDistance(b, a), 6);
  });

  it('handles antipodal points without NaN', () => {
    const d = haversineDistance({ lat: 0, lon: 0 }, { lat: 0, lon: 180 });
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThan(20_000_000);
  });
});

describe('pathDistance', () => {
  it('is zero for empty and single-point paths', () => {
    expect(pathDistance([])).toBe(0);
    expect(pathDistance([{ lat: 1, lon: 1 }])).toBe(0);
  });

  it('sums segment lengths', () => {
    const points = [
      { lat: 0, lon: 0 },
      { lat: 1, lon: 0 },
      { lat: 2, lon: 0 },
    ];
    const twoDegrees = pathDistance(points);
    const oneDegree = pathDistance(points.slice(0, 2));
    expect(twoDegrees).toBeCloseTo(oneDegree * 2, -1);
  });
});

describe('elevationStats', () => {
  it('returns nulls, not zeros, when no elevation data exists', () => {
    const stats = elevationStats([
      { lat: 0, lon: 0, ele: null },
      { lat: 1, lon: 0, ele: null },
    ]);
    // This is the distinction between "flat" and "unknown". It must not be 0.
    expect(stats).toEqual({ gain: null, loss: null, min: null, max: null });
  });

  it('returns zero gain for genuinely flat elevation data', () => {
    const stats = elevationStats([
      { lat: 0, lon: 0, ele: 100 },
      { lat: 1, lon: 0, ele: 100 },
    ]);
    expect(stats.gain).toBe(0);
    expect(stats.loss).toBe(0);
    expect(stats.min).toBe(100);
    expect(stats.max).toBe(100);
  });

  it('accumulates ascent and descent separately', () => {
    const stats = elevationStats([
      { lat: 0, lon: 0, ele: 100 },
      { lat: 1, lon: 0, ele: 250 },
      { lat: 2, lon: 0, ele: 200 },
      { lat: 3, lon: 0, ele: 400 },
    ]);
    expect(stats.gain).toBe(350);
    expect(stats.loss).toBe(50);
    expect(stats.min).toBe(100);
    expect(stats.max).toBe(400);
  });

  it('ignores points with missing elevation among present ones', () => {
    const stats = elevationStats([
      { lat: 0, lon: 0, ele: 100 },
      { lat: 1, lon: 0, ele: null },
      { lat: 2, lon: 0, ele: 150 },
    ]);
    expect(stats.gain).toBe(50);
    expect(stats.loss).toBe(0);
  });

  it('is empty-safe', () => {
    expect(elevationStats([])).toEqual({
      gain: null,
      loss: null,
      min: null,
      max: null,
    });
  });
});

describe('boundingBox', () => {
  it('returns null for an empty path', () => {
    expect(boundingBox([])).toBeNull();
  });

  it('is a degenerate box for a single point', () => {
    expect(boundingBox([{ lat: 5, lon: 6 }])).toEqual({
      minLat: 5,
      maxLat: 5,
      minLon: 6,
      maxLon: 6,
    });
  });

  it('spans all points', () => {
    expect(
      boundingBox([
        { lat: 1, lon: 10 },
        { lat: -4, lon: 30 },
        { lat: 7, lon: -2 },
      ]),
    ).toEqual({ minLat: -4, maxLat: 7, minLon: -2, maxLon: 30 });
  });
});

describe('coordinate validation', () => {
  it('accepts in-range values including the bounds', () => {
    expect(isValidLat(-90)).toBe(true);
    expect(isValidLat(90)).toBe(true);
    expect(isValidLon(-180)).toBe(true);
    expect(isValidLon(180)).toBe(true);
  });

  it('rejects out-of-range and non-finite values', () => {
    expect(isValidLat(90.1)).toBe(false);
    expect(isValidLon(-180.1)).toBe(false);
    expect(isValidLat(Number.NaN)).toBe(false);
    expect(isValidLon(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
