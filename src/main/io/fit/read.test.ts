import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ParseError } from '@shared/io/types';
import {
  FIT_ALTITUDE_RESOLUTION_M,
  FIT_COORDINATE_RESOLUTION_DEG,
  readFit,
  SEMICIRCLES_PER_DEGREE,
} from './read';

const FIXTURE = join(process.cwd(), 'test-data', 'generated', 'activity.fit');

// The FIT fixture is generated rather than committed. Skipping with a named
// condition is honest; a silently passing suite would not be.
const describeFit = existsSync(FIXTURE) ? describe : describe.skip;

/** The values the fixture generator wrote, before FIT quantised them. */
const SOURCE = [
  { lat: 46.5197, lon: 8.012, ele: 1850.5 },
  { lat: 46.5231, lon: 8.0168, ele: 1902.25 },
  { lat: 46.531, lon: 8.0255, ele: 2010 },
  { lat: 46.5402, lon: 8.031, ele: 2180 },
  { lat: 46.5602, lon: 8.0431, ele: 2431 },
];

describe('FIT encoding constants', () => {
  it('matches the semicircle definition', () => {
    expect(SEMICIRCLES_PER_DEGREE).toBe(2 ** 31 / 180);
    // About 2 × 10⁻⁸ degrees, which is roughly 2 mm of latitude.
    expect(FIT_COORDINATE_RESOLUTION_DEG).toBeCloseTo(8.38e-8, 10);
  });

  it('states altitude resolution as 0.2 m', () => {
    expect(FIT_ALTITUDE_RESOLUTION_M).toBe(0.2);
  });
});

describeFit('readFit', () => {
  const bytes = existsSync(FIXTURE)
    ? new Uint8Array(readFileSync(FIXTURE))
    : new Uint8Array();

  it('reports the format and source name', async () => {
    const file = await readFit(bytes, '/tmp/activity.fit');
    expect(file.format).toBe('fit');
    expect(file.sourceName).toBe('activity.fit');
  });

  it('maps records to a single track', async () => {
    const file = await readFit(bytes, '/tmp/activity.fit');
    expect(file.tracks).toHaveLength(1);
    expect(file.routes).toHaveLength(0);
    expect(file.tracks[0]?.segments).toHaveLength(1);
    expect(file.tracks[0]?.segments[0]?.points).toHaveLength(SOURCE.length);
  });

  // Not `toBe`. FIT genuinely cannot carry an arbitrary double, and asserting
  // equality here would be asserting something false.
  it('converts semicircles back to degrees within the encoding resolution', async () => {
    const file = await readFit(bytes, '/tmp/activity.fit');
    const points = file.tracks[0]?.segments[0]?.points ?? [];

    for (const [index, expected] of SOURCE.entries()) {
      const point = points[index];
      expect(point).toBeDefined();
      expect(Math.abs((point?.lat ?? 0) - expected.lat)).toBeLessThanOrEqual(
        FIT_COORDINATE_RESOLUTION_DEG,
      );
      expect(Math.abs((point?.lon ?? 0) - expected.lon)).toBeLessThanOrEqual(
        FIT_COORDINATE_RESOLUTION_DEG,
      );
    }
  });

  it('reads altitude to the 0.2 m the format allows', async () => {
    const file = await readFit(bytes, '/tmp/activity.fit');
    const points = file.tracks[0]?.segments[0]?.points ?? [];

    for (const [index, expected] of SOURCE.entries()) {
      const actual = points[index]?.ele ?? Number.NaN;
      expect(Math.abs(actual - expected.ele)).toBeLessThanOrEqual(
        FIT_ALTITUDE_RESOLUTION_M,
      );
    }
  });

  it('reads timestamps as epoch milliseconds', async () => {
    const file = await readFit(bytes, '/tmp/activity.fit');
    const points = file.tracks[0]?.segments[0]?.points ?? [];

    expect(points[0]?.time).toBe(Date.UTC(2026, 6, 14, 6, 30, 0));
    // 15-minute spacing, per the generator.
    expect((points[1]?.time ?? 0) - (points[0]?.time ?? 0)).toBe(15 * 60_000);
  });

  it('warns that FIT is lossy, rather than leaving the user to discover it', async () => {
    const file = await readFit(bytes, '/tmp/activity.fit');
    expect(file.warnings.join(' ')).toMatch(/semicircles/);
    expect(file.warnings.join(' ')).toMatch(/0\.2 m/);
  });

  it('keeps the file identity block for Phase 5', async () => {
    const file = await readFit(bytes, '/tmp/activity.fit');
    expect(file.tracks[0]?.metadata.fitFileId).toMatchObject({
      type: 'activity',
      manufacturer: 'garmin',
    });
  });

  it('names the track from the file when there is no session sport', async () => {
    const file = await readFit(bytes, '/tmp/activity.fit');
    // The fixture has no session message, so the filename is the honest
    // fallback rather than an invented sport.
    expect(file.tracks[0]?.name).toBe('activity');
  });

  it('carries a point-extras array parallel to the geometry', async () => {
    const file = await readFit(bytes, '/tmp/activity.fit');
    const extras = file.tracks[0]?.metadata.pointExtras as Record<
      string,
      number
    >[][];

    expect(extras).toHaveLength(1);
    expect(extras[0]).toHaveLength(SOURCE.length);
    // The fixture carries no heart rate, and none is invented.
    expect(extras[0]?.[0]).toEqual({});
  });
});

describe('readFit failure handling', () => {
  it('rejects a file that is not FIT at all', async () => {
    await expect(
      readFit(new TextEncoder().encode('this is not a FIT file'), '/tmp/x.fit'),
    ).rejects.toThrow(ParseError);
  });

  it('rejects an empty file', async () => {
    await expect(readFit(new Uint8Array(), '/tmp/empty.fit')).rejects.toThrow(
      ParseError,
    );
  });

  it('names the underlying problem in the error detail', async () => {
    try {
      await readFit(new Uint8Array([1, 2, 3, 4]), '/tmp/short.fit');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ParseError);
      expect((error as ParseError).format).toBe('fit');
      expect((error as ParseError).detail).toBeTruthy();
    }
  });
});
