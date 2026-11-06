import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readGpx } from './read';
import { writeGpx } from './write';
import { detectFormat } from '../detect';

/**
 * The headline Phase 3 acceptance criterion: an exported GPX file can be
 * reopened, and what comes back is what went in.
 */

const fixture = (name: string): string =>
  readFileSync(join(process.cwd(), 'test-data', name), 'utf8');

const bytes = (content: string): Uint8Array =>
  new TextEncoder().encode(content);

describe('GPX round trip', () => {
  it('preserves waypoints, routes and tracks exactly', () => {
    const original = readGpx(fixture('alps-full.gpx'), 'alps-full.gpx');

    const written = writeGpx({
      name: 'Round Trip',
      waypoints: original.waypoints.map((w) => ({
        name: w.name,
        lat: w.lat,
        lon: w.lon,
        eleM: w.ele,
        description: w.description,
        symbol: w.symbol,
        notes: w.notes,
        time: w.time,
      })),
      routes: original.routes.map((r) => ({ name: r.name, points: r.points })),
      tracks: original.tracks.map((t) => ({
        name: t.name,
        segments: t.segments.map((s) => ({
          points: s.points.map((p) => ({
            lat: p.lat,
            lon: p.lon,
            ele: p.ele,
            time: p.time,
          })),
        })),
      })),
    });

    const reread = readGpx(written, 'exported.gpx');

    expect(reread.waypoints).toHaveLength(original.waypoints.length);
    expect(reread.routes).toHaveLength(original.routes.length);
    expect(reread.tracks).toHaveLength(original.tracks.length);

    // Coordinates and elevations compared exactly, not approximately. Text is
    // a format that can represent a double, so there is no excuse for drift.
    for (const [index, waypoint] of original.waypoints.entries()) {
      const after = reread.waypoints[index];
      expect(after?.lat).toBe(waypoint.lat);
      expect(after?.lon).toBe(waypoint.lon);
      expect(after?.ele).toBe(waypoint.ele);
      expect(after?.name).toBe(waypoint.name);
      expect(after?.description).toBe(waypoint.description);
      expect(after?.notes).toBe(waypoint.notes);
      expect(after?.time).toBe(waypoint.time);
    }

    expect(reread.routes[0]?.points.map((p) => [p.lat, p.lon, p.ele])).toEqual(
      original.routes[0]?.points.map((p) => [p.lat, p.lon, p.ele]),
    );

    // Segment structure survives, rather than being flattened into one run.
    expect(reread.tracks[0]?.segments.map((s) => s.points.length)).toEqual(
      original.tracks[0]?.segments.map((s) => s.points.length),
    );
    expect(
      reread.tracks[0]?.segments[0]?.points.map((p) => [p.lat, p.ele, p.time]),
    ).toEqual(
      original.tracks[0]?.segments[0]?.points.map((p) => [p.lat, p.ele, p.time]),
    );
  });

  it('keeps nulls null through a round trip', () => {
    const original = readGpx(fixture('no-elevation.gpx'), 'no-elevation.gpx');
    const reread = readGpx(
      writeGpx({
        waypoints: original.waypoints.map((w) => ({
          name: w.name,
          lat: w.lat,
          lon: w.lon,
          eleM: w.ele,
          description: w.description,
          symbol: w.symbol,
          notes: w.notes,
        })),
        tracks: original.tracks.map((t) => ({
          name: t.name,
          segments: t.segments.map((s) => ({
            points: s.points.map((p) => ({
              lat: p.lat,
              lon: p.lon,
              ele: p.ele,
              time: p.time,
            })),
          })),
        })),
      }),
      'exported.gpx',
    );

    // An absent elevation must not come back as 0, which would be a
    // fabricated sea-level reading.
    expect(reread.waypoints[0]?.ele).toBeNull();
    expect(
      reread.tracks[0]?.segments[0]?.points.every((p) => p.ele === null),
    ).toBe(true);
  });

  it('preserves full double precision', () => {
    const lat = 46.123456789012344;
    const lon = -8.987654321098764;
    const ele = 1850.5000000001;

    const written = writeGpx({
      waypoints: [
        {
          name: 'Precise',
          lat,
          lon,
          eleM: ele,
          description: null,
          symbol: null,
          notes: null,
        },
      ],
    });

    const reread = readGpx(written, 'precise.gpx');
    expect(reread.waypoints[0]?.lat).toBe(lat);
    expect(reread.waypoints[0]?.lon).toBe(lon);
    expect(reread.waypoints[0]?.ele).toBe(ele);
  });

  it('maps our symbols to Garmin names and passes imported ones through', () => {
    const written = writeGpx({
      waypoints: [
        {
          name: 'Known',
          lat: 1,
          lon: 1,
          eleM: null,
          description: null,
          symbol: 'summit',
          notes: null,
        },
        {
          name: 'Imported',
          lat: 2,
          lon: 2,
          eleM: null,
          description: null,
          symbol: 'Geocache Found',
          notes: null,
        },
      ],
    });

    expect(written).toContain('<sym>Summit</sym>');
    // Substituting our default here would corrupt someone else's data.
    expect(written).toContain('<sym>Geocache Found</sym>');
  });

  it('escapes text rather than emitting markup', () => {
    const written = writeGpx({
      waypoints: [
        {
          name: 'Caf\u00e9 & <Bar>',
          lat: 1,
          lon: 1,
          eleM: null,
          description: '<script>alert(1)</script>',
          symbol: null,
          notes: null,
        },
      ],
    });

    expect(written).toContain('Caf\u00e9 &amp; &lt;Bar&gt;');
    expect(written).not.toContain('<script>');

    // And it survives the round trip as the original text.
    const reread = readGpx(written, 'escaped.gpx');
    expect(reread.waypoints[0]?.name).toBe('Caf\u00e9 & <Bar>');
    expect(reread.waypoints[0]?.description).toBe('<script>alert(1)</script>');
  });

  it('produces well-formed GPX that detection recognises', () => {
    const written = writeGpx({
      name: 'Detectable',
      waypoints: [
        {
          name: 'A',
          lat: 1,
          lon: 2,
          eleM: null,
          description: null,
          symbol: null,
          notes: null,
        },
      ],
    });

    const detected = detectFormat(
      'untitled',
      new TextEncoder().encode(written),
    );
    expect(detected).toMatchObject({ kind: 'supported', format: 'gpx' });
  });

  it('writes an empty document without inventing content', () => {
    const written = writeGpx({});
    const reread = readGpx(written, 'empty.gpx');
    expect(reread.waypoints).toEqual([]);
    expect(reread.routes).toEqual([]);
    expect(reread.tracks).toEqual([]);
  });
});

describe('detectFormat', () => {
  it('uses the extension when it matches the content', () => {
    expect(
      detectFormat('a.gpx', bytes('<?xml version="1.0"?><gpx version="1.1"/>')),
    ).toEqual({ kind: 'supported', format: 'gpx', byExtension: true });
  });

  it('sniffs a GPX file that has the wrong extension', () => {
    const result = detectFormat(
      'mystery.xml',
      bytes('<?xml version="1.0"?><gpx version="1.1"/>'),
    );
    expect(result).toMatchObject({ kind: 'supported', format: 'gpx' });
  });

  it('recognises KML and TCX by content', () => {
    expect(
      detectFormat('x', bytes('<?xml version="1.0"?><kml xmlns="x"/>')),
    ).toMatchObject({ format: 'kml' });
    expect(
      detectFormat('x', bytes('<?xml version="1.0"?><TrainingCenterDatabase/>')),
    ).toMatchObject({ format: 'tcx' });
  });

  it('recognises a zip as KMZ by signature', () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    expect(detectFormat('whatever', zip)).toMatchObject({ format: 'kmz' });
  });

  it('recognises FIT by its header signature', () => {
    const fit = new Uint8Array(16);
    fit.set([0x2e, 0x46, 0x49, 0x54], 8); // ".FIT" at bytes 8..11
    expect(detectFormat('activity.bin', fit)).toMatchObject({ format: 'fit' });
  });

  it('explains why GDB is not supported instead of failing opaquely', () => {
    const result = detectFormat('trip.gdb', new Uint8Array([1, 2, 3, 4]));
    expect(result.kind).toBe('unsupported');
    if (result.kind === 'unsupported') {
      expect(result.reason).toMatch(/GPX/);
    }
  });

  it('explains IMG too', () => {
    expect(detectFormat('maps.img', new Uint8Array(8)).kind).toBe('unsupported');
  });

  it('requires a latitude-ish header before calling something CSV', () => {
    expect(
      detectFormat('x', bytes('name,latitude,longitude\nA,1,2')),
    ).toMatchObject({ format: 'csv' });
    // Arbitrary comma-separated prose is not a waypoint file.
    expect(detectFormat('x', bytes('one,two,three\n4,5,6')).kind).toBe('unknown');
  });

  it('only accepts our own JSON envelope', () => {
    expect(
      detectFormat('b.json', bytes('{"trailrt":{"version":1}}')),
    ).toMatchObject({ format: 'json' });
    // Someone else's JSON is not an importable backup.
    expect(detectFormat('other', bytes('{"foo":1}')).kind).toBe('unknown');
  });

  it('reports an unrecognised file with the supported list', () => {
    const result = detectFormat('notes.txt', bytes('just some words'));
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') expect(result.reason).toMatch(/gpx/);
  });
});
