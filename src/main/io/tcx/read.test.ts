import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ParseError } from '@shared/io/types';
import { readTcx } from './read';

const fixture = (name: string): string =>
  readFileSync(join(process.cwd(), 'test-data', name), 'utf8');

const wrap = (body: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
${body}
</TrainingCenterDatabase>`;

describe('readTcx', () => {
  const file = readTcx(fixture('activity.tcx'), '/tmp/activity.tcx');

  it('reports the format and source name', () => {
    expect(file.format).toBe('tcx');
    expect(file.sourceName).toBe('activity.tcx');
  });

  it('maps an activity to one track', () => {
    expect(file.tracks).toHaveLength(1);
    expect(file.waypoints).toHaveLength(0);
    expect(file.routes).toHaveLength(0);
  });

  it('names the track from the activity Id', () => {
    expect(file.tracks[0]?.name).toBe('2026-07-14T06:30:00Z');
  });

  it('preserves coordinates, altitude and time exactly', () => {
    const points = file.tracks[0]?.segments[0]?.points ?? [];
    expect(points).toHaveLength(3);
    expect(points[0]).toEqual({
      lat: 46.5197,
      lon: 8.012,
      ele: 1850.5,
      time: Date.parse('2026-07-14T06:30:00Z'),
    });
    expect(points[1]?.ele).toBe(1902.25);
    expect(points[2]?.ele).toBe(2010);
  });

  it('retains heart rate and cadence as metadata rather than discarding them', () => {
    const extras = file.tracks[0]?.metadata.pointExtras as Record<
      string,
      unknown
    >[][];

    expect(extras[0]?.[0]).toMatchObject({ HeartRateBpm: 118, Cadence: 62 });
    expect(extras[0]?.[1]).toMatchObject({ HeartRateBpm: 131, Cadence: 64 });
    // The third point has neither, and nothing is invented for it.
    expect(extras[0]?.[2]).toEqual({});
  });

  it('names the retained fields in the unmapped report', () => {
    expect(file.unmappedMetadata).toContain('TCX Trackpoint <HeartRateBpm>');
    expect(file.unmappedMetadata).toContain('TCX Trackpoint <Cadence>');
    expect(file.unmappedMetadata).toContain('TCX Lap summaries');
  });

  it('keeps lap summaries and the sport', () => {
    expect(file.tracks[0]?.metadata.sport).toBe('Hiking');
    const laps = file.tracks[0]?.metadata.laps as Record<string, unknown>[];
    expect(laps).toHaveLength(1);
    expect(laps[0]).toMatchObject({
      totalTimeSeconds: 2400,
      distanceMeters: 4200,
      startTime: '2026-07-14T06:30:00Z',
    });
  });

  it('makes each lap a segment, not a flattened run', () => {
    const multiLap = readTcx(
      wrap(`  <Activities><Activity Sport="Biking"><Id>2026-01-01T00:00:00Z</Id>
    <Lap StartTime="2026-01-01T00:00:00Z"><Track>
      <Trackpoint><Position><LatitudeDegrees>46.0</LatitudeDegrees><LongitudeDegrees>8.0</LongitudeDegrees></Position></Trackpoint>
      <Trackpoint><Position><LatitudeDegrees>46.01</LatitudeDegrees><LongitudeDegrees>8.01</LongitudeDegrees></Position></Trackpoint>
    </Track></Lap>
    <Lap StartTime="2026-01-01T01:00:00Z"><Track>
      <Trackpoint><Position><LatitudeDegrees>47.0</LatitudeDegrees><LongitudeDegrees>9.0</LongitudeDegrees></Position></Trackpoint>
    </Track></Lap>
  </Activity></Activities>`),
      '/tmp/laps.tcx',
    );

    expect(multiLap.tracks[0]?.segments).toHaveLength(2);
    expect(multiLap.tracks[0]?.segments[0]?.points).toHaveLength(2);
    expect(multiLap.tracks[0]?.segments[1]?.points).toHaveLength(1);
  });

  it('leaves a missing altitude and time null, never 0', () => {
    const bare = readTcx(
      wrap(`  <Activities><Activity><Id>2026-01-01T00:00:00Z</Id><Lap><Track>
    <Trackpoint><Position><LatitudeDegrees>46.0</LatitudeDegrees><LongitudeDegrees>8.0</LongitudeDegrees></Position></Trackpoint>
    <Trackpoint><Position><LatitudeDegrees>46.01</LatitudeDegrees><LongitudeDegrees>8.01</LongitudeDegrees></Position></Trackpoint>
  </Track></Lap></Activity></Activities>`),
      '/tmp/bare.tcx',
    );

    const point = bare.tracks[0]?.segments[0]?.points[0];
    expect(point?.ele).toBeNull();
    expect(point?.time).toBeNull();
  });

  it('skips a positionless trackpoint and says how many', () => {
    const indoors = readTcx(
      wrap(`  <Activities><Activity><Id>2026-01-01T00:00:00Z</Id><Lap><Track>
    <Trackpoint><Time>2026-01-01T00:00:00Z</Time><HeartRateBpm><Value>100</Value></HeartRateBpm></Trackpoint>
    <Trackpoint><Position><LatitudeDegrees>46.0</LatitudeDegrees><LongitudeDegrees>8.0</LongitudeDegrees></Position></Trackpoint>
  </Track></Lap></Activity></Activities>`),
      '/tmp/indoors.tcx',
    );

    expect(indoors.tracks[0]?.segments[0]?.points).toHaveLength(1);
    expect(indoors.warnings.join(' ')).toMatch(
      /1 trackpoint had no position/,
    );
  });

  it('skips an activity with no positioned points, naming it', () => {
    const treadmill = readTcx(
      wrap(`  <Activities><Activity Sport="Running"><Id>2026-01-01T00:00:00Z</Id><Lap><Track>
    <Trackpoint><Time>2026-01-01T00:00:00Z</Time></Trackpoint>
  </Track></Lap></Activity></Activities>`),
      '/tmp/treadmill.tcx',
    );

    expect(treadmill.tracks).toHaveLength(0);
    expect(treadmill.skipped[0]).toMatchObject({
      kind: 'activity',
      name: '2026-01-01T00:00:00Z',
    });
  });

  it('reports a Course as skipped rather than reading it as an activity', () => {
    const course = readTcx(
      wrap(`  <Courses><Course><Name>Planned Ridge</Name><Track>
    <Trackpoint><Position><LatitudeDegrees>46.0</LatitudeDegrees><LongitudeDegrees>8.0</LongitudeDegrees></Position></Trackpoint>
  </Track></Course></Courses>`),
      '/tmp/course.tcx',
    );

    expect(course.tracks).toHaveLength(0);
    expect(course.skipped[0]).toMatchObject({
      kind: 'course',
      name: 'Planned Ridge',
    });
    expect(course.skipped[0]?.reason).toMatch(/Export it as GPX/);
  });

  it('warns rather than failing on a TCX with no activities', () => {
    const empty = readTcx(wrap('  <Activities/>'), '/tmp/empty.tcx');
    expect(empty.tracks).toHaveLength(0);
    expect(empty.warnings).toContain('This TCX file contains no activities.');
  });

  it('keeps the Creator block for Phase 6 round-tripping', () => {
    const withCreator = readTcx(
      wrap(`  <Activities><Activity><Id>2026-01-01T00:00:00Z</Id>
    <Lap><Track><Trackpoint><Position><LatitudeDegrees>46.0</LatitudeDegrees><LongitudeDegrees>8.0</LongitudeDegrees></Position></Trackpoint></Track></Lap>
    <Creator xsi:type="Device_t" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Name>Edge 540</Name></Creator>
  </Activity></Activities>`),
      '/tmp/creator.tcx',
    );

    expect(withCreator.tracks[0]?.metadata.creator).toMatchObject({
      Name: 'Edge 540',
    });
    expect(withCreator.unmappedMetadata).toContain('TCX Activity <Creator>');
  });

  it('drops an out-of-range coordinate with a warning', () => {
    const bad = readTcx(
      wrap(`  <Activities><Activity><Id>x</Id><Lap><Track>
    <Trackpoint><Position><LatitudeDegrees>146.0</LatitudeDegrees><LongitudeDegrees>8.0</LongitudeDegrees></Position></Trackpoint>
    <Trackpoint><Position><LatitudeDegrees>46.0</LatitudeDegrees><LongitudeDegrees>8.0</LongitudeDegrees></Position></Trackpoint>
  </Track></Lap></Activity></Activities>`),
      '/tmp/range.tcx',
    );

    expect(bad.tracks[0]?.segments[0]?.points).toHaveLength(1);
    expect(bad.warnings.join(' ')).toMatch(/out of range/);
  });

  it('fails with a located message on malformed XML', () => {
    expect(() => readTcx('<TrainingCenterDatabase>', '/tmp/bad.tcx')).toThrow(
      ParseError,
    );
  });

  it('rejects a file with the wrong root element', () => {
    expect(() => readTcx('<gpx version="1.1"/>', '/tmp/wrong.tcx')).toThrow(
      /no <TrainingCenterDatabase> root element/,
    );
  });
});
