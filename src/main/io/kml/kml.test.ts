import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ParseError } from '@shared/io/types';
import { isSafeEntryPath, readKmz } from '../kmz/read';
import { writeKmz } from '../kmz/write';
import { parseCoordinates, readKml } from './read';
import { routeToKmlPath, writeKml } from './write';

const FIXTURES = join(process.cwd(), 'test-data');
const GENERATED = join(FIXTURES, 'generated');

const fixture = (name: string): string =>
  readFileSync(join(FIXTURES, name), 'utf8');

// -------------------------------------------------------- coordinate parsing

describe('parseCoordinates', () => {
  // KML is lon,lat,ele — the reverse of GPX. This is the single most common
  // silent KML bug, so it gets its own assertions.
  it('reads lon,lat,ele in that order', () => {
    expect(parseCoordinates('8.0120,46.5197,1850.5')).toEqual([
      { lon: 8.012, lat: 46.5197, ele: 1850.5 },
    ]);
  });

  it('leaves a missing altitude null rather than 0', () => {
    expect(parseCoordinates('7.6586,45.9763')).toEqual([
      { lon: 7.6586, lat: 45.9763, ele: null },
    ]);
  });

  it('keeps an explicit zero altitude as 0', () => {
    expect(parseCoordinates('7.6586,45.9763,0')[0]?.ele).toBe(0);
  });

  it('splits tuples on any whitespace, including newlines and indentation', () => {
    const value = `
      8.0120,46.5197,1850.5
      8.0255,46.5310,2010
    `;
    expect(parseCoordinates(value)).toHaveLength(2);
  });

  it('tolerates a trailing comma on a tuple with no altitude', () => {
    expect(parseCoordinates('8.0,46.0,')[0]).toEqual({
      lon: 8,
      lat: 46,
      ele: null,
    });
  });

  it('drops tuples with out-of-range or unparseable values', () => {
    expect(parseCoordinates('8.0,91.0,100 abc 8.1,46.1,100')).toEqual([
      { lon: 8.1, lat: 46.1, ele: 100 },
    ]);
  });

  it('preserves full double precision', () => {
    const lon = 8.012012345678901;
    const lat = 46.519712345678904;
    const [point] = parseCoordinates(`${lon},${lat}`);
    expect(point?.lon).toBe(lon);
    expect(point?.lat).toBe(lat);
  });

  it('returns nothing for an empty node', () => {
    expect(parseCoordinates('')).toEqual([]);
    expect(parseCoordinates(null)).toEqual([]);
  });
});

// ------------------------------------------------------------------ KML read

describe('readKml', () => {
  const file = readKml(fixture('places.kml'), '/tmp/places.kml');

  it('reports the format and source name', () => {
    expect(file.format).toBe('kml');
    expect(file.sourceName).toBe('places.kml');
  });

  it('maps Point placemarks to waypoints with the correct axes', () => {
    const refuge = file.waypoints.find((w) => w.name === 'Refuge');
    expect(refuge).toBeDefined();
    expect(refuge?.lat).toBe(46.5197);
    expect(refuge?.lon).toBe(8.012);
    expect(refuge?.ele).toBe(1850.5);
    expect(refuge?.description).toBe('A hut, synthetic');
  });

  it('leaves an altitude-less point null', () => {
    const point = file.waypoints.find((w) => w.name === 'No Height Point');
    expect(point?.ele).toBeNull();
  });

  it('maps a LineString to a single-segment track', () => {
    const ridge = file.tracks.find((t) => t.name === 'Ridge Line');
    expect(ridge?.segments).toHaveLength(1);
    expect(ridge?.segments[0]?.points).toHaveLength(3);
    expect(ridge?.segments[0]?.points[0]).toEqual({
      lat: 46.5197,
      lon: 8.012,
      ele: 1850.5,
      // A LineString has no timestamps, and none are invented.
      time: null,
    });
  });

  it('maps a MultiGeometry to one track per LineString', () => {
    const track = file.tracks.find((t) => t.name === 'Two Parts');
    expect(track?.segments).toHaveLength(2);
    expect(track?.segments[0]?.points).toHaveLength(2);
    expect(track?.segments[1]?.points[0]?.lat).toBe(46.1);
  });

  it('preserves ExtendedData and names it as unmapped', () => {
    const refuge = file.waypoints.find((w) => w.name === 'Refuge');
    expect(refuge?.metadata.extendedData).toEqual({
      capacity: '40',
      warden: 'summer only',
    });
    expect(file.unmappedMetadata).toContain('KML ExtendedData "capacity"');
    expect(file.unmappedMetadata).toContain('KML ExtendedData "warden"');
  });

  it('does not treat a Document name as a folder', () => {
    const refuge = file.waypoints.find((w) => w.name === 'Refuge');
    expect(refuge?.metadata.kmlFolderPath).toBeUndefined();
  });

  it('reads gx:Track, pairing when with gx:coord by position', () => {
    const timed = readKml(fixture('gx-track.kml'), '/tmp/gx-track.kml');
    const track = timed.tracks[0];

    expect(track?.name).toBe('Recorded Walk');
    expect(track?.segments[0]?.points).toHaveLength(3);
    expect(track?.segments[0]?.points[0]).toEqual({
      lat: 46.5197,
      lon: 8.012,
      ele: 1850.5,
      time: Date.parse('2026-07-14T06:30:00Z'),
    });
    expect(track?.segments[0]?.points[2]?.time).toBe(
      Date.parse('2026-07-14T07:00:00Z'),
    );
  });

  it('warns when gx:Track timestamps and coordinates do not pair up', () => {
    const kml = `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Document><Placemark><name>Lopsided</name><gx:Track>
    <when>2026-01-01T00:00:00Z</when>
    <gx:coord>8.0 46.0 100</gx:coord>
    <gx:coord>8.1 46.1 110</gx:coord>
  </gx:Track></Placemark></Document>
</kml>`;
    const result = readKml(kml, '/tmp/lopsided.kml');

    expect(result.warnings.join(' ')).toMatch(/1 timestamps for 2 coordinates/);
    // Untimed rather than guessed.
    expect(
      result.tracks[0]?.segments[0]?.points.every((p) => p.time === null),
    ).toBe(true);
  });

  it('carries a nested Folder path into metadata', () => {
    const kml = `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document><name>Doc</name>
    <Folder><name>Europe</name>
      <Folder><name>Alps</name>
        <Placemark><name>Hut</name><Point><coordinates>8,46</coordinates></Point></Placemark>
      </Folder>
    </Folder>
  </Document>
</kml>`;
    const result = readKml(kml, '/tmp/nested.kml');
    expect(result.waypoints[0]?.metadata.kmlFolderPath).toEqual([
      'Europe',
      'Alps',
    ]);
  });

  it('reads placemarks sitting directly under <kml>, with no Document', () => {
    const kml = `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Placemark><name>Bare</name><Point><coordinates>8,46</coordinates></Point></Placemark>
</kml>`;
    expect(readKml(kml, '/tmp/bare.kml').waypoints).toHaveLength(1);
  });

  it('reports an unsupported geometry as skipped rather than dropping it', () => {
    const kml = `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document><Placemark><name>Area</name>
    <Polygon><outerBoundaryIs><LinearRing><coordinates>8,46 8.1,46 8,46.1 8,46</coordinates></LinearRing></outerBoundaryIs></Polygon>
  </Placemark></Document>
</kml>`;
    const result = readKml(kml, '/tmp/polygon.kml');

    expect(result.waypoints).toHaveLength(0);
    expect(result.tracks).toHaveLength(0);
    expect(result.skipped[0]?.name).toBe('Area');
    expect(result.skipped[0]?.reason).toMatch(/Polygon/);
  });

  it('reads SchemaData as well as plain Data', () => {
    const kml = `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document><Placemark><name>Typed</name>
    <ExtendedData><SchemaData schemaUrl="#s"><SimpleData name="grade">T3</SimpleData></SchemaData></ExtendedData>
    <Point><coordinates>8,46</coordinates></Point>
  </Placemark></Document>
</kml>`;
    const result = readKml(kml, '/tmp/typed.kml');
    expect(result.waypoints[0]?.metadata.extendedData).toEqual({ grade: 'T3' });
  });

  it('treats a description containing markup as plain text', () => {
    const kml = `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document><Placemark><name>Hostile</name>
    <description>&lt;img src=x onerror="alert(1)"&gt;</description>
    <Point><coordinates>8,46</coordinates></Point>
  </Placemark></Document>
</kml>`;
    const result = readKml(kml, '/tmp/hostile.kml');
    // The markup survives as characters, which is what makes it safe: it is
    // data, and nothing in the app renders it as HTML.
    expect(result.waypoints[0]?.description).toBe(
      '<img src=x onerror="alert(1)">',
    );
  });

  it('fails with a located message on malformed XML, importing nothing', () => {
    expect(() => readKml('<kml><Document>', '/tmp/bad.kml')).toThrow(
      ParseError,
    );
  });

  it('rejects a file with no kml root', () => {
    expect(() => readKml('<gpx version="1.1"/>', '/tmp/wrong.kml')).toThrow(
      /no <kml> root element/,
    );
  });

  it('accepts a valid document containing nothing', () => {
    const result = readKml(
      '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Empty</name></Document></kml>',
      '/tmp/empty.kml',
    );
    expect(result.waypoints).toHaveLength(0);
    expect(result.tracks).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });
});

// ----------------------------------------------------------------- KML write

describe('writeKml', () => {
  it('emits coordinates as lon,lat,ele', () => {
    const output = writeKml({
      waypoints: [
        {
          name: 'Refuge',
          lat: 46.5197,
          lon: 8.012,
          eleM: 1850.5,
          description: null,
        },
      ],
    });
    expect(output).toContain('<coordinates>8.012,46.5197,1850.5</coordinates>');
  });

  it('omits an absent altitude instead of writing 0', () => {
    const output = writeKml({
      waypoints: [
        { name: 'Flat', lat: 46, lon: 8, eleM: null, description: null },
      ],
    });
    expect(output).toContain('<coordinates>8,46</coordinates>');
    expect(output).not.toContain('altitudeMode');
  });

  it('escapes text rather than emitting markup', () => {
    const output = writeKml({
      waypoints: [
        {
          name: 'A & B <hut>',
          lat: 46,
          lon: 8,
          eleM: null,
          description: '<script>x</script>',
        },
      ],
    });
    expect(output).toContain('<name>A &amp; B &lt;hut&gt;</name>');
    expect(output).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(output).not.toContain('<script>');
  });

  it('wraps a multi-segment path in a MultiGeometry', () => {
    const output = writeKml({
      paths: [
        {
          name: 'Two Parts',
          segments: [
            {
              points: [
                { lat: 46, lon: 8, ele: null, time: null },
                { lat: 46.01, lon: 8.01, ele: null, time: null },
              ],
            },
            {
              points: [
                { lat: 46.1, lon: 8.1, ele: null, time: null },
                { lat: 46.11, lon: 8.11, ele: null, time: null },
              ],
            },
          ],
        },
      ],
    });
    expect(output).toContain('<MultiGeometry>');
    expect(output.match(/<LineString>/g)).toHaveLength(2);
  });

  it('writes a single-segment path as a bare LineString', () => {
    const output = writeKml({
      paths: [
        {
          name: 'One',
          segments: [
            {
              points: [
                { lat: 46, lon: 8, ele: null, time: null },
                { lat: 46.01, lon: 8.01, ele: null, time: null },
              ],
            },
          ],
        },
      ],
    });
    expect(output).not.toContain('MultiGeometry');
    expect(output).toContain('<LineString>');
  });

  it('writes ExtendedData back', () => {
    const output = writeKml({
      waypoints: [
        {
          name: 'Refuge',
          lat: 46,
          lon: 8,
          eleM: null,
          description: null,
          extendedData: { capacity: '40' },
        },
      ],
    });
    expect(output).toContain('<Data name="capacity"><value>40</value></Data>');
  });
});

// ------------------------------------------------------------- KML roundtrip

describe('KML round trip', () => {
  it('preserves waypoint coordinates and nulls exactly', () => {
    const original = readKml(fixture('places.kml'), '/tmp/places.kml');

    const output = writeKml({
      name: 'Round Trip',
      waypoints: original.waypoints.map((w) => ({
        name: w.name,
        lat: w.lat,
        lon: w.lon,
        eleM: w.ele,
        description: w.description,
        extendedData: w.metadata.extendedData as
          | Record<string, string>
          | undefined,
      })),
      paths: original.tracks.map((t) => ({
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

    const reread = readKml(output, '/tmp/out.kml');

    expect(reread.waypoints.map((w) => [w.name, w.lat, w.lon, w.ele])).toEqual(
      original.waypoints.map((w) => [w.name, w.lat, w.lon, w.ele]),
    );
    expect(
      reread.tracks.map((t) => t.segments.map((s) => s.points)),
    ).toEqual(original.tracks.map((t) => t.segments.map((s) => s.points)));
  });

  it('preserves a route written as a path, to full precision', () => {
    const points = [
      { lat: 46.519712345678904, lon: 8.012012345678901, ele: 1850.5, name: 'A', symbol: null, notes: null },
      { lat: 46.53109876543211, lon: 8.02559876543211, ele: null, name: null, symbol: null, notes: null },
    ];

    const output = writeKml({
      paths: [routeToKmlPath('Ridge', points)],
    });
    const track = readKml(output, '/tmp/route.kml').tracks[0];

    expect(track?.segments[0]?.points[0]?.lat).toBe(points[0]?.lat);
    expect(track?.segments[0]?.points[0]?.lon).toBe(points[0]?.lon);
    expect(track?.segments[0]?.points[1]?.ele).toBeNull();
  });
});

// ---------------------------------------------------------------------- KMZ

describe('readKmz', () => {
  it('reads the KML inside the archive', async () => {
    const bytes = readFileSync(join(GENERATED, 'places.kmz'));
    const file = await readKmz(new Uint8Array(bytes), '/tmp/places.kmz');

    expect(file.format).toBe('kmz');
    expect(file.sourceName).toBe('places.kmz');
    expect(file.waypoints.length).toBeGreaterThan(0);
    expect(file.tracks.length).toBeGreaterThan(0);
  });

  it('fails with an explanation when the archive holds no KML', async () => {
    const bytes = readFileSync(join(GENERATED, 'no-document.kmz'));
    await expect(
      readKmz(new Uint8Array(bytes), '/tmp/no-document.kmz'),
    ).rejects.toThrow(/contains no KML document/);
  });

  it('rejects something that is not a zip', async () => {
    await expect(
      readKmz(new TextEncoder().encode('not a zip'), '/tmp/fake.kmz'),
    ).rejects.toThrow(ParseError);
  });

  it('reports non-KML archive resources as skipped', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file(
      'doc.kml',
      '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>P</name><Point><coordinates>8,46</coordinates></Point></Placemark></Document></kml>',
    );
    zip.file('files/icon.png', new Uint8Array([1, 2, 3]));
    const bytes = await zip.generateAsync({ type: 'uint8array' });

    const file = await readKmz(bytes, '/tmp/with-icon.kmz');
    expect(file.waypoints).toHaveLength(1);
    expect(file.skipped.map((s) => s.name)).toContain('files/icon.png');
  });

  it('falls back to the first KML entry and says so', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file(
      'b-second.kml',
      '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>',
    );
    zip.file(
      'a-first.kml',
      '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>First</name><Point><coordinates>8,46</coordinates></Point></Placemark></Document></kml>',
    );
    const bytes = await zip.generateAsync({ type: 'uint8array' });

    const file = await readKmz(bytes, '/tmp/two.kmz');

    // Sorted by name, so the choice is deterministic rather than dependent on
    // central-directory order.
    expect(file.waypoints[0]?.name).toBe('First');
    expect(file.warnings.join(' ')).toMatch(/no doc\.kml/);
    expect(file.skipped.map((s) => s.name)).toContain('b-second.kml');
  });

  // jszip normalises names as it writes, so a traversal entry cannot be built
  // with its own builder. The guard is therefore tested directly.
  it.each([
    ['../escape.txt', false],
    ['a/../../escape.txt', false],
    ['/absolute.kml', false],
    ['C:/windows/evil.kml', false],
    ['doc.kml', true],
    ['files/icon.png', true],
    ['a..b/doc.kml', true],
  ])('treats %s as safe=%s', (path, safe) => {
    expect(isSafeEntryPath(path)).toBe(safe);
  });
});

describe('writeKmz', () => {
  it('produces an archive that reads back identically', async () => {
    const bytes = await writeKmz({
      name: 'Trip',
      waypoints: [
        {
          name: 'Refuge',
          lat: 46.5197,
          lon: 8.012,
          eleM: 1850.5,
          description: 'A hut',
        },
      ],
      paths: [
        {
          name: 'Ridge',
          segments: [
            {
              points: [
                { lat: 46.5197, lon: 8.012, ele: 1850.5, time: null },
                { lat: 46.531, lon: 8.0255, ele: null, time: null },
              ],
            },
          ],
        },
      ],
    });

    const file = await readKmz(bytes, '/tmp/out.kmz');

    expect(file.waypoints[0]).toMatchObject({
      name: 'Refuge',
      lat: 46.5197,
      lon: 8.012,
      ele: 1850.5,
      description: 'A hut',
    });
    expect(file.tracks[0]?.segments[0]?.points[1]?.ele).toBeNull();
    expect(file.warnings).toHaveLength(0);
    expect(file.skipped).toHaveLength(0);
  });

  it('is byte-for-byte deterministic for the same input', async () => {
    const input = {
      waypoints: [
        { name: 'A', lat: 46, lon: 8, eleM: null, description: null },
      ],
    };
    const first = await writeKmz(input);
    const second = await writeKmz(input);
    expect(first).toEqual(second);
  });
});
