import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ParseError } from '@shared/io/types';
import { readGpx } from './read';

const fixture = (name: string): string =>
  readFileSync(join(process.cwd(), 'test-data', name), 'utf8');

const read = (name: string) => readGpx(fixture(name), `test-data/${name}`);

describe('readGpx: a complete file', () => {
  const file = read('alps-full.gpx');

  it('reports the source name, for naming an auto-created trip', () => {
    expect(file.sourceName).toBe('alps-full.gpx');
    expect(file.format).toBe('gpx');
  });

  it('reads waypoints, routes and tracks', () => {
    expect(file.waypoints).toHaveLength(2);
    expect(file.routes).toHaveLength(1);
    expect(file.tracks).toHaveLength(1);
  });

  it('preserves waypoint fields exactly', () => {
    expect(file.waypoints[0]).toEqual({
      name: 'Grimsel Hut',
      lat: 46.5197,
      lon: 8.012,
      ele: 1850.5,
      description: 'Overnight stop',
      symbol: 'Lodging',
      notes: 'Booked for two nights',
      time: Date.parse('2026-07-14T06:30:00Z'),
      metadata: {},
    });
  });

  it('leaves absent optional fields null rather than empty strings', () => {
    const spring = file.waypoints[1];
    expect(spring?.description).toBeNull();
    expect(spring?.notes).toBeNull();
    expect(spring?.time).toBeNull();
  });

  it('preserves route point order and elevation', () => {
    const route = file.routes[0];
    expect(route?.name).toBe('Day 1 Planned');
    expect(route?.points.map((p) => p.lon)).toEqual([8.012, 8.0255, 8.0431]);
    expect(route?.points.map((p) => p.ele)).toEqual([1850.5, 2010, 2431]);
    expect(route?.points[0]?.name).toBe('Start');
  });

  it('keeps track segments separate', () => {
    const track = file.tracks[0];
    expect(track?.name).toBe('Day 1 Recorded');
    // Joining the two segments would invent travel across the gap between them.
    expect(track?.segments).toHaveLength(2);
    expect(track?.segments[0]?.points).toHaveLength(3);
    expect(track?.segments[1]?.points).toHaveLength(2);
  });

  it('preserves track point elevation and time', () => {
    const first = file.tracks[0]?.segments[0]?.points[1];
    expect(first?.ele).toBe(1902.25);
    expect(first?.time).toBe(Date.parse('2026-07-14T06:45:00Z'));
  });

  it('reports nothing skipped and no warnings', () => {
    expect(file.skipped).toEqual([]);
    expect(file.warnings).toEqual([]);
  });
});

describe('readGpx: absent data stays absent', () => {
  const file = read('no-elevation.gpx');

  it('reads elevation as null, never 0', () => {
    expect(file.waypoints[0]?.ele).toBeNull();
    expect(file.routes[0]?.points.every((p) => p.ele === null)).toBe(true);
    expect(
      file.tracks[0]?.segments[0]?.points.every((p) => p.ele === null),
    ).toBe(true);
    // The distinction that matters: not a falsy zero.
    expect(file.waypoints[0]?.ele).not.toBe(0);
  });

  it('still reads timestamps that are present', () => {
    expect(file.tracks[0]?.segments[0]?.points[0]?.time).toBe(
      Date.parse('2026-08-01T05:00:00Z'),
    );
  });
});

describe('readGpx: untimed tracks', () => {
  it('reads time as null while keeping elevation', () => {
    const file = read('no-time.gpx');
    const points = file.tracks[0]?.segments[0]?.points ?? [];
    expect(points.every((p) => p.time === null)).toBe(true);
    expect(points.map((p) => p.ele)).toEqual([1000, 1050, 980]);
  });
});

describe('readGpx: multi-segment tracks', () => {
  it('preserves all three segments and their sizes', () => {
    const file = read('multi-segment.gpx');
    const track = file.tracks[0];
    expect(track?.segments.map((s) => s.points.length)).toEqual([2, 3, 1]);
  });
});

describe('readGpx: GPX 1.0', () => {
  const file = read('legacy-1.0.gpx');

  it('reads the older version with the same geometry handling', () => {
    expect(file.waypoints).toHaveLength(1);
    expect(file.tracks).toHaveLength(1);
    expect(file.waypoints[0]?.ele).toBe(408);
  });

  it('reports 1.0-only elements as unmapped rather than dropping them', () => {
    // <url> and <urlname> have no column, so they must be preserved and named.
    expect(file.waypoints[0]?.metadata).toMatchObject({
      url: 'https://example.invalid/point',
      urlname: 'Reference',
    });
  });
});

describe('readGpx: extensions', () => {
  const file = read('with-extensions.gpx');

  it('preserves extension content in metadata', () => {
    expect(file.waypoints[0]?.metadata.extensions).toBeDefined();
    expect(file.tracks[0]?.metadata.extensions).toBeDefined();
  });

  it('names the unmapped extensions in the report', () => {
    // The user has to be told these survived but are not understood.
    const unmapped = file.unmappedMetadata.join(' | ');
    expect(unmapped).toMatch(/WaypointExtension/);
    expect(unmapped).toMatch(/TrackExtension/);
  });

  it('does not silently discard anything', () => {
    expect(file.unmappedMetadata.length).toBeGreaterThan(0);
  });
});

describe('readGpx: unknown symbols', () => {
  it('keeps a symbol outside our vocabulary verbatim', () => {
    const file = read('unknown-symbol.gpx');
    // Phase 3 export has to write this back unchanged.
    expect(file.waypoints[0]?.symbol).toBe('Geocache Found');
  });
});

describe('readGpx: empty but valid', () => {
  it('succeeds with zero objects rather than failing', () => {
    const file = read('empty.gpx');
    expect(file.waypoints).toEqual([]);
    expect(file.routes).toEqual([]);
    expect(file.tracks).toEqual([]);
    expect(file.skipped).toEqual([]);
  });
});

describe('readGpx: malformed input', () => {
  it('throws with the problem located, importing nothing', () => {
    let error: unknown;
    try {
      read('malformed.gpx');
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(ParseError);
    expect((error as ParseError).message).toMatch(/not valid XML/i);
    // A located message is what makes this actionable.
    expect((error as ParseError).message).toMatch(/line \d+/);
  });

  it('rejects XML that is not GPX', () => {
    expect(() => readGpx('<?xml version="1.0"?><root/>', 'x.gpx')).toThrow(
      /not a GPX file/i,
    );
  });
});

describe('readGpx: malformed geometry inside valid XML', () => {
  it('skips a waypoint with no coordinates and says so', () => {
    const gpx = `<?xml version="1.0"?>
      <gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
        <wpt lat="46.5"><name>Half a point</name></wpt>
        <wpt lat="46.6" lon="8.1"><name>Fine</name></wpt>
      </gpx>`;
    const file = readGpx(gpx, 'partial.gpx');

    expect(file.waypoints).toHaveLength(1);
    expect(file.waypoints[0]?.name).toBe('Fine');
    expect(file.skipped).toHaveLength(1);
    expect(file.skipped[0]?.reason).toMatch(/coordinates/i);
  });

  it('skips out-of-range coordinates rather than storing them', () => {
    const gpx = `<?xml version="1.0"?>
      <gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
        <wpt lat="95" lon="8.1"><name>Impossible</name></wpt>
      </gpx>`;
    const file = readGpx(gpx, 'bad.gpx');
    expect(file.waypoints).toEqual([]);
    expect(file.warnings.join(' ')).toMatch(/out of range/i);
  });

  it('reports a route with no points as skipped', () => {
    const gpx = `<?xml version="1.0"?>
      <gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
        <rte><name>Hollow</name></rte>
      </gpx>`;
    const file = readGpx(gpx, 'hollow.gpx');
    expect(file.routes).toEqual([]);
    expect(file.skipped[0]).toMatchObject({ kind: 'route', name: 'Hollow' });
  });
});

describe('readGpx: text handling', () => {
  it('decodes entities and keeps content as plain text', () => {
    const gpx = `<?xml version="1.0"?>
      <gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
        <wpt lat="1" lon="2">
          <name>Caf&amp;eacute; &amp; Bar</name>
          <desc>&lt;script&gt;alert(1)&lt;/script&gt;</desc>
        </wpt>
      </gpx>`;
    const file = readGpx(gpx, 'entities.gpx');

    expect(file.waypoints[0]?.name).toBe('Caf&eacute; & Bar');
    // Preserved exactly as text. Nothing here is ever rendered as markup.
    expect(file.waypoints[0]?.description).toBe('<script>alert(1)</script>');
  });

  it('does not treat a numeric-looking name as a number', () => {
    const gpx = `<?xml version="1.0"?>
      <gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
        <wpt lat="1" lon="2"><name>007</name></wpt>
      </gpx>`;
    // Auto-parsing would turn "007" into 7 and lose the user's name.
    expect(readGpx(gpx, 'n.gpx').waypoints[0]?.name).toBe('007');
  });
});

describe('readGpx: a large file', () => {
  it('reads 200,000 points in reasonable time', () => {
    let content: string;
    try {
      content = readFileSync(
        join(process.cwd(), 'test-data/generated/large-track.gpx'),
        'utf8',
      );
    } catch {
      // Generated fixtures are not committed; skip rather than fail.
      return;
    }

    const started = Date.now();
    const file = readGpx(content, 'large-track.gpx');
    const elapsed = Date.now() - started;

    expect(file.tracks[0]?.segments[0]?.points).toHaveLength(200_000);
    // Generous, because CI machines vary. The point is that it is seconds, not
    // minutes, and that nothing quadratic crept in.
    expect(elapsed).toBeLessThan(30_000);
  });
});
