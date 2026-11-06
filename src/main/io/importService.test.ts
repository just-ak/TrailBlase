import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ImportProgress } from '@shared/io/types';
import { createDatabase, type Db, type DbHandle } from '../db/client';
import * as historyRepo from '../db/repositories/importHistory';
import { ServiceError } from '../services/errors';
import * as routeService from '../services/routeService';
import * as trackService from '../services/trackService';
import * as tripService from '../services/tripService';
import * as waypointService from '../services/waypointService';
import { buildCollection, writeCollection } from './json/write';
import {
  commitFile,
  importFiles,
  listHistory,
  parseFile,
  previewOf,
} from './importService';

const FIXTURES = join(process.cwd(), 'test-data');

let dir: string;
let handle: DbHandle;
let db: Db;
let work: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailrt-import-'));
  work = mkdtempSync(join(tmpdir(), 'trailrt-files-'));
  handle = createDatabase({ file: join(dir, 'test.db') });
  db = handle.db;
});

afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
});

const fixture = (name: string): string => join(FIXTURES, name);

const write = (name: string, content: string): string => {
  const path = join(work, name);
  writeFileSync(path, content);
  return path;
};

const newTrip = (name = 'Target') =>
  tripService.create(db, {
    name,
    folderId: null,
    description: null,
    notes: null,
  }).result;

// ------------------------------------------------------------------- parse

describe('parseFile', () => {
  it('parses a GPX file without touching the database', async () => {
    const before = tripService.list(db, {
      includeArchived: true,
      sortKey: 'name',
      sortDirection: 'asc',
    }).length;

    const result = await parseFile(fixture('alps-full.gpx'));

    expect(result.file.format).toBe('gpx');
    expect(result.file.waypoints.length).toBeGreaterThan(0);
    // The point of separating parse from commit: a preview writes nothing.
    expect(
      tripService.list(db, {
        includeArchived: true,
        sortKey: 'name',
        sortDirection: 'asc',
      }),
    ).toHaveLength(before);
  });

  it('parses every supported text format', async () => {
    for (const [name, format] of [
      ['alps-full.gpx', 'gpx'],
      ['legacy-1.0.gpx', 'gpx'],
      ['places.kml', 'kml'],
      ['gx-track.kml', 'kml'],
      ['activity.tcx', 'tcx'],
      ['waypoints.csv', 'csv'],
    ] as const) {
      const result = await parseFile(fixture(name));
      expect(result.file.format, name).toBe(format);
    }
  });

  it('parses a KMZ archive', async () => {
    const result = await parseFile(
      join(FIXTURES, 'generated', 'places.kmz'),
    );
    expect(result.file.format).toBe('kmz');
  });

  it('parses a FIT file', async () => {
    const result = await parseFile(
      join(FIXTURES, 'generated', 'activity.fit'),
    );
    expect(result.file.format).toBe('fit');
    expect(result.file.tracks).toHaveLength(1);
  });

  it('explains why GDB is unsupported instead of failing obscurely', async () => {
    const path = write('places.gdb', 'not really a gdb');
    await expect(parseFile(path)).rejects.toThrow(/proprietary binary format/);
  });

  it('refuses a file it does not recognise', async () => {
    const path = write('mystery.dat', 'just some text');
    await expect(parseFile(path)).rejects.toThrow(/not a format TrailRT/);
  });

  it('refuses a file that does not exist', async () => {
    await expect(parseFile(join(work, 'absent.gpx'))).rejects.toThrow(
      ServiceError,
    );
  });

  it('warns when the extension disagrees with the contents', async () => {
    const path = write(
      'mystery.xml',
      '<?xml version="1.0"?><gpx version="1.1"><wpt lat="46" lon="8"><name>A</name></wpt></gpx>',
    );
    const result = await parseFile(path);
    expect(result.file.warnings.join(' ')).toMatch(/does not match its contents/);
  });

  it('strips a byte-order mark rather than choking on it', async () => {
    const path = write(
      'bom.gpx',
      `\uFEFF<?xml version="1.0"?><gpx version="1.1"><wpt lat="46" lon="8"><name>A</name></wpt></gpx>`,
    );
    const result = await parseFile(path);
    expect(result.file.waypoints).toHaveLength(1);
  });

  it('fails on malformed XML, naming the problem', async () => {
    await expect(parseFile(fixture('malformed.gpx'))).rejects.toThrow(
      /not valid XML/,
    );
  });
});

// ----------------------------------------------------------------- preview

describe('previewOf', () => {
  it('reports counts and names without writing anything', async () => {
    const preview = previewOf(await parseFile(fixture('alps-full.gpx')));

    expect(preview.format).toBe('gpx');
    expect(preview.sourceName).toBe('alps-full.gpx');
    expect(preview.counts.routes).toBe(preview.routeNames.length);
    expect(preview.counts.tracks).toBe(preview.trackNames.length);
    expect(preview.counts.waypoints).toBe(preview.waypointNames.length);
    expect(preview.counts.points).toBeGreaterThan(0);
  });

  it('carries the skipped and unmapped lists through', async () => {
    const preview = previewOf(await parseFile(fixture('with-extensions.gpx')));
    expect(preview.unmappedMetadata.length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ commit

describe('commitFile', () => {
  it('writes into the chosen trip', async () => {
    const trip = newTrip();
    const parsed = await parseFile(fixture('alps-full.gpx'));

    const report = commitFile(db, parsed, { destinationTripId: trip.id });

    expect(report.status).not.toBe('failed');
    expect(report.destinationTripId).toBe(trip.id);
    expect(report.destinationTripName).toBe('Target');
    expect(routeService.listForTrip(db, trip.id)).toHaveLength(
      report.imported.routes,
    );
    expect(trackService.listForTrip(db, trip.id)).toHaveLength(
      report.imported.tracks,
    );
    expect(waypointService.listForTrip(db, trip.id)).toHaveLength(
      report.imported.waypoints,
    );
  });

  it('creates a trip named after the file when no destination is given', async () => {
    const parsed = await parseFile(fixture('alps-full.gpx'));
    const report = commitFile(db, parsed, { destinationTripId: null });

    expect(report.destinationTripName).toBe('alps-full');
    const trips = tripService.list(db, {
      includeArchived: true,
      sortKey: 'name',
      sortDirection: 'asc',
    });
    expect(trips.map((t) => t.name)).toContain('alps-full');
  });

  it('report counts match what was actually written', async () => {
    const trip = newTrip();
    const parsed = await parseFile(fixture('alps-full.gpx'));
    const report = commitFile(db, parsed, { destinationTripId: trip.id });

    const routePoints = routeService
      .listForTrip(db, trip.id)
      .reduce((sum, route) => sum + route.pointCount, 0);
    const trackPoints = trackService
      .listForTrip(db, trip.id)
      .reduce((sum, track) => sum + track.pointCount, 0);
    const waypoints = waypointService.listForTrip(db, trip.id).length;

    expect(report.imported.points).toBe(routePoints + trackPoints + waypoints);
  });

  it('imports only the selected objects and says what it left out', async () => {
    const trip = newTrip();
    const parsed = await parseFile(fixture('alps-full.gpx'));

    const report = commitFile(db, parsed, {
      destinationTripId: trip.id,
      routeIndices: [],
      trackIndices: [],
      waypointIndices: [0],
    });

    expect(report.imported.waypoints).toBe(1);
    expect(report.imported.routes).toBe(0);
    expect(report.imported.tracks).toBe(0);
    // Deselected objects are reported, not silently dropped.
    expect(report.warnings.join(' ')).toMatch(/not selected/);
  });

  it('preserves absent elevation as null through the whole pipeline', async () => {
    const trip = newTrip();
    const parsed = await parseFile(fixture('no-elevation.gpx'));
    commitFile(db, parsed, { destinationTripId: trip.id });

    for (const route of routeService.listForTrip(db, trip.id)) {
      expect(route.elevGainM).toBeNull();
    }
    for (const waypoint of waypointService.listForTrip(db, trip.id)) {
      expect(waypoint.eleM).toBeNull();
    }
  });

  it('retains the original bytes with an imported track', async () => {
    const trip = newTrip();
    const parsed = await parseFile(fixture('multi-segment.gpx'));
    const bytes = new TextEncoder().encode('original file bytes');

    commitFile(
      db,
      parsed,
      { destinationTripId: trip.id },
      { originalBytes: bytes },
    );

    const track = trackService.listForTrip(db, trip.id)[0];
    expect(track).toBeDefined();
    expect(trackService.originalBytes(db, track?.id ?? '')?.bytes).toEqual(
      bytes,
    );
  });

  it('marks imported objects as imports, not user geometry', async () => {
    const trip = newTrip();
    commitFile(db, await parseFile(fixture('alps-full.gpx')), {
      destinationTripId: trip.id,
    });

    expect(
      routeService.listForTrip(db, trip.id).every((r) => r.source === 'import'),
    ).toBe(true);
    expect(
      trackService.listForTrip(db, trip.id).every((t) => t.source === 'import'),
    ).toBe(true);
  });

  it('preserves unmapped metadata rather than reporting it and dropping it', async () => {
    const trip = newTrip();
    const parsed = await parseFile(fixture('with-extensions.gpx'));
    const report = commitFile(db, parsed, { destinationTripId: trip.id });

    expect(report.unmappedMetadata.length).toBeGreaterThan(0);

    // The claim in the report has to be true in the database.
    const collection = buildCollection(db, { tripIds: [trip.id] });
    const stored = [
      ...(collection.trips[0]?.routes ?? []).map((r) => r.metadata),
      ...(collection.trips[0]?.tracks ?? []).map((t) => t.metadata),
      ...(collection.trips[0]?.waypoints ?? []).map((w) => w.metadata),
    ];
    expect(stored.some((m) => Object.keys(m).length > 0)).toBe(true);
  });

  it('imports an empty-but-valid file as zero objects, not an error', async () => {
    const trip = newTrip();
    const report = commitFile(db, await parseFile(fixture('empty.gpx')), {
      destinationTripId: trip.id,
    });

    expect(report.status).toBe('success');
    expect(report.imported).toEqual({
      routes: 0,
      tracks: 0,
      waypoints: 0,
      points: 0,
    });
  });

  it('reports a status of partial when the file had skipped objects', async () => {
    const trip = newTrip();
    const path = write(
      'partly-bad.gpx',
      `<?xml version="1.0"?><gpx version="1.1">
        <wpt lat="46" lon="8"><name>Good</name></wpt>
        <wpt lon="8"><name>No Latitude</name></wpt>
      </gpx>`,
    );

    const report = commitFile(db, await parseFile(path), {
      destinationTripId: trip.id,
    });

    expect(report.status).toBe('partial');
    expect(report.imported.waypoints).toBe(1);
    expect(report.skipped[0]?.reason).toMatch(/coordinates/i);
  });

  it('leaves no partial trip when the write fails', async () => {
    const parsed = await parseFile(fixture('alps-full.gpx'));

    // A destination that does not exist fails inside the transaction, after
    // the history row is written. Nothing geometric must survive.
    const report = commitFile(db, parsed, {
      destinationTripId: '0190c3ae-1f2b-7c4d-9e8f-1a2b3c4d5e6f',
    });

    expect(report.status).toBe('failed');
    expect(report.imported.points).toBe(0);
    expect(
      tripService.list(db, {
        includeArchived: true,
        sortKey: 'name',
        sortDirection: 'asc',
      }),
    ).toHaveLength(0);
  });

  it('reports progress at least once, with a total that matches', async () => {
    const trip = newTrip();
    const parsed = await parseFile(fixture('alps-full.gpx'));
    const seen: ImportProgress[] = [];

    const report = commitFile(
      db,
      parsed,
      { destinationTripId: trip.id },
      { onProgress: (p) => seen.push(p) },
    );

    expect(seen.length).toBeGreaterThan(0);
    const last = seen.at(-1);
    expect(last?.pointsTotal).toBe(report.imported.points);
    expect(last?.pointsWritten).toBe(report.imported.points);
  });
});

// ----------------------------------------------------------------- history

describe('import history', () => {
  it('records a successful import', async () => {
    const trip = newTrip();
    commitFile(db, await parseFile(fixture('alps-full.gpx')), {
      destinationTripId: trip.id,
    });

    const history = listHistory(db);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      sourceName: 'alps-full.gpx',
      sourceFormat: 'gpx',
    });
    expect(history[0]?.finishedAt).not.toBeNull();
    expect(history[0]?.report.imported.waypoints).toBeGreaterThan(0);
  });

  it('records a failed import, which is the case worth investigating', async () => {
    commitFile(db, await parseFile(fixture('alps-full.gpx')), {
      destinationTripId: '0190c3ae-1f2b-7c4d-9e8f-1a2b3c4d5e6f',
    });

    const history = listHistory(db);
    expect(history).toHaveLength(1);
    expect(history[0]?.status).toBe('failed');
    expect(history[0]?.report.error).toBeTruthy();
  });

  it('survives an unreadable report rather than hiding the entry', () => {
    const id = historyRepo.begin(db, {
      sourceName: 'odd.gpx',
      sourceFormat: 'gpx',
      startedAt: Date.now(),
    });

    const entry = historyRepo.find(db, id);
    expect(entry?.sourceName).toBe('odd.gpx');
    expect(entry?.status).toBe('failed');
    expect(entry?.finishedAt).toBeNull();
    expect(entry?.report.warnings.join(' ')).toMatch(/did not finish/);
  });

  it('falls back to a usable report when the stored JSON is corrupt', () => {
    const id = historyRepo.begin(db, {
      sourceName: 'corrupt.gpx',
      sourceFormat: 'gpx',
      startedAt: Date.now(),
    });
    // Simulates a row written by a future version, or a truncated write.
    handle.sqlite
      .prepare('update import_history set report = ? where id = ?')
      .run('{not json', id);

    const entry = historyRepo.find(db, id);
    expect(entry?.sourceName).toBe('corrupt.gpx');
    expect(entry?.report.warnings.join(' ')).toMatch(/could not be read/);
  });

  it('orders newest first', async () => {
    const trip = newTrip();
    commitFile(db, await parseFile(fixture('empty.gpx')), {
      destinationTripId: trip.id,
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    commitFile(db, await parseFile(fixture('no-time.gpx')), {
      destinationTripId: trip.id,
    });

    expect(listHistory(db).map((h) => h.sourceName)).toEqual([
      'no-time.gpx',
      'empty.gpx',
    ]);
  });
});

// -------------------------------------------------------------- multi-file

describe('importFiles', () => {
  it('imports several files, one transaction each', async () => {
    const result = await importFiles(db, [
      { sourcePath: fixture('alps-full.gpx'), destinationTripId: null },
      { sourcePath: fixture('places.kml'), destinationTripId: null },
    ]);

    expect(result.allSucceeded).toBe(true);
    expect(result.reports).toHaveLength(2);

    const names = tripService
      .list(db, {
        includeArchived: true,
        sortKey: 'name',
        sortDirection: 'asc',
      })
      .map((t) => t.name);
    expect(names).toEqual(['alps-full', 'places']);
  });

  it('a bad file does not cost the good ones', async () => {
    const result = await importFiles(db, [
      { sourcePath: fixture('alps-full.gpx'), destinationTripId: null },
      { sourcePath: fixture('malformed.gpx'), destinationTripId: null },
      { sourcePath: fixture('places.kml'), destinationTripId: null },
    ]);

    expect(result.allSucceeded).toBe(false);
    expect(result.reports.map((r) => r.status)).toEqual([
      'success',
      'failed',
      'success',
    ]);

    const names = tripService
      .list(db, {
        includeArchived: true,
        sortKey: 'name',
        sortDirection: 'asc',
      })
      .map((t) => t.name);
    // The malformed file left nothing behind, not even an empty trip.
    expect(names).toEqual(['alps-full', 'places']);
  });

  it('records every file in the history, including the refused one', async () => {
    await importFiles(db, [
      { sourcePath: fixture('alps-full.gpx'), destinationTripId: null },
      { sourcePath: fixture('malformed.gpx'), destinationTripId: null },
    ]);

    const history = listHistory(db);
    expect(history).toHaveLength(2);
    expect(history.map((h) => h.sourceName).toSorted()).toEqual([
      'alps-full.gpx',
      'malformed.gpx',
    ]);
  });

  it('retains the original file bytes by default', async () => {
    await importFiles(db, [
      { sourcePath: fixture('multi-segment.gpx'), destinationTripId: null },
    ]);

    const track = trackService.listAll(db)[0];
    expect(track).toBeDefined();
    const original = trackService.originalBytes(db, track?.id ?? '');
    expect(original?.format).toBe('gpx');
    expect(new TextDecoder().decode(original?.bytes)).toContain('<trkseg>');
  });

  it('can be asked not to retain the original', async () => {
    await importFiles(db, [
      {
        sourcePath: fixture('multi-segment.gpx'),
        destinationTripId: null,
        retainOriginal: false,
      },
    ]);

    const track = trackService.listAll(db)[0];
    expect(trackService.originalBytes(db, track?.id ?? '')).toBeNull();
  });

  it('imports a native collection as whole trips', async () => {
    const source = newTrip('Original');
    routeService.create(db, {
      tripId: source.id,
      name: 'A Route',
      colour: null,
      points: [
        { lat: 46, lon: 8, ele: null, name: null, symbol: null, notes: null },
        { lat: 46.01, lon: 8.01, ele: null, name: null, symbol: null, notes: null },
      ],
    });

    const path = write(
      'collection.json',
      writeCollection(buildCollection(db, { tripIds: [source.id] })),
    );

    const result = await importFiles(db, [
      { sourcePath: path, destinationTripId: null },
    ]);

    expect(result.allSucceeded).toBe(true);
    expect(result.reports[0]?.format).toBe('json');
    expect(result.reports[0]?.imported.routes).toBe(1);

    const names = tripService
      .list(db, {
        includeArchived: true,
        sortKey: 'name',
        sortDirection: 'asc',
      })
      .map((t) => t.name);
    // A second copy, not an overwrite of the original.
    expect(names).toEqual(['Original', 'Original']);
  });

  it('refuses a collection from a newer format version', async () => {
    const path = write(
      'future.json',
      '{"format":"trailrt-collection","version":99,"exportedAt":0,"trips":[]}',
    );

    const result = await importFiles(db, [
      { sourcePath: path, destinationTripId: null },
    ]);

    expect(result.reports[0]?.status).toBe('failed');
    expect(result.reports[0]?.error).toMatch(/newer version/);
  });

  it('reports per-file progress with the right file index', async () => {
    const seen: ImportProgress[] = [];
    await importFiles(
      db,
      [
        { sourcePath: fixture('alps-full.gpx'), destinationTripId: null },
        { sourcePath: fixture('multi-segment.gpx'), destinationTripId: null },
      ],
      (p) => seen.push(p),
    );

    expect(seen.some((p) => p.fileIndex === 0)).toBe(true);
    expect(seen.some((p) => p.fileIndex === 1)).toBe(true);
    expect(seen.every((p) => p.fileCount === 2)).toBe(true);
  });
});

// ------------------------------------------------------------- large files

describe('large import', () => {
  const LARGE = join(FIXTURES, 'generated', 'large-track.gpx');

  it('imports a 200,000-point track and reports progress along the way', async () => {
    const seen: ImportProgress[] = [];
    const parsed = await parseFile(LARGE);
    const trip = newTrip('Big');

    const report = commitFile(
      db,
      parsed,
      { destinationTripId: trip.id },
      { onProgress: (p) => seen.push(p) },
    );

    expect(report.status).not.toBe('failed');
    expect(report.imported.points).toBe(200_000);

    const track = trackService.listForTrip(db, trip.id)[0];
    expect(track?.pointCount).toBe(200_000);

    // Progress is reported per batch, not per point.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.length).toBeLessThan(100);
  }, 120_000);
});
