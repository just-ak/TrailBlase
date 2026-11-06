import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { unpackPolyline } from '@shared/geo/packed';
import type { ParsedTrack, ParsedTrackPoint } from '@shared/io/types';
import { createDatabase, type Db, type DbHandle } from '../db/client';
import * as repo from '../db/repositories/tracks';
import { ServiceError } from './errors';
import * as trackService from './trackService';
import * as tripService from './tripService';

let dir: string;
let handle: DbHandle;
let db: Db;
let tripId: string;

const pt = (
  lat: number,
  lon: number,
  ele: number | null = null,
  time: number | null = null,
): ParsedTrackPoint => ({ lat, lon, ele, time });

const parsed = (
  segments: ParsedTrackPoint[][],
  name = 'Track',
): ParsedTrack => ({
  name,
  segments: segments.map((points) => ({ points })),
  metadata: {},
});

/** A straight-ish line of `n` points, spaced far enough apart to survive
 *  simplification at the cache tolerance. */
function line(n: number): ParsedTrackPoint[] {
  const points: ParsedTrackPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    // Zig-zag in latitude so Douglas-Peucker cannot collapse the whole run to
    // two points; that would make the cache assertions vacuous.
    points.push(pt(50 + i * 0.001 + (i % 2) * 0.0005, 6 + i * 0.001, 100 + i));
  }
  return points;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailrt-trk-'));
  handle = createDatabase({ file: join(dir, 'test.db') });
  db = handle.db;
  tripId = tripService.create(db, {
    name: 'Trip',
    folderId: null,
    description: null,
    notes: null,
  }).result.id;
});

afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

const create = (track: ParsedTrack, original?: Uint8Array) =>
  trackService.createFromParsed(db, {
    tripId,
    parsed: track,
    source: original === undefined ? 'user' : 'import',
    ...(original === undefined
      ? {}
      : { originalBytes: original, originalFormat: 'gpx' }),
  }).result;

// ------------------------------------------------------------------ creation

describe('createFromParsed', () => {
  it('stores points in order across segments', () => {
    const track = create(
      parsed([
        [pt(50, 6), pt(50.001, 6.001)],
        [pt(51, 7), pt(51.001, 7.001), pt(51.002, 7.002)],
      ]),
    );

    expect(track.pointCount).toBe(5);
    expect(track.segmentCount).toBe(2);
    expect(track.segments[0]?.points).toHaveLength(2);
    expect(track.segments[1]?.points).toHaveLength(3);
    expect(track.segments[1]?.points[2]?.lon).toBeCloseTo(7.002, 10);
  });

  it('assigns dense (segment_index, seq) keys', () => {
    const track = create(parsed([[pt(50, 6), pt(50.001, 6)], [pt(51, 7)]]));
    const rows = repo.listTrackPoints(db, track.id);
    expect(rows.map((r) => [r.segmentIndex, r.seq])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
    ]);
  });

  it('keeps absent elevation and time as null, never 0', () => {
    const track = create(parsed([[pt(50, 6), pt(50.001, 6.001)]]));
    expect(track.segments[0]?.points[0]?.ele).toBeNull();
    expect(track.segments[0]?.points[0]?.time).toBeNull();
    expect(track.elevGainM).toBeNull();
    expect(track.elevLossM).toBeNull();
    expect(track.durationS).toBeNull();
    expect(track.startedAt).toBeNull();
  });

  it('computes distance per segment without bridging the break', () => {
    const together = create(
      parsed([[pt(50, 6), pt(50.01, 6)], [pt(52, 6), pt(52.01, 6)]]),
    );
    const single = create(parsed([[pt(50, 6), pt(50.01, 6)]]));

    // Two ~1.1 km legs and no 220 km jump between them.
    expect(together.distanceM).toBeCloseTo((single.distanceM ?? 0) * 2, 3);
  });

  it('derives duration from timestamps when present', () => {
    const t0 = Date.UTC(2024, 4, 1, 9, 0, 0);
    const track = create(
      parsed([[pt(50, 6, 100, t0), pt(50.001, 6.001, 110, t0 + 60_000)]]),
    );
    expect(track.startedAt).toBe(t0);
    expect(track.endedAt).toBe(t0 + 60_000);
    expect(track.durationS).toBe(60);
    expect(track.elevGainM).toBeCloseTo(10, 6);
    expect(track.elevLossM).toBeCloseTo(0, 6);
  });

  it('rejects a trip that does not exist', () => {
    expect(() =>
      trackService.createFromParsed(db, {
        tripId: '0190c3ae-1f2b-7c4d-9e8f-1a2b3c4d5e6f',
        parsed: parsed([[pt(50, 6)]]),
        source: 'user',
      }),
    ).toThrow(ServiceError);
  });

  it('reports a delete inverse', () => {
    const mutation = trackService.createFromParsed(db, {
      tripId,
      parsed: parsed([[pt(50, 6)]]),
      source: 'user',
    });
    expect(mutation.inverse).toEqual({
      kind: 'track:delete',
      payload: { id: mutation.result.id },
    });
  });
});

// ------------------------------------------------------------ original bytes

describe('retained source bytes', () => {
  it('returns the imported file verbatim', () => {
    const bytes = new TextEncoder().encode('<gpx>original</gpx>');
    const track = create(parsed([[pt(50, 6), pt(50.001, 6)]]), bytes);

    expect(track.hasOriginal).toBe(true);
    const original = trackService.originalBytes(db, track.id);
    expect(original?.format).toBe('gpx');
    expect(original?.bytes).toEqual(bytes);
  });

  it('survives a destructive edit, which is the recovery path', () => {
    const bytes = new TextEncoder().encode('<gpx>original</gpx>');
    const track = create(parsed([[...line(40)]]), bytes);

    trackService.simplifyTrack(db, track.id, 500);
    expect(trackService.get(db, track.id).pointCount).toBeLessThan(40);

    expect(trackService.originalBytes(db, track.id)?.bytes).toEqual(bytes);
  });

  it('is absent for a track with no source file', () => {
    const track = create(parsed([[pt(50, 6)]]));
    expect(track.hasOriginal).toBe(false);
    expect(trackService.originalBytes(db, track.id)).toBeNull();
  });

  it('hashes the content so a duplicate import is detectable', () => {
    const bytes = new TextEncoder().encode('<gpx>original</gpx>');
    const a = create(parsed([[pt(50, 6)]], 'A'), bytes);
    const b = create(parsed([[pt(50, 6)]], 'B'), bytes);

    const hashA = repo.findTrackSource(db, a.id)?.contentHash;
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);
    expect(repo.findTrackSource(db, b.id)?.contentHash).toBe(hashA);
  });
});

// -------------------------------------------------------------- render cache

describe('render cache', () => {
  it('is built on creation and decodes to a simplified polyline', () => {
    const track = create(parsed([[...line(200)]]));

    const packed = repo.readRenderGeometry(db, track.id);
    expect(packed).not.toBeNull();

    const points = unpackPolyline(packed as Uint8Array);
    expect(points.length).toBeGreaterThan(1);
    expect(points.length).toBeLessThan(200);
  });

  it('rebuilds from the points, which are the source of truth', () => {
    const track = create(parsed([[...line(200)]]));
    const before = repo.readRenderGeometry(db, track.id);

    repo.writeRenderGeometry(db, track.id, null, null);
    expect(repo.readRenderGeometry(db, track.id)).toBeNull();

    trackService.rebuildRenderCache(db, track.id);
    expect(repo.readRenderGeometry(db, track.id)).toEqual(before);
  });

  it('is invalidated and recomputed on a geometry edit', () => {
    const track = create(parsed([[...line(200)]]));
    const before = repo.readRenderGeometry(db, track.id);

    trackService.reverse(db, track.id);
    const after = repo.readRenderGeometry(db, track.id);

    expect(after).not.toBeNull();
    expect(after).not.toEqual(before);
  });

  it('records the tolerance it was built at', () => {
    const track = create(parsed([[...line(200)]]));
    expect(repo.findTrack(db, track.id)?.renderToleranceM).toBeGreaterThan(0);
  });

  it('is null for geometry too short to simplify', () => {
    const track = create(parsed([[]], 'Empty'));
    expect(repo.readRenderGeometry(db, track.id)).toBeNull();
    expect(repo.findTrack(db, track.id)?.renderToleranceM).toBeNull();
  });
});

// ------------------------------------------------------------------- editing

describe('editing', () => {
  it('renames without touching geometry', () => {
    const track = create(parsed([[...line(10)]]));
    const mutation = trackService.update(db, { id: track.id, name: 'Renamed' });

    expect(mutation.result.name).toBe('Renamed');
    expect(mutation.result.pointCount).toBe(10);
    expect(mutation.inverse.kind).toBe('track:update');
  });

  it('recolours and resizes, and the inverse restores both', () => {
    const track = create(parsed([[...line(4)]]));
    const mutation = trackService.update(db, {
      id: track.id,
      colour: '#ff0000',
      width: 5,
    });
    expect(mutation.result.colour).toBe('#ff0000');
    expect(mutation.result.width).toBe(5);
    expect(mutation.inverse.payload).toMatchObject({
      colour: null,
      width: null,
    });
  });

  it('reverses point and segment order', () => {
    const track = create(parsed([[pt(50, 6), pt(50.001, 6)], [pt(51, 7)]]));
    const reversed = trackService.reverse(db, track.id).result;

    const flat = reversed.segments.flatMap((s) => s.points);
    expect(flat[0]?.lat).toBeCloseTo(51, 10);
    expect(flat[2]?.lat).toBeCloseTo(50, 10);
  });

  it('previews a simplification without applying it', () => {
    const track = create(parsed([[...line(100)]]));
    const preview = trackService.previewSimplify(db, track.id, 500);

    expect(preview.before).toBe(100);
    expect(preview.after).toBeLessThan(100);
    expect(trackService.get(db, track.id).pointCount).toBe(100);
  });

  it('rejects a non-positive simplification tolerance', () => {
    const track = create(parsed([[...line(10)]]));
    expect(() => trackService.simplifyTrack(db, track.id, 0)).toThrow(
      ServiceError,
    );
  });

  it('recomputes statistics after a geometry change', () => {
    const track = create(parsed([[...line(60)]]));
    const simplified = trackService.simplifyTrack(db, track.id, 500).result;

    expect(simplified.pointCount).toBeLessThan(60);
    // The cached column agrees with the recomputed value; a stale count here
    // is exactly the bug the recompute exists to prevent.
    expect(repo.findTrack(db, track.id)?.pointCount).toBe(
      simplified.pointCount,
    );
  });

  it('splits into two tracks and leaves both complete', () => {
    const track = create(parsed([[...line(10)]], 'Walk'));
    const { result } = trackService.split(db, track.id, 4);

    expect(result.first.pointCount).toBe(4);
    expect(result.second.pointCount).toBe(6);
    expect(result.first.name).toBe('Walk (1)');
    expect(result.second.name).toBe('Walk (2)');
  });

  it('refuses a split that would leave an empty side', () => {
    const track = create(parsed([[...line(5)]]));
    expect(() => trackService.split(db, track.id, 0)).toThrow(ServiceError);
    expect(() => trackService.split(db, track.id, 4)).toThrow(ServiceError);
  });

  it('joins two tracks, preserving the segment break', () => {
    const a = create(parsed([[...line(5)]], 'A'));
    const b = create(parsed([[...line(4)]], 'B'));

    const joined = trackService.join(db, {
      firstId: a.id,
      secondId: b.id,
      name: 'A+B',
    }).result;

    expect(joined.name).toBe('A+B');
    expect(joined.pointCount).toBe(9);
    expect(joined.segmentCount).toBe(2);
    expect(repo.findTrack(db, b.id)).toBeNull();
  });

  it('refuses to join tracks in different trips', () => {
    const other = tripService.create(db, {
      name: 'Other',
      folderId: null,
      description: null,
      notes: null,
    }).result.id;

    const a = create(parsed([[...line(3)]], 'A'));
    const b = trackService.createFromParsed(db, {
      tripId: other,
      parsed: parsed([[...line(3)]], 'B'),
      source: 'user',
    }).result;

    expect(() =>
      trackService.join(db, { firstId: a.id, secondId: b.id }),
    ).toThrow(ServiceError);
  });

  it('deletes a point range and the inverse restores it exactly', () => {
    const track = create(parsed([[...line(10)]]));
    const original = trackService.get(db, track.id).segments[0]?.points ?? [];

    const removal = trackService.deletePointRange(db, track.id, 3, 5);
    expect(removal.result.pointCount).toBe(7);
    expect(removal.inverse.kind).toBe('track:restorePoints');

    trackService.restorePoints(
      db,
      removal.inverse.payload as Parameters<
        typeof trackService.restorePoints
      >[1],
    );

    const after = trackService.get(db, track.id).segments[0]?.points ?? [];
    expect(after).toHaveLength(10);
    expect(after.map((p) => p.lat)).toEqual(original.map((p) => p.lat));
    expect(after.map((p) => p.ele)).toEqual(original.map((p) => p.ele));
  });

  it('refuses to delete every point', () => {
    const track = create(parsed([[...line(3)]]));
    expect(() => trackService.deletePointRange(db, track.id, 0, 2)).toThrow(
      ServiceError,
    );
  });

  it('moves a track to another trip and reports the inverse', () => {
    const other = tripService.create(db, {
      name: 'Other',
      folderId: null,
      description: null,
      notes: null,
    }).result.id;

    const track = create(parsed([[...line(3)]]));
    const mutation = trackService.moveToTrip(db, {
      id: track.id,
      tripId: other,
    });

    expect(mutation.result.tripId).toBe(other);
    expect(mutation.inverse).toEqual({
      kind: 'track:move',
      payload: { id: track.id, tripId },
    });
  });

  it('deletes a track and its points', () => {
    const track = create(parsed([[...line(5)]]));
    trackService.remove(db, track.id);

    expect(repo.findTrack(db, track.id)).toBeNull();
    expect(repo.listTrackPoints(db, track.id)).toHaveLength(0);
  });

  it('reports no inverse for a delete, rather than pretending', () => {
    const track = create(parsed([[...line(5)]]));
    expect(trackService.remove(db, track.id).inverse.kind).toBe('none');
  });
});

// ------------------------------------------------------------------ listings

describe('listings', () => {
  it('serves list statistics from the cached columns', () => {
    create(parsed([[...line(20)]], 'B'));
    create(parsed([[...line(10)]], 'A'));

    const list = trackService.listForTrip(db, tripId);
    expect(list.map((t) => t.name)).toEqual(['A', 'B']);
    expect(list[0]?.pointCount).toBe(10);
    expect(list[1]?.pointCount).toBe(20);
  });

  it('includes the trip name when listing across trips', () => {
    create(parsed([[...line(3)]], 'One'));
    const all = trackService.listAll(db);
    expect(all[0]?.tripName).toBe('Trip');
  });

  it('rejects a listing for a trip that does not exist', () => {
    expect(() =>
      trackService.listForTrip(db, '0190c3ae-1f2b-7c4d-9e8f-1a2b3c4d5e6f'),
    ).toThrow(ServiceError);
  });
});

// --------------------------------------------------------------- performance

describe('bulk insert', () => {
  // The budget is the point of the test: per-row autocommit is ~100x slower,
  // and a regression to it would make importing a real recording unusable.
  it('writes 200,000 points within the time budget', () => {
    const points: ParsedTrackPoint[] = [];
    for (let i = 0; i < 200_000; i += 1) {
      points.push(pt(50 + i * 1e-6, 6 + i * 1e-6, 100 + (i % 50), 1_700_000_000_000 + i * 1000));
    }

    const started = performance.now();
    const track = create(parsed([points], 'Big'));
    const elapsedMs = performance.now() - started;

    expect(track.pointCount).toBe(200_000);
    expect(elapsedMs).toBeLessThan(30_000);
  }, 60_000);
});
