import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXPORT_FORMATS, IMPORT_FORMATS } from '@shared/io/types';
import { createDatabase, type Db, type DbHandle } from '../db/client';
import { ServiceError } from '../services/errors';
import * as routeService from '../services/routeService';
import * as trackService from '../services/trackService';
import * as tripService from '../services/tripService';
import * as waypointService from '../services/waypointService';
import { readCsv } from './csv/read';
import {
  explainFormat,
  exportScope,
  formatOptions,
  isWritable,
  planExport,
} from './exportService';
import { readGpx } from './gpx/read';
import { readKml } from './kml/read';
import { readKmz } from './kmz/read';
import { parseCollection } from './json/read';

let dir: string;
let handle: DbHandle;
let db: Db;
let tripId: string;

const p = (
  lat: number,
  lon: number,
  ele: number | null = null,
  name: string | null = null,
) => ({ lat, lon, ele, name, symbol: null, notes: null });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailrt-export-'));
  handle = createDatabase({ file: join(dir, 'test.db') });
  db = handle.db;
  tripId = tripService.create(db, {
    name: 'Grimsel Tour',
    folderId: null,
    description: null,
    notes: null,
  }).result.id;
});

afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

function seedAll(): { routeId: string; trackId: string; waypointId: string } {
  const route = routeService.create(db, {
    tripId,
    name: 'Approach',
    colour: null,
    points: [
      p(46.5197, 8.012, 1850.5, 'Start'),
      p(46.5231, 8.0168, 1902.25),
    ],
  }).result;

  const track = trackService.createFromParsed(db, {
    tripId,
    source: 'import',
    parsed: {
      name: 'Recorded Walk',
      segments: [
        {
          points: [
            { lat: 46.5197, lon: 8.012, ele: 1850.5, time: 1_700_000_000_000 },
            { lat: 46.5231, lon: 8.0168, ele: null, time: 1_700_000_060_000 },
          ],
        },
      ],
      metadata: {},
    },
  }).result;

  const waypoint = waypointService.create(db, {
    tripId,
    groupId: null,
    name: 'Grimsel Hut',
    lat: 46.5197,
    lon: 8.012,
    eleM: 1850.5,
    description: 'Overnight stop',
    symbol: 'lodging',
    notes: null,
  }).result;

  return { routeId: route.id, trackId: track.id, waypointId: waypoint.id };
}

// ----------------------------------------------------------- writable set

describe('writable formats', () => {
  it('excludes TCX and FIT', () => {
    expect(isWritable('tcx')).toBe(false);
    expect(isWritable('fit')).toBe(false);
    expect(EXPORT_FORMATS).not.toContain('tcx');
    expect(EXPORT_FORMATS).not.toContain('fit');
  });

  it('includes every text format we read, except the read-only ones', () => {
    const readOnly = new Set(['tcx', 'fit']);
    const expected = IMPORT_FORMATS.filter((f) => !readOnly.has(f));
    expect([...EXPORT_FORMATS].toSorted()).toEqual([...expected].toSorted());
  });

  it('explains why a read-only format is not offered', () => {
    expect(explainFormat('tcx')).toMatch(/laps, device and session/);
    expect(explainFormat('fit')).toMatch(/device recording format/);
    expect(explainFormat('gdb')).toMatch(/no open writer/);
    expect(explainFormat('gpx')).toBeNull();
  });

  it('refuses to write a read-only format, with the reason', async () => {
    seedAll();
    await expect(
      exportScope(db, { kind: 'trips', tripIds: [tripId] }, 'tcx' as never),
    ).rejects.toThrow(/laps, device and session/);
  });
});

// ------------------------------------------------------------------- plan

describe('planExport', () => {
  it('counts what a GPX export will write', () => {
    seedAll();
    const plan = planExport(db, { kind: 'trips', tripIds: [tripId] }, 'gpx');

    expect(plan.willWrite).toEqual({ routes: 1, tracks: 1, waypoints: 1 });
    expect(plan.omitted).toEqual({ routes: 0, tracks: 0, waypoints: 0 });
    expect(plan.losses).toEqual([]);
    expect(plan.empty).toBe(false);
  });

  it('names what CSV cannot carry, before anything is written', () => {
    seedAll();
    const plan = planExport(db, { kind: 'trips', tripIds: [tripId] }, 'csv');

    expect(plan.willWrite).toEqual({ routes: 0, tracks: 0, waypoints: 1 });
    expect(plan.omitted).toEqual({ routes: 1, tracks: 1, waypoints: 0 });
    expect(plan.losses[0]).toMatch(
      /CSV holds waypoints only\. 1 route and 1 track will not be written/,
    );
  });

  it('reports an empty export rather than writing a useless file', () => {
    seedAll();
    const plan = planExport(db, { kind: 'route', id: seedAll().routeId }, 'csv');
    expect(plan.empty).toBe(true);
  });

  it('warns that KML loses per-point attributes on a route', () => {
    seedAll();
    const plan = planExport(db, { kind: 'trips', tripIds: [tripId] }, 'kml');
    expect(plan.losses.join(' ')).toMatch(
      /no per-point attributes.*1 route.*GPX keeps them/,
    );
  });

  it('warns that KML loses track timestamps', () => {
    seedAll();
    const plan = planExport(db, { kind: 'trips', tripIds: [tripId] }, 'kml');
    expect(plan.losses.join(' ')).toMatch(
      /no timestamps.*1 track.*GPX keeps them/,
    );
  });

  it('warns that KML drops waypoint symbols', () => {
    seedAll();
    const plan = planExport(db, { kind: 'trips', tripIds: [tripId] }, 'kml');
    expect(plan.losses.join(' ')).toMatch(/no Garmin symbol vocabulary/);
  });

  it('does not warn about losses that do not apply', () => {
    // A route with no per-point names, and a track with no timestamps.
    routeService.create(db, {
      tripId,
      name: 'Plain',
      colour: null,
      points: [p(46, 8), p(46.01, 8.01)],
    });
    trackService.createFromParsed(db, {
      tripId,
      source: 'user',
      parsed: {
        name: 'Untimed',
        segments: [
          {
            points: [
              { lat: 46, lon: 8, ele: null, time: null },
              { lat: 46.01, lon: 8.01, ele: null, time: null },
            ],
          },
        ],
        metadata: {},
      },
    });

    const plan = planExport(db, { kind: 'trips', tripIds: [tripId] }, 'kml');
    expect(plan.losses.join(' ')).not.toMatch(/per-point attributes/);
    expect(plan.losses.join(' ')).not.toMatch(/no timestamps/);
  });

  it('says a collection is only read by TrailRT', () => {
    seedAll();
    const plan = planExport(db, { kind: 'trips', tripIds: [tripId] }, 'json');
    expect(plan.losses.join(' ')).toMatch(/only read by TrailRT/);
  });

  it('says a collection export of one object covers its whole trip', () => {
    const { routeId } = seedAll();
    const plan = planExport(db, { kind: 'route', id: routeId }, 'json');
    expect(plan.losses.join(' ')).toMatch(/whole trips/);
  });

  it('suggests a filename from the scope, with no path characters', () => {
    const awkward = tripService.create(db, {
      name: 'Trip / 2026: "notes"',
      folderId: null,
      description: null,
      notes: null,
    }).result;

    const plan = planExport(db, { kind: 'trips', tripIds: [awkward.id] }, 'gpx');
    expect(plan.suggestedName).not.toMatch(/[/\\:"<>|?*]/);
    expect(plan.extension).toBe('gpx');
  });

  it('names a multi-trip export by its count', () => {
    const second = tripService.create(db, {
      name: 'Second',
      folderId: null,
      description: null,
      notes: null,
    }).result;

    const plan = planExport(
      db,
      { kind: 'trips', tripIds: [tripId, second.id] },
      'gpx',
    );
    expect(plan.suggestedName).toBe('2 trips');
  });

  it('offers every writable format with its own losses', () => {
    seedAll();
    const options = formatOptions(db, { kind: 'trips', tripIds: [tripId] });

    expect(options.map((o) => o.format)).toEqual([...EXPORT_FORMATS]);
    expect(options.find((o) => o.format === 'csv')?.losses.length).toBeGreaterThan(0);
    expect(options.find((o) => o.format === 'gpx')?.losses).toEqual([]);
  });

  it('refuses an empty selection rather than writing an empty file', () => {
    expect(() => planExport(db, { kind: 'trips', tripIds: [] }, 'gpx')).toThrow(
      ServiceError,
    );
  });

  it('refuses a trip that does not exist', () => {
    expect(() =>
      planExport(
        db,
        { kind: 'trips', tripIds: ['0190c3ae-1f2b-7c4d-9e8f-1a2b3c4d5e6f'] },
        'gpx',
      ),
    ).toThrow(ServiceError);
  });
});

// ------------------------------------------------------------------ scopes

describe('export scopes', () => {
  it('exports a single route', async () => {
    const { routeId } = seedAll();
    const result = await exportScope(db, { kind: 'route', id: routeId }, 'gpx');
    const reread = readGpx(result.text ?? '', 'out.gpx');

    expect(reread.routes).toHaveLength(1);
    expect(reread.tracks).toHaveLength(0);
    expect(reread.waypoints).toHaveLength(0);
    expect(reread.routes[0]?.name).toBe('Approach');
  });

  it('exports a single track', async () => {
    const { trackId } = seedAll();
    const result = await exportScope(db, { kind: 'track', id: trackId }, 'gpx');
    const reread = readGpx(result.text ?? '', 'out.gpx');

    expect(reread.tracks).toHaveLength(1);
    expect(reread.routes).toHaveLength(0);
  });

  it('exports a single waypoint', async () => {
    const { waypointId } = seedAll();
    const result = await exportScope(
      db,
      { kind: 'waypoint', id: waypointId },
      'gpx',
    );
    const reread = readGpx(result.text ?? '', 'out.gpx');

    expect(reread.waypoints).toHaveLength(1);
    expect(reread.waypoints[0]?.name).toBe('Grimsel Hut');
  });

  it('exports a whole trip', async () => {
    seedAll();
    const result = await exportScope(
      db,
      { kind: 'trips', tripIds: [tripId] },
      'gpx',
    );
    const reread = readGpx(result.text ?? '', 'out.gpx');

    expect(reread.routes).toHaveLength(1);
    expect(reread.tracks).toHaveLength(1);
    expect(reread.waypoints).toHaveLength(1);
  });

  it('exports a multi-trip selection into one document', async () => {
    seedAll();
    const second = tripService.create(db, {
      name: 'Second',
      folderId: null,
      description: null,
      notes: null,
    }).result;
    waypointService.create(db, {
      tripId: second.id,
      groupId: null,
      name: 'Elsewhere',
      lat: 45,
      lon: 7,
      eleM: null,
      description: null,
      symbol: '',
      notes: null,
    });

    const result = await exportScope(
      db,
      { kind: 'trips', tripIds: [tripId, second.id] },
      'gpx',
    );
    const reread = readGpx(result.text ?? '', 'out.gpx');

    expect(reread.waypoints.map((w) => w.name).toSorted()).toEqual([
      'Elsewhere',
      'Grimsel Hut',
    ]);
  });

  it('exports everything', async () => {
    seedAll();
    const result = await exportScope(db, { kind: 'everything' }, 'json');
    const collection = parseCollection(result.text ?? '');
    expect(collection.trips).toHaveLength(1);
  });
});

// -------------------------------------------------------------- round trip

describe('export round trips', () => {
  it('GPX reopens with identical geometry, including nulls', async () => {
    seedAll();
    const result = await exportScope(
      db,
      { kind: 'trips', tripIds: [tripId] },
      'gpx',
    );
    const reread = readGpx(result.text ?? '', 'out.gpx');

    expect(reread.routes[0]?.points[0]).toMatchObject({
      lat: 46.5197,
      lon: 8.012,
      ele: 1850.5,
      name: 'Start',
    });
    // The second point carried no name; it must not acquire one.
    expect(reread.routes[0]?.points[1]?.name).toBeNull();

    const points = reread.tracks[0]?.segments[0]?.points ?? [];
    expect(points[0]?.time).toBe(1_700_000_000_000);
    // The second track point had no elevation; still none.
    expect(points[1]?.ele).toBeNull();

    expect(reread.waypoints[0]?.ele).toBe(1850.5);
  });

  it('GPX writes the Garmin symbol name for a known symbol', async () => {
    seedAll();
    const result = await exportScope(
      db,
      { kind: 'trips', tripIds: [tripId] },
      'gpx',
    );
    // 'lodging' is in the vocabulary, so its Garmin name is written.
    expect(result.text).toMatch(/<sym>[^<]+<\/sym>/);
  });

  it('KML reopens with the coordinates in the right order', async () => {
    seedAll();
    const result = await exportScope(
      db,
      { kind: 'trips', tripIds: [tripId] },
      'kml',
    );
    const reread = readKml(result.text ?? '', 'out.kml');

    expect(reread.waypoints[0]).toMatchObject({
      name: 'Grimsel Hut',
      lat: 46.5197,
      lon: 8.012,
      ele: 1850.5,
    });
    // Route and track both come back as paths, which is what KML has.
    expect(reread.tracks.map((t) => t.name).toSorted()).toEqual([
      'Approach',
      'Recorded Walk',
    ]);
  });

  it('KMZ is a readable archive of the same content', async () => {
    seedAll();
    const result = await exportScope(
      db,
      { kind: 'trips', tripIds: [tripId] },
      'kmz',
    );

    expect(result.text).toBeUndefined();
    expect(result.bytes).toBeInstanceOf(Uint8Array);

    const reread = await readKmz(result.bytes as Uint8Array, 'out.kmz');
    expect(reread.waypoints[0]?.name).toBe('Grimsel Hut');
    expect(reread.tracks).toHaveLength(2);
  });

  it('CSV reopens with the waypoints and no invented elevation', async () => {
    waypointService.create(db, {
      tripId,
      groupId: null,
      name: 'No Height',
      lat: 45.9763,
      lon: 7.6586,
      eleM: null,
      description: null,
      symbol: '',
      notes: null,
    });

    const result = await exportScope(
      db,
      { kind: 'trips', tripIds: [tripId] },
      'csv',
    );
    const reread = readCsv(result.text ?? '', 'out.csv');

    expect(reread.waypoints).toHaveLength(1);
    expect(reread.waypoints[0]?.ele).toBeNull();
  });

  it('a collection export reopens as a collection', async () => {
    seedAll();
    const result = await exportScope(
      db,
      { kind: 'trips', tripIds: [tripId] },
      'json',
    );
    const collection = parseCollection(result.text ?? '');

    expect(collection.trips[0]?.name).toBe('Grimsel Tour');
    expect(collection.trips[0]?.routes).toHaveLength(1);
    expect(collection.trips[0]?.tracks).toHaveLength(1);
    expect(collection.trips[0]?.waypoints).toHaveLength(1);
  });

  it('carries the plan alongside the output, so the dialog can show it', async () => {
    seedAll();
    const result = await exportScope(
      db,
      { kind: 'trips', tripIds: [tripId] },
      'csv',
    );

    expect(result.plan.omitted.routes).toBe(1);
    expect(result.plan.losses.length).toBeGreaterThan(0);
  });
});
