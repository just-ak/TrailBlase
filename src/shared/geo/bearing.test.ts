import { describe, expect, it } from 'vitest';
import {
  bearingDelta,
  initialBearing,
  normaliseBearing,
  turnAngle,
  turnAngles,
} from './bearing';

describe('initialBearing', () => {
  it('reads due north, east, south and west', () => {
    const origin = { lat: 0, lon: 0 };
    expect(initialBearing(origin, { lat: 1, lon: 0 })).toBeCloseTo(0, 6);
    expect(initialBearing(origin, { lat: 0, lon: 1 })).toBeCloseTo(90, 6);
    expect(initialBearing(origin, { lat: -1, lon: 0 })).toBeCloseTo(180, 6);
    expect(initialBearing(origin, { lat: 0, lon: -1 })).toBeCloseTo(270, 6);
  });

  it('always returns a value in [0, 360)', () => {
    const origin = { lat: 46.5, lon: 8 };
    for (let dLat = -1; dLat <= 1; dLat += 0.5) {
      for (let dLon = -1; dLon <= 1; dLon += 0.5) {
        if (dLat === 0 && dLon === 0) continue;
        const bearing = initialBearing(origin, {
          lat: origin.lat + dLat,
          lon: origin.lon + dLon,
        });
        expect(bearing).not.toBeNull();
        expect(bearing).toBeGreaterThanOrEqual(0);
        expect(bearing).toBeLessThan(360);
      }
    }
  });

  // The great-circle bearing between two points at the same latitude is not
  // 90° unless they are on the equator; it bends polewards. A planar
  // approximation would wrongly report exactly 90, which is why this module
  // does not use one.
  it('is not exactly 90 degrees between points at the same high latitude', () => {
    const bearing = initialBearing({ lat: 60, lon: 0 }, { lat: 60, lon: 10 });
    expect(bearing).not.toBeNull();
    expect(bearing as number).toBeGreaterThan(80);
    expect(bearing as number).toBeLessThan(90);
  });

  it('handles a crossing of the antimeridian', () => {
    const bearing = initialBearing(
      { lat: 0, lon: 179.9 },
      { lat: 0, lon: -179.9 },
    );
    // Due east, not a 360-degree sweep the other way round the planet.
    expect(bearing).toBeCloseTo(90, 4);
  });

  it('returns null for coincident points rather than claiming north', () => {
    expect(initialBearing({ lat: 46.5, lon: 8 }, { lat: 46.5, lon: 8 })).toBeNull();
  });
});

describe('normaliseBearing', () => {
  it.each([
    [0, 0],
    [360, 0],
    [361, 1],
    [-1, 359],
    [-360, 0],
    [720, 0],
    [-450, 270],
  ])('wraps %s to %s', (input, expected) => {
    expect(normaliseBearing(input)).toBeCloseTo(expected, 9);
  });
});

describe('bearingDelta', () => {
  it('signs a right turn positive and a left turn negative', () => {
    expect(bearingDelta(0, 30)).toBeCloseTo(30, 9);
    expect(bearingDelta(30, 0)).toBeCloseTo(-30, 9);
  });

  // The whole reason the function exists: naive subtraction gives -340.
  it('reads 350 to 10 as a 20 degree right turn', () => {
    expect(bearingDelta(350, 10)).toBeCloseTo(20, 9);
  });

  it('reads 10 to 350 as a 20 degree left turn', () => {
    expect(bearingDelta(10, 350)).toBeCloseTo(-20, 9);
  });

  it('keeps a reversal at +180 rather than -180', () => {
    expect(bearingDelta(0, 180)).toBe(180);
    expect(bearingDelta(180, 0)).toBe(180);
  });

  it('stays within (-180, 180]', () => {
    for (let from = 0; from < 360; from += 17) {
      for (let to = 0; to < 360; to += 23) {
        const delta = bearingDelta(from, to);
        expect(delta).toBeGreaterThan(-180);
        expect(delta).toBeLessThanOrEqual(180);
      }
    }
  });
});

describe('turnAngle', () => {
  it('is zero along a straight line', () => {
    const angle = turnAngle(
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
      { lat: 0, lon: 2 },
    );
    expect(angle).toBeCloseTo(0, 4);
  });

  it('is a right angle at a right-hand corner', () => {
    // East, then south: a 90 degree right turn.
    const angle = turnAngle(
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
      { lat: -1, lon: 1 },
    );
    expect(angle).toBeCloseTo(90, 3);
  });

  it('is negative at a left-hand corner', () => {
    const angle = turnAngle(
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
      { lat: 1, lon: 1 },
    );
    expect(angle).toBeCloseTo(-90, 3);
  });

  it('reads a hairpin as close to a reversal', () => {
    const angle = turnAngle(
      { lat: 46.5, lon: 8 },
      { lat: 46.51, lon: 8 },
      { lat: 46.5, lon: 8.0001 },
    );
    expect(Math.abs(angle as number)).toBeGreaterThan(170);
  });

  // A duplicated coordinate is a digitisation artefact, not a hairpin. Zero
  // would claim the road ran straight through it.
  it('returns null when a point is duplicated', () => {
    expect(
      turnAngle({ lat: 46.5, lon: 8 }, { lat: 46.5, lon: 8 }, { lat: 46.6, lon: 8 }),
    ).toBeNull();
    expect(
      turnAngle({ lat: 46.5, lon: 8 }, { lat: 46.6, lon: 8 }, { lat: 46.6, lon: 8 }),
    ).toBeNull();
  });
});

describe('turnAngles', () => {
  it('is index-aligned with the input, with null at both ends', () => {
    const points = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
      { lat: -1, lon: 1 },
      { lat: -1, lon: 2 },
    ];
    const angles = turnAngles(points);

    expect(angles).toHaveLength(points.length);
    expect(angles[0]).toBeNull();
    expect(angles.at(-1)).toBeNull();

    // Exact: this corner is on the equator, where a great circle running east
    // and a line of latitude coincide.
    expect(angles[1]).toBeCloseTo(90, 6);

    // Not exact, and that is the point. This corner sits at latitude -1, where
    // the great-circle bearing of an eastward leg is a fraction under 90°. A
    // planar approximation would report exactly -90 here; the deviation is the
    // reason this module does the spherical calculation.
    expect(angles[2]).toBeCloseTo(-90, 1);
    expect(angles[2]).not.toBe(-90);
  });

  it('handles degenerate inputs without throwing', () => {
    expect(turnAngles([])).toEqual([]);
    expect(turnAngles([{ lat: 0, lon: 0 }])).toEqual([null]);
    expect(turnAngles([{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }])).toEqual([
      null,
      null,
    ]);
  });
});
