import { describe, expect, it } from 'vitest';
import {
  cumulativeDistances,
  elevationProfile,
  indexAtDistance,
  spansFromIndices,
  thinForDisplay,
} from './profile';

const p = (lat: number, lon: number, ele: number | null = null) => ({
  lat,
  lon,
  ele,
});

describe('cumulativeDistances', () => {
  it('starts at zero and increases monotonically', () => {
    const distances = cumulativeDistances([
      p(46.5, 8),
      p(46.51, 8),
      p(46.52, 8),
    ]);
    expect(distances[0]).toBe(0);
    expect(distances[1]).toBeGreaterThan(0);
    expect(distances[2]).toBeGreaterThan(distances[1] as number);
  });

  it('is index-aligned with the input', () => {
    const points = [p(46.5, 8), p(46.51, 8), p(46.52, 8), p(46.53, 8)];
    expect(cumulativeDistances(points)).toHaveLength(points.length);
  });

  it('handles degenerate inputs', () => {
    expect(cumulativeDistances([])).toEqual([]);
    expect(cumulativeDistances([p(46.5, 8)])).toEqual([0]);
  });

  it('counts a duplicated point as zero additional distance', () => {
    const distances = cumulativeDistances([p(46.5, 8), p(46.5, 8), p(46.51, 8)]);
    expect(distances[1]).toBe(0);
    expect(distances[2]).toBeGreaterThan(0);
  });
});

describe('elevationProfile', () => {
  it('returns gain, loss and range', () => {
    const profile = elevationProfile([
      p(46.5, 8, 1000),
      p(46.51, 8, 1200),
      p(46.52, 8, 1100),
    ]);

    expect(profile).not.toBeNull();
    expect(profile?.gainM).toBeCloseTo(200, 6);
    expect(profile?.lossM).toBeCloseTo(100, 6);
    expect(profile?.minM).toBe(1000);
    expect(profile?.maxM).toBe(1200);
    expect(profile?.totalDistanceM).toBeGreaterThan(0);
  });

  // Null rather than a profile of nulls, so a caller cannot render an axis for
  // data that does not exist. A route with no barometer and a flat route are
  // different facts.
  it('returns null when nothing carries elevation', () => {
    expect(elevationProfile([p(46.5, 8), p(46.51, 8)])).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(elevationProfile([])).toBeNull();
  });

  it('keeps gaps as null rather than interpolating them', () => {
    const profile = elevationProfile([
      p(46.5, 8, 1000),
      p(46.51, 8, null),
      p(46.52, 8, 1100),
    ]);
    expect(profile?.elevations).toEqual([1000, null, 1100]);
    // Gain is measured between the known values, not through an invented one.
    expect(profile?.gainM).toBeCloseTo(100, 6);
  });

  it('reports a genuinely flat profile as zero gain, not as absent', () => {
    const profile = elevationProfile([p(46.5, 8, 500), p(46.51, 8, 500)]);
    expect(profile?.gainM).toBe(0);
    expect(profile?.lossM).toBe(0);
  });

  it('survives a large input without overflowing the call stack', () => {
    const points = Array.from({ length: 200_000 }, (_, i) =>
      p(46.5 + i * 1e-6, 8, 1000 + (i % 100)),
    );
    const profile = elevationProfile(points);
    expect(profile?.minM).toBe(1000);
    expect(profile?.maxM).toBe(1099);
  });
});

describe('spansFromIndices', () => {
  const points = [p(46.5, 8), p(46.51, 8), p(46.52, 8), p(46.53, 8)];

  it('converts index ranges to distance ranges', () => {
    const spans = spansFromIndices(points, [
      { startIndex: 0, endIndex: 2, value: 'primary' },
      { startIndex: 2, endIndex: 3, value: 'tertiary' },
    ]);

    expect(spans).toHaveLength(2);
    expect(spans[0]?.startM).toBe(0);
    expect(spans[0]?.endM).toBeGreaterThan(0);
    // Contiguous: one span ends exactly where the next begins.
    expect(spans[1]?.startM).toBe(spans[0]?.endM);
    expect(spans[1]?.value).toBe('tertiary');
  });

  it('drops a zero-length or inverted span', () => {
    const spans = spansFromIndices(points, [
      { startIndex: 1, endIndex: 1, value: 'x' },
      { startIndex: 3, endIndex: 1, value: 'y' },
    ]);
    expect(spans).toEqual([]);
  });

  it('clamps an out-of-range index instead of reading past the end', () => {
    const spans = spansFromIndices(points, [
      { startIndex: -5, endIndex: 99, value: 'all' },
    ]);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.startM).toBe(0);
    expect(spans[0]?.endM).toBe(cumulativeDistances(points).at(-1));
  });

  it('carries a null value through', () => {
    const spans = spansFromIndices(points, [
      { startIndex: 0, endIndex: 1, value: null },
    ]);
    expect(spans[0]?.value).toBeNull();
  });
});

describe('thinForDisplay', () => {
  it('leaves a short series alone and says it was not simplified', () => {
    const result = thinForDisplay([1, 2, 3], 10);
    expect(result.values).toEqual([1, 2, 3]);
    expect(result.simplified).toBe(false);
  });

  it('thins a long series to the requested size and flags it', () => {
    const input = Array.from({ length: 10_000 }, (_, i) => i);
    const result = thinForDisplay(input, 500);

    expect(result.values).toHaveLength(500);
    expect(result.simplified).toBe(true);
    // Endpoints are preserved, so the chart still spans the whole route.
    expect(result.values[0]).toBe(0);
    expect(result.values.at(-1)).toBe(9999);
  });

  it('keeps the series monotonic when thinning', () => {
    const input = Array.from({ length: 1000 }, (_, i) => i * 3);
    const result = thinForDisplay(input, 50);
    for (let i = 1; i < result.values.length; i += 1) {
      expect(result.values[i] as number).toBeGreaterThan(
        result.values[i - 1] as number,
      );
    }
  });
});

describe('indexAtDistance', () => {
  const distances = [0, 100, 200, 300, 400];

  it('finds an exact match', () => {
    expect(indexAtDistance(distances, 200)).toBe(2);
  });

  it('returns the nearest index, not merely the next one', () => {
    expect(indexAtDistance(distances, 149)).toBe(1);
    expect(indexAtDistance(distances, 151)).toBe(2);
  });

  it('clamps beyond either end', () => {
    expect(indexAtDistance(distances, -50)).toBe(0);
    expect(indexAtDistance(distances, 10_000)).toBe(4);
  });

  it('returns null for an empty series', () => {
    expect(indexAtDistance([], 100)).toBeNull();
  });

  it('agrees with a linear scan over a large series', () => {
    const large = Array.from({ length: 5000 }, (_, i) => i * 7);
    for (const target of [0, 13, 999, 17_500, 34_993]) {
      let best = 0;
      for (let i = 1; i < large.length; i += 1) {
        if (
          Math.abs((large[i] as number) - target) <
          Math.abs((large[best] as number) - target)
        ) {
          best = i;
        }
      }
      expect(indexAtDistance(large, target)).toBe(best);
    }
  });
});
