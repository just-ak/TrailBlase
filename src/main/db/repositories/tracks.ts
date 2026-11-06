import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import type { GeometrySource } from '@shared/domain/types';
import type { Db } from '../client';
import { encodeMetadata } from '../metadata';
import { trackPoints, tracks, trackSources, trips } from '../schema';

/**
 * Data access for tracks.
 *
 * Three layers, per ADR 0003: `track_points` is the source of truth,
 * `tracks.render_geometry` is a rebuildable cache, and `track_sources` holds
 * the original imported bytes so "the original is preserved" is literally true.
 *
 * The bulk insert below is the single thing that makes importing a
 * 200,000-point track feasible. Per-row autocommit is roughly two orders of
 * magnitude slower.
 */

export interface TrackRow {
  id: string;
  tripId: string;
  name: string;
  colour: string | null;
  width: number | null;
  source: GeometrySource;
  pointCount: number;
  distanceM: number | null;
  elevGainM: number | null;
  elevLossM: number | null;
  startedAt: number | null;
  endedAt: number | null;
  renderToleranceM: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface TrackPointRow {
  segmentIndex: number;
  seq: number;
  lat: number;
  lon: number;
  eleM: number | null;
  recordedAt: number | null;
}

function rowToTrack(row: typeof tracks.$inferSelect): TrackRow {
  return {
    id: row.id,
    tripId: row.tripId,
    name: row.name,
    colour: row.colour ?? null,
    width: row.width ?? null,
    source: row.source as GeometrySource,
    pointCount: row.pointCount,
    distanceM: row.distanceM ?? null,
    elevGainM: row.elevGainM ?? null,
    elevLossM: row.elevLossM ?? null,
    startedAt: row.startedAt ?? null,
    endedAt: row.endedAt ?? null,
    renderToleranceM: row.renderToleranceM ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listTracksForTrip(db: Db, tripId: string): TrackRow[] {
  return db
    .select()
    .from(tracks)
    .where(eq(tracks.tripId, tripId))
    .orderBy(asc(tracks.name))
    .all()
    .map(rowToTrack);
}

export function listAllTracks(
  db: Db,
): (TrackRow & { tripName: string })[] {
  return db
    .select({ track: tracks, tripName: trips.name })
    .from(tracks)
    .innerJoin(trips, eq(tracks.tripId, trips.id))
    .orderBy(asc(trips.name), asc(tracks.name))
    .all()
    .map((r) => ({ ...rowToTrack(r.track), tripName: r.tripName }));
}

export function findTrack(db: Db, id: string): TrackRow | null {
  const row = db.select().from(tracks).where(eq(tracks.id, id)).get();
  return row ? rowToTrack(row) : null;
}

export function insertTrack(
  db: Db,
  values: {
    id?: string;
    tripId: string;
    name: string;
    colour: string | null;
    width: number | null;
    source: GeometrySource;
    /** Imported fields with no column of their own. See db/metadata.ts. */
    metadata?: Record<string, unknown> | undefined;
    now: number;
  },
): string {
  const id = values.id ?? randomUUID();
  db.insert(tracks)
    .values({
      id,
      tripId: values.tripId,
      name: values.name,
      colour: values.colour,
      width: values.width,
      source: values.source,
      metadata: encodeMetadata(values.metadata),
      createdAt: values.now,
      updatedAt: values.now,
    })
    .run();
  return id;
}

/**
 * Replaces a track's points.
 *
 * Chunked because SQLite has a bound on variables per statement
 * (`SQLITE_MAX_VARIABLE_NUMBER`), and six columns times a few hundred thousand
 * rows comfortably exceeds it. 1,000 rows per statement keeps each one well
 * inside the limit while still amortising the overhead.
 *
 * Must run inside the caller's transaction.
 */
export function replaceTrackPoints(
  db: Db,
  trackId: string,
  segments: readonly { points: readonly TrackPointRow[] }[],
): number {
  db.delete(trackPoints).where(eq(trackPoints.trackId, trackId)).run();

  const CHUNK = 1000;
  let written = 0;
  let batch: (typeof trackPoints.$inferInsert)[] = [];

  const flush = (): void => {
    if (batch.length === 0) return;
    db.insert(trackPoints).values(batch).run();
    batch = [];
  };

  for (const [segmentIndex, segment] of segments.entries()) {
    for (const [seq, point] of segment.points.entries()) {
      batch.push({
        id: randomUUID(),
        trackId,
        segmentIndex,
        seq,
        lat: point.lat,
        lon: point.lon,
        eleM: point.eleM,
        recordedAt: point.recordedAt,
      });
      written += 1;
      if (batch.length >= CHUNK) flush();
    }
  }
  flush();

  return written;
}

/** Points in storage order. */
export function listTrackPoints(db: Db, trackId: string): TrackPointRow[] {
  return db
    .select()
    .from(trackPoints)
    .where(eq(trackPoints.trackId, trackId))
    .orderBy(asc(trackPoints.segmentIndex), asc(trackPoints.seq))
    .all()
    .map((p) => ({
      segmentIndex: p.segmentIndex,
      seq: p.seq,
      lat: p.lat,
      lon: p.lon,
      eleM: p.eleM ?? null,
      recordedAt: p.recordedAt ?? null,
    }));
}

export function updateTrack(
  db: Db,
  id: string,
  patch: {
    name?: string;
    colour?: string | null;
    width?: number | null;
    tripId?: string;
  },
  now: number,
): void {
  const set: Record<string, unknown> = { updatedAt: now };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.colour !== undefined) set.colour = patch.colour;
  if (patch.width !== undefined) set.width = patch.width;
  if (patch.tripId !== undefined) set.tripId = patch.tripId;
  db.update(tracks).set(set).where(eq(tracks.id, id)).run();
}

export function writeTrackStats(
  db: Db,
  id: string,
  stats: {
    pointCount: number;
    distanceM: number | null;
    elevGainM: number | null;
    elevLossM: number | null;
    startedAt: number | null;
    endedAt: number | null;
  },
  now: number,
): void {
  db.update(tracks)
    .set({ ...stats, updatedAt: now })
    .where(eq(tracks.id, id))
    .run();
}

/**
 * Writes the render cache and the tolerance it was built at.
 *
 * Storing the tolerance means a cache built for the wrong zoom can be detected
 * and rebuilt, rather than silently reused and drawn wrong.
 */
export function writeRenderGeometry(
  db: Db,
  id: string,
  geometry: Uint8Array | null,
  toleranceM: number | null,
): void {
  db.update(tracks)
    .set({
      renderGeometry: geometry === null ? null : Buffer.from(geometry),
      renderToleranceM: toleranceM,
    })
    .where(eq(tracks.id, id))
    .run();
}

export function readRenderGeometry(db: Db, id: string): Uint8Array | null {
  const row = db
    .select({ geometry: tracks.renderGeometry })
    .from(tracks)
    .where(eq(tracks.id, id))
    .get();
  const value = row?.geometry;
  return value === null || value === undefined ? null : new Uint8Array(value);
}

export function deleteTrack(db: Db, id: string): void {
  db.delete(tracks).where(eq(tracks.id, id)).run();
}

// ----------------------------------------------------------- source bytes

/** Retains the imported file verbatim, so an edit can always be rolled back. */
export function insertTrackSource(
  db: Db,
  values: {
    trackId: string;
    format: string;
    contentHash: string;
    bytes: Uint8Array;
    now: number;
  },
): void {
  db.insert(trackSources)
    .values({
      id: randomUUID(),
      trackId: values.trackId,
      format: values.format,
      contentHash: values.contentHash,
      originalBytes: Buffer.from(values.bytes),
      createdAt: values.now,
    })
    .run();
}

export function findTrackSource(
  db: Db,
  trackId: string,
): { format: string; contentHash: string; bytes: Uint8Array } | null {
  const row = db
    .select()
    .from(trackSources)
    .where(eq(trackSources.trackId, trackId))
    .get();
  if (row === undefined) return null;
  return {
    format: row.format,
    contentHash: row.contentHash,
    bytes: new Uint8Array(row.originalBytes),
  };
}

export function countTracksInTrip(db: Db, tripId: string): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(tracks)
    .where(eq(tracks.tripId, tripId))
    .get();
  return row?.n ?? 0;
}

/**
 * Bounding box of a track, computed in SQL.
 *
 * Deliberately an aggregate query rather than reading the points into JS: a
 * 200,000-point track would mean materialising 200,000 objects just to find
 * four numbers, and this runs on every selection change. SQLite does the scan
 * in milliseconds.
 *
 * Null when the track has no points — there is no such thing as an empty box.
 */
export function trackBounds(
  db: Db,
  trackId: string,
): { minLat: number; minLon: number; maxLat: number; maxLon: number } | null {
  const row = db
    .select({
      minLat: sql<number | null>`min(${trackPoints.lat})`,
      minLon: sql<number | null>`min(${trackPoints.lon})`,
      maxLat: sql<number | null>`max(${trackPoints.lat})`,
      maxLon: sql<number | null>`max(${trackPoints.lon})`,
    })
    .from(trackPoints)
    .where(eq(trackPoints.trackId, trackId))
    .get();

  if (
    row === undefined ||
    row.minLat === null ||
    row.minLon === null ||
    row.maxLat === null ||
    row.maxLon === null
  ) {
    return null;
  }

  return {
    minLat: row.minLat,
    minLon: row.minLon,
    maxLat: row.maxLat,
    maxLon: row.maxLon,
  };
}

/**
 * One bounding box covering every track in a trip, in a single query.
 *
 * A typed inner join rather than interpolated SQL with table aliases: Drizzle
 * renders an interpolated column unqualified inside a subquery, which is how a
 * join silently compares the wrong columns. Joining the tables it knows about
 * keeps the qualification correct and the query checked.
 */
export function trackBoundsForTrip(
  db: Db,
  tripId: string,
): { minLat: number; minLon: number; maxLat: number; maxLon: number } | null {
  const row = db
    .select({
      minLat: sql<number | null>`min(${trackPoints.lat})`,
      minLon: sql<number | null>`min(${trackPoints.lon})`,
      maxLat: sql<number | null>`max(${trackPoints.lat})`,
      maxLon: sql<number | null>`max(${trackPoints.lon})`,
    })
    .from(trackPoints)
    .innerJoin(tracks, eq(trackPoints.trackId, tracks.id))
    .where(eq(tracks.tripId, tripId))
    .get();

  if (
    row === undefined ||
    row.minLat === null ||
    row.minLon === null ||
    row.maxLat === null ||
    row.maxLon === null
  ) {
    return null;
  }

  return {
    minLat: row.minLat,
    minLon: row.minLon,
    maxLat: row.maxLat,
    maxLon: row.maxLon,
  };
}
