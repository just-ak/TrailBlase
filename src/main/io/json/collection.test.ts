import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  COLLECTION_FORMAT,
  COLLECTION_VERSION,
  countCollection,
} from '@shared/io/collection';
import { ParseError } from '@shared/io/types';
import { createDatabase, type Db, type DbHandle } from '../../db/client';
import * as folderService from '../../services/folderService';
import * as routeService from '../../services/routeService';
import * as trackService from '../../services/trackService';
import * as tripService from '../../services/tripService';
import * as waypointService from '../../services/waypointService';
import { detectFormat } from '../detect';
import { applyCollection, parseCollection } from './read';
import { buildCollection, writeCollection } from './write';

let dir: string;
let handle: DbHandle;
let db: Db;

/** A second, empty database, so an import can be tested as a fresh install. */
let targetDir: string;
let targetHandle: DbHandle;
let target: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailrt-json-src-'));
  handle = createDatabase({ file: join(dir, 'source.db') });
  db = handle.db;

  targetDir = mkdtempSync(join(tmpdir(), 'trailrt-json-dst-'));
  targetHandle = createDatabase({ file: join(targetDir, 'target.db') });
  target = targetHandle.db;
});

afterEach(() => {
  handle.close();
  targetHandle.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(targetDir, { recursive: true, force: true });
});

const p = (lat: number, lon: number, ele: number | null = null) => ({
  lat,
  lon,
  ele,
  name: null,
  symbol: null,
  notes: null,
});

/**
 * A collection exercising every entity and the awkward cases: a nested folder,
 * an archived trip, a multi-segment track, absent elevation, and a grouped
 * waypoint.
 */
function seed(): { tripId: string; archivedId: string; folderId: string } {
  const europe = folderService.create(db, {
    name: 'Europe',
    parentId: null,
  }).result;
  const alps = folderService.create(db, {
    name: 'Alps',
    parentId: europe.id,
  }).result;

  const trip = tripService.create(db, {
    name: 'Grimsel',
    folderId: alps.id,
    description: 'A hut tour',
    notes: 'Bring crampons',
  }).result;

  routeService.create(db, {
    tripId: trip.id,
    name: 'Approach',
    colour: '#2563eb',
    points: [p(46.5197, 8.012, 1850.5), p(46.5231, 8.0168, 1902.25)],
  });

  routeService.create(db, {
    tripId: trip.id,
    name: 'No Elevation',
    colour: null,
    points: [p(46.5197, 8.012), p(46.5231, 8.0168)],
  });

  trackService.createFromParsed(db, {
    tripId: trip.id,
    source: 'import',
    parsed: {
      name: 'Recorded Walk',
      segments: [
        {
          points: [
            { lat: 46.5197, lon: 8.012, ele: 1850.5, time: 1_700_000_000_000 },
            { lat: 46.5231, lon: 8.0168, ele: 1902.25, time: 1_700_000_060_000 },
          ],
        },
        {
          points: [
            { lat: 46.6, lon: 8.1, ele: null, time: null },
            { lat: 46.61, lon: 8.11, ele: null, time: null },
          ],
        },
      ],
      metadata: { sport: 'Hiking' },
    },
  });

  const group = waypointService.createGroup(db, {
    tripId: trip.id,
    name: 'Huts',
  }).result;

  waypointService.create(db, {
    tripId: trip.id,
    groupId: group.id,
    name: 'Grimsel Hut',
    lat: 46.5197,
    lon: 8.012,
    eleM: 1850.5,
    description: 'Overnight stop',
    symbol: 'lodging',
    notes: null,
  });

  waypointService.create(db, {
    tripId: trip.id,
    groupId: null,
    name: 'Unknown Height',
    lat: 45.9763,
    lon: 7.6586,
    eleM: null,
    description: null,
    // The service requires a symbol id and substitutes the default for an
    // empty string; null is not part of its contract.
    symbol: '',
    notes: null,
  });

  const archived = tripService.create(db, {
    name: 'Old Trip',
    folderId: null,
    description: null,
    notes: null,
  }).result;
  tripService.setStatus(db, { id: archived.id, status: 'archived' });

  return { tripId: trip.id, archivedId: archived.id, folderId: alps.id };
}

// --------------------------------------------------------------- envelope

describe('collection envelope', () => {
  it('writes the format and version first', () => {
    const output = writeCollection(buildCollection(db));
    const envelope = JSON.parse(output) as Record<string, unknown>;

    expect(Object.keys(envelope).slice(0, 2)).toEqual(['format', 'version']);
    expect(envelope.format).toBe(COLLECTION_FORMAT);
    expect(envelope.version).toBe(COLLECTION_VERSION);
  });

  it('is recognised by the format detector', () => {
    const output = writeCollection(buildCollection(db));
    expect(
      detectFormat('collection.json', new TextEncoder().encode(output)),
    ).toEqual({ kind: 'supported', format: 'json', byExtension: true });
  });

  it('refuses a newer format version with an explanation', () => {
    const output = writeCollection(buildCollection(db));
    const bumped = output.replace(
      `"version": ${COLLECTION_VERSION}`,
      `"version": ${COLLECTION_VERSION + 1}`,
    );

    expect(() => parseCollection(bumped)).toThrow(
      /newer version of TrailRT/,
    );
  });

  it('refuses JSON that is not a collection', () => {
    expect(() => parseCollection('{"some":"other json"}')).toThrow(
      /not a TrailRT collection export/,
    );
  });

  it('refuses invalid JSON, naming the problem', () => {
    try {
      parseCollection('{not json');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ParseError);
      expect((error as ParseError).detail).toBeTruthy();
    }
  });

  it('refuses a collection whose shape is wrong, naming the field', () => {
    const broken = JSON.stringify({
      format: COLLECTION_FORMAT,
      version: 1,
      exportedAt: 0,
      trips: [{ id: 't1', name: 'X' }],
    });

    try {
      parseCollection(broken);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).toMatch(/not in a shape TrailRT can read/);
      expect((error as ParseError).detail).toMatch(/trips\.0/);
    }
  });

  it('rejects an out-of-range coordinate rather than storing it', () => {
    const broken = JSON.stringify({
      format: COLLECTION_FORMAT,
      version: 1,
      exportedAt: 0,
      trips: [
        {
          id: 't1',
          folderId: null,
          name: 'X',
          description: null,
          notes: null,
          status: 'active',
          createdAt: 0,
          updatedAt: 0,
          waypoints: [
            {
              id: 'w1',
              groupId: null,
              name: 'Bad',
              lat: 146,
              lon: 8,
              eleM: null,
              description: null,
              symbol: null,
              notes: null,
              source: 'user',
              createdAt: 0,
              updatedAt: 0,
            },
          ],
        },
      ],
    });

    expect(() => parseCollection(broken)).toThrow(/not in a shape/);
  });
});

// ---------------------------------------------------------------- export

describe('buildCollection', () => {
  it('is empty for an empty database', () => {
    const collection = buildCollection(db);
    expect(collection.trips).toEqual([]);
    expect(collection.folders).toEqual([]);
  });

  it('includes every entity', () => {
    seed();
    const counts = countCollection(buildCollection(db));

    expect(counts).toMatchObject({
      folders: 2,
      trips: 2,
      routes: 2,
      tracks: 1,
      waypoints: 2,
    });
    // Two routes of two points, four track points, two waypoints.
    expect(counts.points).toBe(4 + 4 + 2);
  });

  it('omits derived caches, which are recomputed on import', () => {
    seed();
    const route = buildCollection(db).trips[0]?.routes[0] as unknown as Record<
      string,
      unknown
    >;

    expect(route.points).toBeDefined();
    expect(route.distanceM).toBeUndefined();
    expect(route.pointCount).toBeUndefined();
  });

  it('includes archived trips, because this is a data export', () => {
    seed();
    const statuses = buildCollection(db).trips.map((t) => t.status);
    expect(statuses).toContain('archived');
  });

  it('exports only the requested trips', () => {
    const { tripId } = seed();
    const collection = buildCollection(db, { tripIds: [tripId] });

    expect(collection.trips).toHaveLength(1);
    expect(collection.trips[0]?.name).toBe('Grimsel');
  });

  it('includes a selected trip\u2019s folder ancestors and nothing else', () => {
    const { tripId } = seed();
    folderService.create(db, { name: 'Unrelated', parentId: null });

    const names = buildCollection(db, { tripIds: [tripId] }).folders.map(
      (f) => f.name,
    );
    expect(names).toEqual(['Europe', 'Alps']);
  });

  it('emits folders parent-before-child', () => {
    seed();
    const folders = buildCollection(db).folders;
    const europeIndex = folders.findIndex((f) => f.name === 'Europe');
    const alpsIndex = folders.findIndex((f) => f.name === 'Alps');
    expect(europeIndex).toBeLessThan(alpsIndex);
  });

  it('emits metadata as an object, not a JSON string', () => {
    seed();
    const track = buildCollection(db).trips[0]?.tracks[0];
    expect(track?.metadata).toEqual({ sport: 'Hiking' });
  });
});

// ------------------------------------------------------------- round trip

describe('collection round trip', () => {
  it('reproduces the whole collection in a fresh database', () => {
    seed();
    const output = writeCollection(buildCollection(db));

    const result = applyCollection(target, parseCollection(output));
    const reread = buildCollection(target);

    expect(result.warnings).toEqual([]);
    expect(countCollection(reread)).toEqual(
      countCollection(buildCollection(db)),
    );
  });

  it('preserves coordinates, elevation and times exactly', () => {
    seed();
    const original = buildCollection(db);
    applyCollection(target, parseCollection(writeCollection(original)));
    const reread = buildCollection(target);

    const strip = (c: typeof original) =>
      c.trips.map((trip) => ({
        name: trip.name,
        routes: trip.routes.map((r) => ({ name: r.name, points: r.points })),
        tracks: trip.tracks.map((t) => ({
          name: t.name,
          segments: t.segments,
        })),
        waypoints: trip.waypoints.map((w) => [
          w.name,
          w.lat,
          w.lon,
          w.eleM,
          w.description,
          w.symbol,
        ]),
      }));

    expect(strip(reread)).toEqual(strip(original));
  });

  it('keeps an absent elevation null rather than importing 0', () => {
    seed();
    applyCollection(target, parseCollection(writeCollection(buildCollection(db))));

    const waypoint = buildCollection(target)
      .trips.flatMap((t) => t.waypoints)
      .find((w) => w.name === 'Unknown Height');
    expect(waypoint?.eleM).toBeNull();

    const route = buildCollection(target)
      .trips.flatMap((t) => t.routes)
      .find((r) => r.name === 'No Elevation');
    expect(route?.points.every((point) => point.ele === null)).toBe(true);
  });

  it('preserves the segment break in a multi-segment track', () => {
    seed();
    applyCollection(target, parseCollection(writeCollection(buildCollection(db))));

    const track = buildCollection(target).trips.flatMap((t) => t.tracks)[0];
    expect(track?.segments).toHaveLength(2);
    expect(track?.segments[1]?.points[0]?.time).toBeNull();
  });

  it('rebuilds the derived statistics rather than trusting the file', () => {
    seed();
    applyCollection(target, parseCollection(writeCollection(buildCollection(db))));

    const tripId = Object.values(
      applyCollection(
        targetHandle.db,
        parseCollection(writeCollection(buildCollection(db))),
        { nameSuffix: ' (2)' },
      ).tripIds,
    )[0] as string;

    const tracks = trackService.listForTrip(target, tripId);
    const track = tracks[0];
    expect(track?.pointCount).toBe(4);
    expect(track?.distanceM).toBeGreaterThan(0);
  });

  it('preserves the folder hierarchy and trip placement', () => {
    seed();
    applyCollection(target, parseCollection(writeCollection(buildCollection(db))));

    const folders = folderService.list(target);
    const europe = folders.find((f) => f.name === 'Europe');
    const alps = folders.find((f) => f.name === 'Alps');

    expect(europe?.parentId).toBeNull();
    expect(alps?.parentId).toBe(europe?.id);

    const trip = buildCollection(target).trips.find(
      (t) => t.name === 'Grimsel',
    );
    expect(trip?.folderId).toBe(alps?.id);
  });

  it('preserves archived status and waypoint grouping', () => {
    seed();
    applyCollection(target, parseCollection(writeCollection(buildCollection(db))));

    const collection = buildCollection(target);
    expect(collection.trips.map((t) => t.status)).toContain('archived');

    const trip = collection.trips.find((t) => t.name === 'Grimsel');
    const group = trip?.waypointGroups[0];
    const grouped = trip?.waypoints.find((w) => w.name === 'Grimsel Hut');

    expect(group?.name).toBe('Huts');
    expect(grouped?.groupId).toBe(group?.id);
  });

  it('preserves metadata through the round trip', () => {
    seed();
    applyCollection(target, parseCollection(writeCollection(buildCollection(db))));

    const track = buildCollection(target).trips.flatMap((t) => t.tracks)[0];
    expect(track?.metadata).toEqual({ sport: 'Hiking' });
  });
});

// ------------------------------------------------------------------ merge

describe('applyCollection as a merge', () => {
  it('assigns fresh ids rather than reusing the file\u2019s', () => {
    const { tripId } = seed();
    const collection = buildCollection(db, { tripIds: [tripId] });

    const result = applyCollection(target, collection);
    expect(result.tripIds[tripId]).toBeDefined();
    expect(result.tripIds[tripId]).not.toBe(tripId);
  });

  it('importing twice gives two copies, not a silent overwrite', () => {
    const { tripId } = seed();
    const collection = buildCollection(db, { tripIds: [tripId] });

    applyCollection(target, collection);
    applyCollection(target, collection, { nameSuffix: ' (imported)' });

    const names = buildCollection(target).trips.map((t) => t.name);
    expect(names).toEqual(['Grimsel', 'Grimsel (imported)']);
  });

  it('cannot clobber an existing trip that shares an id', () => {
    const { tripId } = seed();
    const collection = buildCollection(db, { tripIds: [tripId] });

    // The same database as the source: the ids in the file already exist here.
    applyCollection(db, collection, { nameSuffix: ' (copy)' });

    const trips = buildCollection(db).trips.filter((t) =>
      t.name.startsWith('Grimsel'),
    );
    expect(trips.map((t) => t.name)).toEqual(['Grimsel', 'Grimsel (copy)']);
    // The original still has its own geometry, untouched.
    expect(trips[0]?.routes).toHaveLength(2);
  });

  it('rolls the whole import back when any part fails', () => {
    const collection = buildCollection(db, { tripIds: [] });
    // A track with a coordinate the database rejects. Schema validation would
    // normally catch this; constructing it directly proves the transaction
    // boundary rather than the validator.
    collection.trips.push({
      id: 'bad-trip',
      folderId: 'missing-folder',
      name: 'Doomed',
      description: null,
      notes: null,
      status: 'active',
      createdAt: 0,
      updatedAt: 0,
      metadata: {},
      waypointGroups: [],
      routes: [],
      tracks: [],
      waypoints: [
        {
          id: 'w1',
          groupId: null,
          name: 'Fine',
          lat: 46,
          lon: 8,
          eleM: null,
          description: null,
          symbol: null,
          notes: null,
          source: 'user',
          createdAt: 0,
          updatedAt: 0,
          metadata: {},
        },
      ],
    });
    collection.trips.push({
      id: 'bad-trip-2',
      folderId: null,
      // A non-string name violates the NOT NULL text column once it reaches
      // SQLite.
      name: undefined as unknown as string,
      description: null,
      notes: null,
      status: 'active',
      createdAt: 0,
      updatedAt: 0,
      metadata: {},
      waypointGroups: [],
      routes: [],
      tracks: [],
      waypoints: [],
    });

    expect(() => applyCollection(target, collection)).toThrow();
    // Nothing from the first, valid trip survived.
    expect(buildCollection(target).trips).toEqual([]);
  });

  it('warns and recovers when a folder reference is missing', () => {
    const collection = buildCollection(db, { tripIds: [] });
    collection.trips.push({
      id: 't1',
      folderId: 'not-in-this-file',
      name: 'Orphan',
      description: null,
      notes: null,
      status: 'active',
      createdAt: 0,
      updatedAt: 0,
      metadata: {},
      waypointGroups: [],
      routes: [],
      tracks: [],
      waypoints: [],
    });

    const result = applyCollection(target, collection);
    expect(result.warnings.join(' ')).toMatch(/placed at the top level/);
    expect(buildCollection(target).trips[0]?.folderId).toBeNull();
  });
});
