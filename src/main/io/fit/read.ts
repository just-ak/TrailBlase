import { basename } from 'node:path';
import FitParser from 'fit-file-parser';
import type { ParsedFit } from 'fit-file-parser';
import {
  emptyParsedFile,
  ParseError,
  type ParsedFile,
  type ParsedTrackPoint,
  type ParsedWaypoint,
} from '@shared/io/types';

/**
 * FIT reader. Read-only, deliberately.
 *
 * Writing FIT would mean fabricating device identifiers, session summaries and
 * a profile version, producing a file that claims to come from a device and
 * does not. The same reasoning as TCX, and the same steering rule.
 *
 * Licensing is why this uses `fit-file-parser` (MIT) rather than Garmin's own
 * FIT SDK, whose bilateral EULA is incompatible with GPL-3.0 — ADR 0006, as
 * amended by ADR 0007. Nothing here decodes an encrypted or DRM-protected
 * file; FIT activity data is not protected.
 *
 * ## FIT is lossy, and this module does not pretend otherwise
 *
 * FIT stores coordinates as 32-bit **semicircles**, where
 * `degrees = semicircles × 180 / 2^31`. That quantises a degree value to about
 * 2 × 10⁻⁸°, which is roughly 2 mm on the ground. Altitude is a `uint16` with
 * scale 5 and offset 500 m, giving 0.2 m resolution.
 *
 * So 46.5197 read back as 46.51969998 and 1850.5 m as 1850.6 m is **correct**.
 * The import-fidelity rule means preserving what the format can represent, and
 * a round trip through FIT cannot be exact. Tests assert closeness with a
 * stated tolerance rather than equality, and a warning tells the user.
 *
 * `fit-file-parser` performs the semicircle and altitude conversions itself, so
 * this module does not repeat them; the constants are kept here only to
 * document and verify the resolution claim above.
 */

/**
 * Derived from `ParsedFit` rather than imported.
 *
 * The package's export map exposes only `ParsedFit` from its root, and
 * reaching into `dist/` for the element types would couple this module to the
 * library's build layout. Indexing the public type survives a reorganisation.
 */
type FitRecord = NonNullable<ParsedFit['records']>[number];
type FitLap = NonNullable<ParsedFit['laps']>[number];

/** `degrees = semicircles × 180 / 2^31`. */
export const SEMICIRCLES_PER_DEGREE = 2 ** 31 / 180;

/** Coordinate resolution in degrees, from the 32-bit semicircle encoding. */
export const FIT_COORDINATE_RESOLUTION_DEG = 1 / SEMICIRCLES_PER_DEGREE;

/** Altitude is uint16, scale 5, offset 500 m. */
export const FIT_ALTITUDE_RESOLUTION_M = 1 / 5;

/** Per-record fields FIT carries that have no column here. */
const RECORD_EXTRAS = [
  'heart_rate',
  'cadence',
  'power',
  'temperature',
  'speed',
  'distance',
  'grade',
  'gps_accuracy',
  'vertical_speed',
  'calories',
] as const;

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function epoch(value: unknown): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function recordToPoint(record: FitRecord): ParsedTrackPoint | null {
  const lat = finite(record.position_lat);
  const lon = finite(record.position_long);

  // Records without a position are normal in FIT: indoor samples, and the
  // moments before a GPS fix. They carry no geometry.
  if (lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  return {
    lat,
    lon,
    // Already metres; absent stays null rather than becoming 0.
    ele: finite(record.altitude),
    time: epoch(record.timestamp),
  };
}

function recordExtras(record: FitRecord): Record<string, number> {
  const extras: Record<string, number> = {};
  for (const key of RECORD_EXTRAS) {
    const value = finite((record as Record<string, unknown>)[key]);
    if (value !== null) extras[key] = value;
  }
  return extras;
}

function lapSummary(lap: FitLap): Record<string, unknown> {
  return {
    startTime: epoch(lap.start_time),
    totalElapsedTimeS: finite(lap.total_elapsed_time),
    totalDistanceM: finite(lap.total_distance),
    totalAscentM: finite(lap.total_ascent),
    totalDescentM: finite(lap.total_descent),
    avgHeartRate: finite(lap.avg_heart_rate),
    maxHeartRate: finite(lap.max_heart_rate),
    totalCalories: finite(lap.total_calories),
  };
}

/**
 * Splits records into per-lap segments.
 *
 * A lap boundary is a real break in the recording, so it becomes a segment
 * rather than being flattened. Records are assigned by timestamp against each
 * lap's `start_time`, because `records` is a flat list and the laps carry the
 * boundaries.
 *
 * With no usable lap times the whole recording is one segment, which is both
 * true and what a single-lap activity means anyway.
 */
function segmentByLap(
  points: readonly ParsedTrackPoint[],
  extras: readonly Record<string, number>[],
  laps: readonly FitLap[],
): { segments: { points: ParsedTrackPoint[] }[]; extras: Record<string, number>[][] } {
  const starts = laps
    .map((lap) => epoch(lap.start_time))
    .filter((t): t is number => t !== null)
    .toSorted((a, b) => a - b);

  if (starts.length < 2 || points.some((p) => p.time === null)) {
    return { segments: [{ points: [...points] }], extras: [[...extras]] };
  }

  const segments: { points: ParsedTrackPoint[] }[] = [];
  const grouped: Record<string, number>[][] = [];

  for (const [index, start] of starts.entries()) {
    const end = starts[index + 1] ?? Number.POSITIVE_INFINITY;
    const selected: ParsedTrackPoint[] = [];
    const selectedExtras: Record<string, number>[] = [];

    for (const [pointIndex, point] of points.entries()) {
      const time = point.time;
      if (time === null || time < start || time >= end) continue;
      selected.push(point);
      selectedExtras.push(extras[pointIndex] ?? {});
    }

    if (selected.length > 0) {
      segments.push({ points: selected });
      grouped.push(selectedExtras);
    }
  }

  // Records before the first lap start would otherwise be lost.
  const assigned = segments.reduce((sum, s) => sum + s.points.length, 0);
  if (assigned < points.length) {
    const firstStart = starts[0] as number;
    const orphans: ParsedTrackPoint[] = [];
    const orphanExtras: Record<string, number>[] = [];
    for (const [pointIndex, point] of points.entries()) {
      if (point.time !== null && point.time >= firstStart) continue;
      orphans.push(point);
      orphanExtras.push(extras[pointIndex] ?? {});
    }
    if (orphans.length > 0) {
      segments.unshift({ points: orphans });
      grouped.unshift(orphanExtras);
    }
  }

  return segments.length === 0
    ? { segments: [{ points: [...points] }], extras: [[...extras]] }
    : { segments, extras: grouped };
}

function coursePointsToWaypoints(data: ParsedFit): ParsedWaypoint[] {
  const waypoints: ParsedWaypoint[] = [];

  for (const [index, point] of (data.course_points ?? []).entries()) {
    const lat = finite(point.position_lat);
    const lon = finite(point.position_long);
    if (lat === null || lon === null) continue;

    waypoints.push({
      name: point.name ?? `Course point ${index + 1}`,
      lat,
      lon,
      // Course points carry no altitude in FIT.
      ele: null,
      description: null,
      // FIT course point types are their own vocabulary, not Garmin <sym>
      // names, so the raw value is kept rather than guessed at.
      symbol: null,
      notes: null,
      time: epoch(point.timestamp),
      metadata:
        point.type === undefined ? {} : { fitCoursePointType: point.type },
    });
  }

  return waypoints;
}

export async function readFit(
  bytes: Uint8Array,
  sourcePath: string,
): Promise<ParsedFile> {
  const file = emptyParsedFile('fit', basename(sourcePath));

  // `force: true` tolerates a truncated tail or a bad CRC and returns what it
  // could decode. A recording cut short by a flat battery is common, and
  // recovering most of it beats refusing all of it — the warning below says so.
  const parser = new FitParser({ force: true, mode: 'list', lengthUnit: 'm', speedUnit: 'm/s' });

  let data: ParsedFit;
  try {
    data = await parser.parseAsync(
      // A copy, because the parser is handed the buffer and a subarray view
      // over a larger allocation would expose bytes outside the file.
      Buffer.from(bytes.slice().buffer as ArrayBuffer),
    );
  } catch (cause) {
    throw new ParseError(
      'fit',
      'This file could not be read as FIT.',
      typeof cause === 'string'
        ? cause
        : cause instanceof Error
          ? cause.message
          : String(cause),
    );
  }

  const records = data.records ?? [];
  const points: ParsedTrackPoint[] = [];
  const extras: Record<string, number>[] = [];
  let positionless = 0;

  for (const record of records) {
    const point = recordToPoint(record);
    if (point === null) {
      positionless += 1;
      continue;
    }
    points.push(point);
    extras.push(recordExtras(record));
  }

  file.waypoints.push(...coursePointsToWaypoints(data));

  if (points.length === 0) {
    if (file.waypoints.length === 0) {
      file.warnings.push(
        records.length === 0
          ? 'This FIT file contains no records, so there is nothing to import.'
          : 'No record in this FIT file carried a position, so there is no track to import.',
      );
    }
    return finish(file, data, positionless, extras);
  }

  const laps = data.laps ?? [];
  const grouped = segmentByLap(points, extras, laps);

  const sport = data.sessions?.[0]?.sport;
  const fileId = data.file_ids?.[0];

  const name =
    typeof sport === 'string' && sport.length > 0
      ? `${sport[0]?.toUpperCase()}${sport.slice(1)} activity`
      : basename(sourcePath).replace(/\.fit$/i, '');

  const metadata: Record<string, unknown> = {
    pointExtras: grouped.extras,
    laps: laps.map(lapSummary),
  };
  if (sport !== undefined) metadata.sport = sport;
  if (fileId !== undefined) {
    metadata.fitFileId = {
      type: fileId.type ?? null,
      manufacturer: fileId.manufacturer ?? null,
      product: fileId.product ?? null,
      serialNumber: fileId.serial_number ?? null,
      timeCreated: epoch(fileId.time_created),
    };
  }

  file.tracks.push({ name, segments: grouped.segments, metadata });

  return finish(file, data, positionless, grouped.extras.flat());
}

function finish(
  file: ParsedFile,
  data: ParsedFit,
  positionless: number,
  extras: readonly Record<string, number>[],
): ParsedFile {
  if (positionless > 0) {
    file.warnings.push(
      `${positionless} record${positionless === 1 ? '' : 's'} had no position and carried no geometry.`,
    );
  }

  // Stated on every FIT import, not buried in documentation: the user needs to
  // know their coordinates are quantised before they compare an export against
  // the original.
  if (file.tracks.length > 0) {
    file.warnings.push(
      'FIT stores coordinates as 32-bit semicircles (about 2 mm) and altitude at 0.2 m resolution, so values differ very slightly from a text format.',
    );
  }

  const present = new Set<string>();
  for (const record of extras) {
    for (const key of Object.keys(record)) present.add(key);
  }
  for (const key of [...present].toSorted()) {
    file.unmappedMetadata.push(`FIT record ${key}`);
  }

  if ((data.laps ?? []).length > 0) {
    file.unmappedMetadata.push('FIT lap summaries');
  }
  if ((data.sessions ?? []).length > 0) {
    file.unmappedMetadata.push('FIT session summary');
  }

  return file;
}
