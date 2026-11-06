import { createHash } from 'node:crypto';
import type {
  Bounds,
  Track,
  TrackGeometry,
  TrackSegment,
  TrackStats,
  TrackWithPoints,
} from '@shared/domain/types';
import { boundingBox, elevationStats, pathDistance } from '@shared/geo/distance';
import { packPolyline, unpackPolyline } from '@shared/geo/packed';
import { simplify, toleranceForZoom } from '@shared/geo/simplify';
import type { ParsedTrack } from '@shared/io/types';
import type { Db } from '../db/client';
import * as repo from '../db/repositories/tracks';
import * as tripRepo from '../db/repositories/trips';
import { notFound, ServiceError } from './errors';
import type { Mutation } from './folderService';

/**
 * Track use cases.
 *
 * Tracks are recorded data, so the governing rule is non-destructive editing:
 * the original imported bytes are retained (`track_sources`), every edit
 * recomputes derived statistics, and the render cache is invalidated rather
 * than left stale.
 *
 * Unlike routes, edits are **targeted** rather than whole-array replacements.
 * A 200,000-point track would put megabytes on the undo stack per edit, which
 * is why the two models are deliberately different — see ADR 0003 and the
 * Phase 3 design.
 */

/** The zoom the render cache is built for. Low enough to be a big saving. */
const CACHE_ZOOM = 12;

function assertTripExists(db: Db, tripId: string): void {
  if (tripRepo.findTrip(db, tripId) === null) throw notFound('That trip');
}

export function computeStats(
  segments: readonly TrackSegment[],
): TrackStats {
  const all = segments.flatMap((s) => s.points);

  const elevation = elevationStats(
    all.map((p) => ({ lat: p.lat, lon: p.lon, ele: p.ele })),
  );

  // Distance is summed per segment. Joining across a segment break would
  // invent travel the recording does not claim happened.
  const distanceM =
    all.length === 0
      ? null
      : segments.reduce((sum, segment) => sum + pathDistance(segment.points), 0);

  // Folded rather than spread into `Math.min`: a 200,000-point recording
  // exceeds the argument limit and throws RangeError.
  let startedAt: number | null = null;
  let endedAt: number | null = null;
  for (const point of all) {
    const time = point.time;
    if (time === null || !Number.isFinite(time)) continue;
    if (startedAt === null || time < startedAt) startedAt = time;
    if (endedAt === null || time > endedAt) endedAt = time;
  }

  return {
    pointCount: all.length,
    segmentCount: segments.length,
    distanceM,
    elevGainM: elevation.gain,
    elevLossM: elevation.loss,
    elevMinM: elevation.min,
    elevMaxM: elevation.max,
    startedAt,
    endedAt,
    // Null, not 0, when the recording is untimed.
    durationS:
      startedAt !== null && endedAt !== null
        ? Math.round((endedAt - startedAt) / 1000)
        : null,
  };
}

function toTrack(
  row: repo.TrackRow,
  stats: TrackStats,
  hasOriginal: boolean,
): Track {
  return {
    id: row.id,
    tripId: row.tripId,
    name: row.name,
    colour: row.colour,
    width: row.width,
    source: row.source,
    hasOriginal,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...stats,
  };
}

function segmentsOf(db: Db, trackId: string): TrackSegment[] {
  const rows = repo.listTrackPoints(db, trackId);
  const segments: TrackSegment[] = [];
  for (const row of rows) {
    let segment = segments[row.segmentIndex];
    if (segment === undefined) {
      segment = { points: [] };
      segments[row.segmentIndex] = segment;
    }
    segment.points.push({
      lat: row.lat,
      lon: row.lon,
      ele: row.eleM,
      time: row.recordedAt,
    });
  }
  // A deleted middle segment would leave a hole; compact rather than emit
  // undefined entries.
  return segments.filter((s) => s !== undefined);
}

function requireTrack(db: Db, id: string): repo.TrackRow {
  const row = repo.findTrack(db, id);
  if (row === null) throw notFound('That track');
  return row;
}

export function get(db: Db, id: string): TrackWithPoints {
  const row = requireTrack(db, id);
  const segments = segmentsOf(db, id);
  const stats = computeStats(segments);
  const hasOriginal = repo.findTrackSource(db, id) !== null;
  return { ...toTrack(row, stats, hasOriginal), segments };
}

/**
 * The same track without its points.
 *
 * Returned by mutations that do not touch geometry. A 200,000-point track is
 * megabytes of structured clone across the IPC boundary, and sending it back
 * because its colour changed would be absurd.
 */
export function summary(db: Db, id: string): Track {
  const { segments: _segments, ...track } = get(db, id);
  return track;
}

export function listForTrip(db: Db, tripId: string): Track[] {
  assertTripExists(db, tripId);
  return repo.listTracksForTrip(db, tripId).map((row) => {
    // Cached columns are authoritative for a list; recomputing from points for
    // every track would mean reading every point of every track.
    const stats: TrackStats = {
      pointCount: row.pointCount,
      segmentCount: 0,
      distanceM: row.distanceM,
      elevGainM: row.elevGainM,
      elevLossM: row.elevLossM,
      elevMinM: null,
      elevMaxM: null,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      durationS:
        row.startedAt !== null && row.endedAt !== null
          ? Math.round((row.endedAt - row.startedAt) / 1000)
          : null,
    };
    return toTrack(row, stats, false);
  });
}

export function listAll(db: Db): (Track & { tripName: string })[] {
  return repo.listAllTracks(db).map((row) => ({
    ...toTrack(
      row,
      {
        pointCount: row.pointCount,
        segmentCount: 0,
        distanceM: row.distanceM,
        elevGainM: row.elevGainM,
        elevLossM: row.elevLossM,
        elevMinM: null,
        elevMaxM: null,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        durationS:
          row.startedAt !== null && row.endedAt !== null
            ? Math.round((row.endedAt - row.startedAt) / 1000)
            : null,
      },
      false,
    ),
    tripName: row.tripName,
  }));
}

/** Rebuilds the render cache from the points. Pure function of the geometry. */
export function rebuildRenderCache(db: Db, trackId: string): void {
  const segments = segmentsOf(db, trackId);
  const tolerance = toleranceForZoom(CACHE_ZOOM);

  // Segments are concatenated for the cache because it exists only to draw a
  // coarse overview; segment-accurate rendering uses the real points.
  const simplified = segments.flatMap((segment) =>
    simplify(segment.points, tolerance),
  );

  repo.writeRenderGeometry(
    db,
    trackId,
    simplified.length === 0 ? null : packPolyline(simplified),
    simplified.length === 0 ? null : tolerance,
  );
}

function recompute(db: Db, trackId: string, now: number): void {
  const segments = segmentsOf(db, trackId);
  const stats = computeStats(segments);
  repo.writeTrackStats(
    db,
    trackId,
    {
      pointCount: stats.pointCount,
      distanceM: stats.distanceM,
      elevGainM: stats.elevGainM,
      elevLossM: stats.elevLossM,
      startedAt: stats.startedAt,
      endedAt: stats.endedAt,
    },
    now,
  );
  rebuildRenderCache(db, trackId);
}

export interface CreateTrackInput {
  id?: string;
  tripId: string;
  parsed: ParsedTrack;
  source: 'user' | 'import';
  /** Original file bytes, retained so the import stays recoverable. */
  originalBytes?: Uint8Array;
  originalFormat?: string;
}

/**
 * Creates a track from parsed data.
 *
 * Everything happens in one transaction, including the bulk point insert and
 * the derived statistics, so a failure cannot leave a track with the wrong
 * counts.
 */
export function createFromParsed(
  db: Db,
  input: CreateTrackInput,
): Mutation<TrackWithPoints> {
  assertTripExists(db, input.tripId);

  const id = db.transaction((): string => {
    const now = Date.now();
    const trackId = repo.insertTrack(db, {
      ...(input.id === undefined ? {} : { id: input.id }),
      tripId: input.tripId,
      name: input.parsed.name,
      colour: null,
      width: null,
      source: input.source,
      // The parsers go to real trouble to collect what a format carried and we
      // have no column for. Dropping it here would make that effort pointless
      // and breach the import-fidelity rule.
      metadata: input.parsed.metadata,
      now,
    });

    repo.replaceTrackPoints(
      db,
      trackId,
      input.parsed.segments.map((segment) => ({
        points: segment.points.map((p) => ({
          segmentIndex: 0,
          seq: 0,
          lat: p.lat,
          lon: p.lon,
          eleM: p.ele,
          recordedAt: p.time,
        })),
      })),
    );

    if (input.originalBytes !== undefined) {
      repo.insertTrackSource(db, {
        trackId,
        format: input.originalFormat ?? 'unknown',
        contentHash: createHash('sha256')
          .update(input.originalBytes)
          .digest('hex'),
        bytes: input.originalBytes,
        now,
      });
    }

    recompute(db, trackId, now);
    return trackId;
  });

  return {
    result: get(db, id),
    inverse: { kind: 'track:delete', payload: { id } },
  };
}

export function update(
  db: Db,
  input: {
    id: string;
    name?: string | undefined;
    colour?: string | null | undefined;
    width?: number | null | undefined;
  },
): Mutation<Track> {
  const before = requireTrack(db, input.id);
  const patch: Parameters<typeof repo.updateTrack>[2] = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.colour !== undefined) patch.colour = input.colour;
  if (input.width !== undefined) patch.width = input.width;

  repo.updateTrack(db, input.id, patch, Date.now());

  return {
    // Geometry is untouched, so the points are not sent back.
    result: summary(db, input.id),
    inverse: {
      kind: 'track:update',
      payload: {
        id: before.id,
        name: before.name,
        colour: before.colour,
        width: before.width,
      },
    },
  };
}

export function moveToTrip(
  db: Db,
  input: { id: string; tripId: string },
): Mutation<Track> {
  const before = requireTrack(db, input.id);
  assertTripExists(db, input.tripId);
  repo.updateTrack(db, input.id, { tripId: input.tripId }, Date.now());
  return {
    result: summary(db, input.id),
    inverse: {
      kind: 'track:move',
      payload: { id: before.id, tripId: before.tripId },
    },
  };
}

/**
 * Replaces a track's geometry.
 *
 * The inverse is deliberately **not** the previous point array: for a large
 * track that would be megabytes per undo entry. Instead the caller records a
 * targeted inverse, and destructive operations stay recoverable through the
 * retained original bytes.
 */
export function setSegments(
  db: Db,
  id: string,
  segments: readonly TrackSegment[],
): TrackWithPoints {
  requireTrack(db, id);
  return db.transaction((): TrackWithPoints => {
    const now = Date.now();
    repo.replaceTrackPoints(
      db,
      id,
      segments.map((segment) => ({
        points: segment.points.map((p) => ({
          segmentIndex: 0,
          seq: 0,
          lat: p.lat,
          lon: p.lon,
          eleM: p.ele,
          recordedAt: p.time,
        })),
      })),
    );
    recompute(db, id, now);
    return get(db, id);
  });
}

/** Reverses point order within every segment, and the segment order itself. */
export function reverse(db: Db, id: string): Mutation<TrackWithPoints> {
  const current = get(db, id);
  const reversed = current.segments
    .toReversed()
    .map((segment) => ({ points: segment.points.toReversed() }));
  return {
    result: setSegments(db, id, reversed),
    inverse: { kind: 'track:reverse', payload: { id } },
  };
}

/**
 * Simplifies a track.
 *
 * Explicit and user-initiated — never applied on import. The original remains
 * recoverable from the retained source bytes, which is what makes this
 * acceptable at all for recorded data.
 */
export function simplifyTrack(
  db: Db,
  id: string,
  toleranceM: number,
): Mutation<TrackWithPoints> {
  if (!Number.isFinite(toleranceM) || toleranceM <= 0) {
    throw new ServiceError(
      'INVALID_REQUEST',
      'Simplification tolerance must be a positive number of metres.',
    );
  }

  const current = get(db, id);
  const reduced = current.segments.map((segment) => ({
    points: simplify(segment.points, toleranceM),
  }));

  return {
    result: setSegments(db, id, reduced),
    // Recorded geometry is not round-tripped through the undo stack; the
    // original file is the recovery path. Reported honestly rather than
    // claiming an inverse that would be megabytes.
    inverse: { kind: 'none', payload: {} },
  };
}

/** Predicts the result so the UI can show it before anything is applied. */
export function previewSimplify(
  db: Db,
  id: string,
  toleranceM: number,
): { before: number; after: number } {
  const current = get(db, id);
  const after = current.segments.reduce(
    (sum, segment) => sum + simplify(segment.points, toleranceM).length,
    0,
  );
  return { before: current.pointCount, after };
}

/** Splits a track into two at a point index, counted across all segments. */
export function split(
  db: Db,
  id: string,
  pointIndex: number,
): Mutation<{ first: TrackWithPoints; second: TrackWithPoints }> {
  const current = get(db, id);
  const all = current.segments.flatMap((s) => s.points);

  if (pointIndex <= 0 || pointIndex >= all.length - 1) {
    throw new ServiceError(
      'INVALID_REQUEST',
      'A split needs at least one point on each side.',
    );
  }

  const result = db.transaction(() => {
    const first = setSegments(db, id, [{ points: all.slice(0, pointIndex) }]);
    const second = createFromParsed(db, {
      tripId: current.tripId,
      source: current.source,
      parsed: {
        name: `${current.name} (2)`,
        segments: [
          {
            points: all.slice(pointIndex).map((p) => ({
              lat: p.lat,
              lon: p.lon,
              ele: p.ele,
              time: p.time,
            })),
          },
        ],
        metadata: {},
      },
    }).result;
    repo.updateTrack(db, id, { name: `${current.name} (1)` }, Date.now());
    return { first: get(db, first.id), second };
  });

  return {
    result,
    // Undoing a split means rejoining, which the join command does.
    inverse: {
      kind: 'track:join',
      payload: { firstId: id, secondId: result.second.id, name: current.name },
    },
  };
}

/** Joins `secondId` onto the end of `firstId`, preserving segment breaks. */
export function join(
  db: Db,
  input: { firstId: string; secondId: string; name?: string | undefined },
): Mutation<TrackWithPoints> {
  const first = get(db, input.firstId);
  const second = get(db, input.secondId);

  if (first.tripId !== second.tripId) {
    throw new ServiceError(
      'INVALID_REQUEST',
      'Only tracks in the same trip can be joined.',
    );
  }

  db.transaction(() => {
    // Segments are concatenated rather than merged: the break between two
    // recordings is real information.
    setSegments(db, input.firstId, [...first.segments, ...second.segments]);
    repo.deleteTrack(db, input.secondId);
    if (input.name !== undefined) {
      repo.updateTrack(db, input.firstId, { name: input.name }, Date.now());
    }
  });

  return {
    result: get(db, input.firstId),
    inverse: { kind: 'none', payload: {} },
  };
}

/** Deletes a contiguous run of points, counted across all segments. */
export function deletePointRange(
  db: Db,
  id: string,
  from: number,
  to: number,
): Mutation<TrackWithPoints> {
  const current = get(db, id);
  const all = current.segments.flatMap((s) => s.points);
  const start = Math.max(0, Math.min(from, to));
  const end = Math.min(all.length - 1, Math.max(from, to));

  if (all.length - (end - start + 1) < 1) {
    throw new ServiceError(
      'INVALID_REQUEST',
      'That would remove every point. Delete the track instead.',
    );
  }

  const removed = all.slice(start, end + 1);
  const kept = [...all.slice(0, start), ...all.slice(end + 1)];

  return {
    result: setSegments(db, id, [{ points: kept }]),
    // The removed run is small by construction, so it is cheap to carry as a
    // real inverse — unlike a whole-track snapshot.
    inverse: {
      kind: 'track:restorePoints',
      payload: { id, index: start, points: removed },
    },
  };
}

/** Reinserts a previously removed run. Only reached through undo. */
export function restorePoints(
  db: Db,
  input: {
    id: string;
    index: number;
    points: readonly { lat: number; lon: number; ele: number | null; time: number | null }[];
  },
): Mutation<TrackWithPoints> {
  const current = get(db, input.id);
  const all = current.segments.flatMap((s) => s.points);
  const index = Math.max(0, Math.min(all.length, input.index));
  const restored = [
    ...all.slice(0, index),
    ...input.points.map((p) => ({ ...p })),
    ...all.slice(index),
  ];

  return {
    result: setSegments(db, input.id, [{ points: restored }]),
    inverse: {
      kind: 'track:deleteRange',
      payload: {
        id: input.id,
        from: index,
        to: index + input.points.length - 1,
      },
    },
  };
}

export function remove(db: Db, id: string): Mutation<{ id: string }> {
  requireTrack(db, id);
  repo.deleteTrack(db, id);
  return {
    result: { id },
    // A track can hold hundreds of thousands of points, so its deletion is not
    // undoable; it is confirmation-gated, and the original file is the recovery
    // path when there is one.
    inverse: { kind: 'none', payload: {} },
  };
}

/** The retained original bytes, for re-importing after destructive edits. */
export function originalBytes(
  db: Db,
  id: string,
): { format: string; bytes: Uint8Array } | null {
  const source = repo.findTrackSource(db, id);
  return source === null
    ? null
    : { format: source.format, bytes: source.bytes };
}

/**
 * Geometry for the map, chosen by zoom.
 *
 * Below `CACHE_ZOOM` the packed render cache is returned: a 200,000-point
 * track becomes a few thousand vertices, which is the difference between an
 * interactive map and a frozen one. At or above it the real points are sent,
 * because by then the simplification would be visible.
 *
 * The response says which it gave — `simplified` — rather than leaving the
 * renderer to infer it. A caller that needs exact geometry (an export, a
 * statistic) must not be handed a cache without being told.
 */
export function geometryFor(
  db: Db,
  id: string,
  zoom: number,
): TrackGeometry {
  requireTrack(db, id);

  if (zoom < CACHE_ZOOM) {
    const packed = repo.readRenderGeometry(db, id);
    if (packed !== null) {
      return {
        trackId: id,
        simplified: true,
        // One concatenated run: the cache exists for a coarse overview, and
        // segment-accurate drawing uses the real points above the threshold.
        segments: [
          {
            points: unpackPolyline(packed).map((p) => ({
              lat: p.lat,
              lon: p.lon,
            })),
          },
        ],
      };
    }
    // No cache: build it now rather than silently returning nothing. This is
    // the path a track takes after a restore from a backup written by an older
    // build.
    rebuildRenderCache(db, id);
    const rebuilt = repo.readRenderGeometry(db, id);
    if (rebuilt !== null) {
      return {
        trackId: id,
        simplified: true,
        segments: [
          {
            points: unpackPolyline(rebuilt).map((p) => ({
              lat: p.lat,
              lon: p.lon,
            })),
          },
        ],
      };
    }
  }

  return {
    trackId: id,
    simplified: false,
    segments: segmentsOf(db, id).map((segment) => ({
      points: segment.points.map((p) => ({ lat: p.lat, lon: p.lon })),
    })),
  };
}

/** Bounding box of a track, for "fit to screen". Null when it has no points. */
export function boundsFor(db: Db, id: string): Bounds | null {
  requireTrack(db, id);
  return boundingBox(
    segmentsOf(db, id).flatMap((segment) =>
      segment.points.map((p) => ({ lat: p.lat, lon: p.lon })),
    ),
  );
}

/**
 * Replaces a track's geometry with its retained original.
 *
 * This is the recovery path that makes an explicit simplify or point deletion
 * acceptable on recorded data: the import is never actually gone. Only the
 * geometry is restored — the name, colour and width the user chose since are
 * their decisions, not the file's.
 */
export function restoreOriginal(
  db: Db,
  id: string,
  reparse: (format: string, bytes: Uint8Array) => readonly TrackSegment[],
): Mutation<TrackWithPoints> {
  requireTrack(db, id);
  const source = repo.findTrackSource(db, id);

  if (source === null) {
    throw new ServiceError(
      'INVALID_REQUEST',
      'This track was not imported from a file, so there is no original to restore.',
    );
  }

  const segments = reparse(source.format, source.bytes);
  if (segments.length === 0) {
    throw new ServiceError(
      'INVALID_REQUEST',
      'The retained original file no longer yields any track geometry.',
    );
  }

  return {
    result: setSegments(db, id, segments),
    // Restoring loses whatever editing came after it, and that is not
    // reversible from the stored data. Reported as such rather than claiming
    // an inverse that would be a whole-track snapshot.
    inverse: { kind: 'none', payload: {} },
  };
}
