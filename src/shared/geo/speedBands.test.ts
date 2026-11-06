import { describe, expect, it } from 'vitest';
import {
  bandsFor,
  IMPERIAL_SPEED_BANDS,
  METRIC_SPEED_BANDS,
  recordedSpeedMps,
  speedDistribution,
  type SpeedSample,
} from './speedBands';

const KMH = 1000 / 3600;

const sample = (distanceM: number, kmh: number | null): SpeedSample => ({
  distanceM,
  speedMps: kmh === null ? null : kmh * KMH,
});

describe('band definitions', () => {
  it('covers every speed from zero upwards with no gaps', () => {
    for (const bands of [METRIC_SPEED_BANDS, IMPERIAL_SPEED_BANDS]) {
      expect(bands[0]?.minMps).toBe(0);
      expect(bands.at(-1)?.maxMps).toBeNull();
      for (let i = 1; i < bands.length; i += 1) {
        // Each band starts exactly where the previous one ended.
        expect(bands[i]?.minMps).toBe(bands[i - 1]?.maxMps);
      }
    }
  });

  // Converting 50 km/h to mph and rounding would put a boundary at 31 mph,
  // which no sign shows. The band sets are defined independently so the same
  // route does not report a different distribution per display preference.
  it('defines imperial boundaries independently, not as converted metric', () => {
    const metricBoundaries = METRIC_SPEED_BANDS.map((b) => b.maxMps);
    const imperialBoundaries = IMPERIAL_SPEED_BANDS.map((b) => b.maxMps);
    expect(imperialBoundaries).not.toEqual(metricBoundaries);
    expect(IMPERIAL_SPEED_BANDS.map((b) => b.label).join(' ')).toMatch(/mph/);
    expect(METRIC_SPEED_BANDS.map((b) => b.label).join(' ')).toMatch(/km\/h/);
  });

  it('selects by unit system', () => {
    expect(bandsFor('metric')).toBe(METRIC_SPEED_BANDS);
    expect(bandsFor('imperial')).toBe(IMPERIAL_SPEED_BANDS);
  });
});

describe('speedDistribution', () => {
  it('reports shares of distance that sum to 100 with unknown included', () => {
    const result = speedDistribution(
      [sample(1000, 40), sample(3000, 95), sample(1000, null)],
      'metric',
      'posted',
    );

    const total =
      result.bands.reduce((sum, band) => sum + band.percent, 0) +
      result.unknown.percent;
    expect(total).toBeCloseTo(100, 9);
    expect(result.totalDistanceM).toBe(5000);
  });

  it('places each sample in the right band', () => {
    const result = speedDistribution(
      [sample(1000, 40), sample(1000, 95)],
      'metric',
      'posted',
    );

    expect(
      result.bands.find((b) => b.label === '30–50 km/h')?.distanceM,
    ).toBe(1000);
    expect(
      result.bands.find((b) => b.label === '90–110 km/h')?.distanceM,
    ).toBe(1000);
  });

  it('treats a band boundary as the start of the upper band', () => {
    const result = speedDistribution([sample(100, 50)], 'metric', 'posted');
    expect(result.bands.find((b) => b.label === '50–70 km/h')?.distanceM).toBe(
      100,
    );
    expect(result.bands.find((b) => b.label === '30–50 km/h')?.distanceM).toBe(
      0,
    );
  });

  it('puts a speed above every boundary in the open top band', () => {
    const result = speedDistribution([sample(100, 200)], 'metric', 'posted');
    expect(
      result.bands.find((b) => b.label === '110 km/h and above')?.distanceM,
    ).toBe(100);
  });

  // The rule that matters most. Weighting by point count would report 50/50
  // here, because there are equal numbers of samples at each speed, when in
  // fact 90% of the distance is at the higher speed.
  it('weights by distance, not by sample count', () => {
    const result = speedDistribution(
      [sample(100, 40), sample(900, 95)],
      'metric',
      'posted',
    );

    expect(
      result.bands.find((b) => b.label === '30–50 km/h')?.percent,
    ).toBeCloseTo(10, 9);
    expect(
      result.bands.find((b) => b.label === '90–110 km/h')?.percent,
    ).toBeCloseTo(90, 9);
  });

  describe('the unknown band', () => {
    it('is always present, even at zero', () => {
      const result = speedDistribution([sample(100, 50)], 'metric', 'posted');
      expect(result.unknown).toBeDefined();
      expect(result.unknown.distanceM).toBe(0);
      expect(result.unknown.percent).toBe(0);
    });

    it('is sized honestly and never redistributed', () => {
      const result = speedDistribution(
        [sample(600, null), sample(400, 50)],
        'metric',
        'posted',
      );

      expect(result.unknown.percent).toBeCloseTo(60, 9);
      // The known share is of the whole route, not of the known part. A route
      // that is 60% unmapped must not look fully characterised.
      expect(
        result.bands.find((b) => b.label === '50–70 km/h')?.percent,
      ).toBeCloseTo(40, 9);
    });

    it('flags a route with no determinable speed at all', () => {
      const result = speedDistribution(
        [sample(500, null), sample(500, null)],
        'metric',
        'posted',
      );
      expect(result.allUnknown).toBe(true);
      expect(result.unknown.percent).toBeCloseTo(100, 9);
    });

    it('is not flagged when something is known', () => {
      const result = speedDistribution(
        [sample(999, null), sample(1, 50)],
        'metric',
        'posted',
      );
      expect(result.allUnknown).toBe(false);
    });

    it('absorbs a negative or non-finite speed rather than banding it', () => {
      const result = speedDistribution(
        [
          { distanceM: 100, speedMps: -5 },
          { distanceM: 100, speedMps: Number.POSITIVE_INFINITY },
        ],
        'metric',
        'posted',
      );
      expect(result.unknown.distanceM).toBe(200);
    });
  });

  it('ignores a sample with no usable length rather than skewing the total', () => {
    const result = speedDistribution(
      [
        sample(1000, 50),
        { distanceM: 0, speedMps: 1 },
        { distanceM: -5, speedMps: 1 },
        { distanceM: Number.NaN, speedMps: 1 },
      ],
      'metric',
      'posted',
    );
    expect(result.totalDistanceM).toBe(1000);
  });

  it('is empty but valid for no samples', () => {
    const result = speedDistribution([], 'metric', 'posted');
    expect(result.totalDistanceM).toBe(0);
    expect(result.allUnknown).toBe(false);
    expect(result.bands.every((b) => b.percent === 0)).toBe(true);
  });

  it('carries the source through without interpreting it', () => {
    expect(speedDistribution([], 'metric', 'posted').source).toBe('posted');
    expect(speedDistribution([], 'metric', 'recorded').source).toBe('recorded');
  });
});

describe('recordedSpeedMps', () => {
  it('computes distance over time', () => {
    expect(recordedSpeedMps(100, 0, 10_000)).toBeCloseTo(10, 9);
  });

  // Two samples with the same timestamp say nothing about speed. Zero would
  // claim the rider had stopped.
  it('returns null for a zero or negative time delta', () => {
    expect(recordedSpeedMps(100, 1000, 1000)).toBeNull();
    expect(recordedSpeedMps(100, 2000, 1000)).toBeNull();
  });

  it('returns null when either timestamp is missing', () => {
    expect(recordedSpeedMps(100, null, 1000)).toBeNull();
    expect(recordedSpeedMps(100, 1000, null)).toBeNull();
  });

  it('allows a genuine zero speed from a real time delta', () => {
    expect(recordedSpeedMps(0, 0, 5000)).toBe(0);
  });
});
