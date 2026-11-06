import { describe, expect, it } from 'vitest';
import {
  ABSENT,
  estimateDurationSeconds,
  formatCoordinates,
  formatDistance,
  formatDuration,
  formatElevation,
} from './units';

describe('formatDistance', () => {
  it('renders absent data as an em dash, never as zero', () => {
    expect(formatDistance(null, 'metric')).toBe(ABSENT);
    expect(formatDistance(Number.NaN, 'metric')).toBe(ABSENT);
  });

  it('uses metres below a kilometre and kilometres above', () => {
    expect(formatDistance(0, 'metric')).toBe('0 m');
    expect(formatDistance(999, 'metric')).toBe('999 m');
    expect(formatDistance(1500, 'metric')).toBe('1.50 km');
    expect(formatDistance(42_195, 'metric')).toBe('42.2 km');
  });

  it('converts to imperial', () => {
    expect(formatDistance(1609.344, 'imperial')).toBe('1.00 mi');
    expect(formatDistance(42_195, 'imperial')).toBe('26.2 mi');
  });
});

describe('formatElevation', () => {
  it('distinguishes absent elevation from sea level', () => {
    expect(formatElevation(null, 'metric')).toBe(ABSENT);
    expect(formatElevation(0, 'metric')).toBe('0 m');
  });

  it('converts to feet', () => {
    expect(formatElevation(1000, 'imperial')).toBe('3281 ft');
  });
});

describe('formatDuration', () => {
  it('renders absent and negative input as an em dash', () => {
    expect(formatDuration(null)).toBe(ABSENT);
    expect(formatDuration(-1)).toBe(ABSENT);
  });

  it('renders minutes below an hour', () => {
    expect(formatDuration(90)).toBe('2 min');
    expect(formatDuration(3540)).toBe('59 min');
  });

  it('renders hours and zero-padded minutes', () => {
    expect(formatDuration(3600)).toBe('1 h 00 min');
    expect(formatDuration(3600 + 5 * 60)).toBe('1 h 05 min');
  });
});

describe('formatCoordinates', () => {
  it('uses hemisphere suffixes', () => {
    expect(formatCoordinates(46.8, 8.2)).toBe('46.80000° N, 8.20000° E');
    expect(formatCoordinates(-33.86, -151.2)).toBe('33.86000° S, 151.20000° W');
  });
});

describe('estimateDurationSeconds', () => {
  it('refuses to invent a duration from unknown distance', () => {
    expect(estimateDurationSeconds(null, 4.5)).toBeNull();
  });

  it('refuses a non-positive planning speed rather than dividing by zero', () => {
    expect(estimateDurationSeconds(1000, 0)).toBeNull();
    expect(estimateDurationSeconds(1000, -2)).toBeNull();
  });

  it('computes distance over speed', () => {
    // 9 km at 4.5 km/h is exactly two hours.
    expect(estimateDurationSeconds(9000, 4.5)).toBeCloseTo(7200, 6);
  });
});
