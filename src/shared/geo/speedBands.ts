import type { UnitSystem } from '../domain/types';

/**
 * Speed distribution: what proportion of a route is at each speed.
 *
 * Three rules from ADR 0011 are enforced here rather than in the UI, because a
 * display-layer rule is one refactor away from being lost:
 *
 * 1. **Weighted by distance, not point count.** Sample spacing is not uniform —
 *    a recorded track clusters samples where the recorder moved slowly — so a
 *    point-count percentage would systematically over-weight exactly the slow
 *    sections it claims to measure.
 * 2. **Unknown is a band.** Distance whose speed could not be determined is
 *    reported at its true size, never redistributed across the known bands and
 *    never inferred from road class. Given that OpenStreetMap speed-limit
 *    coverage is partial, this band is often the largest, and that is the
 *    correct answer rather than an embarrassing one.
 * 3. **Posted limit and recorded speed are separate series.** This module does
 *    not know which it is given; the caller labels it. They are never summed
 *    into one distribution.
 *
 * Pure and dependency-free, so the arithmetic is testable without Electron.
 */

/** Where a distribution's numbers came from. Never merged. */
export type SpeedSource = 'posted' | 'recorded';

export interface SpeedBand {
  /** Inclusive lower bound in metres per second. */
  minMps: number;
  /** Exclusive upper bound, or null for the open-ended top band. */
  maxMps: number | null;
  label: string;
}

const KMH = 1000 / 3600;
const MPH = 1609.344 / 3600;

/**
 * Metric bands, at the limits actually posted across Europe.
 *
 * Boundaries are defined per unit system rather than converted between them.
 * Converting 50 km/h into mph and rounding would put the boundary at 31 mph,
 * which is not a number any sign shows, and would make the same route report a
 * different distribution depending on a display preference.
 */
export const METRIC_SPEED_BANDS: readonly SpeedBand[] = [
  { minMps: 0, maxMps: 30 * KMH, label: 'Under 30 km/h' },
  { minMps: 30 * KMH, maxMps: 50 * KMH, label: '30–50 km/h' },
  { minMps: 50 * KMH, maxMps: 70 * KMH, label: '50–70 km/h' },
  { minMps: 70 * KMH, maxMps: 90 * KMH, label: '70–90 km/h' },
  { minMps: 90 * KMH, maxMps: 110 * KMH, label: '90–110 km/h' },
  { minMps: 110 * KMH, maxMps: null, label: '110 km/h and above' },
];

export const IMPERIAL_SPEED_BANDS: readonly SpeedBand[] = [
  { minMps: 0, maxMps: 20 * MPH, label: 'Under 20 mph' },
  { minMps: 20 * MPH, maxMps: 30 * MPH, label: '20–30 mph' },
  { minMps: 30 * MPH, maxMps: 40 * MPH, label: '30–40 mph' },
  { minMps: 40 * MPH, maxMps: 55 * MPH, label: '40–55 mph' },
  { minMps: 55 * MPH, maxMps: 70 * MPH, label: '55–70 mph' },
  { minMps: 70 * MPH, maxMps: null, label: '70 mph and above' },
];

export function bandsFor(units: UnitSystem): readonly SpeedBand[] {
  return units === 'imperial' ? IMPERIAL_SPEED_BANDS : METRIC_SPEED_BANDS;
}

/** A stretch of route with a speed that may or may not be known. */
export interface SpeedSample {
  /** Metres this sample covers. */
  distanceM: number;
  /** Metres per second, or null when undeterminable. Never 0 as a stand-in. */
  speedMps: number | null;
}

export interface BandShare {
  label: string;
  distanceM: number;
  /** Share of total distance, 0–100. */
  percent: number;
}

export interface SpeedDistribution {
  source: SpeedSource;
  totalDistanceM: number;
  bands: BandShare[];
  /** Always present, even at zero, so its absence can never be mistaken. */
  unknown: BandShare;
  /** True when nothing at all could be determined. */
  allUnknown: boolean;
}

function bandIndexFor(
  speedMps: number,
  bands: readonly SpeedBand[],
): number | null {
  for (const [index, band] of bands.entries()) {
    const aboveFloor = speedMps >= band.minMps;
    const belowCeiling = band.maxMps === null || speedMps < band.maxMps;
    if (aboveFloor && belowCeiling) return index;
  }
  return null;
}

/**
 * Builds the distribution.
 *
 * Percentages are of total distance including the unknown share, so they sum to
 * 100 across the bands plus unknown. Normalising over only the known distance
 * would make a route that is 90% unmapped look fully characterised.
 */
export function speedDistribution(
  samples: readonly SpeedSample[],
  units: UnitSystem,
  source: SpeedSource,
): SpeedDistribution {
  const bands = bandsFor(units);
  const distances: number[] = Array.from({ length: bands.length }, () => 0);
  let unknownDistance = 0;
  let total = 0;

  for (const sample of samples) {
    // A non-finite or negative length is bad input, not a zero-length stretch;
    // counting it would corrupt the denominator.
    if (!Number.isFinite(sample.distanceM) || sample.distanceM <= 0) continue;
    total += sample.distanceM;

    const speed = sample.speedMps;
    if (speed === null || !Number.isFinite(speed) || speed < 0) {
      unknownDistance += sample.distanceM;
      continue;
    }

    const index = bandIndexFor(speed, bands);
    if (index === null) {
      // No band matched, which should be impossible given an open top band.
      // Counting it as unknown rather than dropping it keeps the total honest.
      unknownDistance += sample.distanceM;
      continue;
    }
    distances[index] = (distances[index] ?? 0) + sample.distanceM;
  }

  const share = (metres: number): number =>
    total === 0 ? 0 : (metres / total) * 100;

  return {
    source,
    totalDistanceM: total,
    bands: bands.map((band, index) => ({
      label: band.label,
      distanceM: distances[index] ?? 0,
      percent: share(distances[index] ?? 0),
    })),
    unknown: {
      label: 'Unknown',
      distanceM: unknownDistance,
      percent: share(unknownDistance),
    },
    allUnknown: total > 0 && unknownDistance === total,
  };
}

/**
 * Speed between consecutive timed points, for a recorded track.
 *
 * Returns null for a pair with no usable time delta rather than 0: two samples
 * with the same timestamp tell us nothing about speed, and a zero would claim
 * the rider had stopped.
 */
export function recordedSpeedMps(
  distanceM: number,
  fromTime: number | null,
  toTime: number | null,
): number | null {
  if (fromTime === null || toTime === null) return null;
  const seconds = (toTime - fromTime) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  if (!Number.isFinite(distanceM) || distanceM < 0) return null;
  return distanceM / seconds;
}
