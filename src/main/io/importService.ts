import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import {
  emptyParsedFile,
  ParseError,
  parsedPointCount,
  type ImportFormat,
  type ImportProgress,
  type ImportReport,
  type ParsedFile,
} from '@shared/io/types';
import type { Db } from '../db/client';
import * as historyRepo from '../db/repositories/importHistory';
import * as tripRepo from '../db/repositories/trips';
import { ServiceError } from '../services/errors';
import * as routeService from '../services/routeService';
import * as trackService from '../services/trackService';
import * as waypointService from '../services/waypointService';
import { readCsv } from './csv/read';
import { detectFormat } from './detect';
import { readFit } from './fit/read';
import { readGpx } from './gpx/read';
import { readKml } from './kml/read';
import { readKmz } from './kmz/read';
import { applyCollection, parseCollection } from './json/read';
import { readTcx } from './tcx/read';

/**
 * The import pipeline: **parse → preview → commit**.
 *
 * The three stages are separate functions, and that separation is the feature.
 * `parseFile` touches no database at all, so a preview can never half-import
 * something; `commitFile` writes in one transaction per file, so a failure
 * part-way through a multi-file selection leaves the already-imported files
 * intact and the failing one absent entirely.
 *
 * ## What the user is told
 *
 * The import-fidelity rule says nothing may be silently dropped. The report
 * carries four lists for that reason:
 *
 * - `imported` — counts of what was written
 * - `skipped` — present in the file but not imported, each with a reason
 * - `warnings` — imported, but something was unusual
 * - `unmappedMetadata` — preserved in `metadata`, named so the user knows it
 *   survived
 *
 * Every one of those is surfaced in the dialog and persisted in
 * `import_history`, so the answer to "what happened to my file" outlives the
 * dialog.
 *
 * ## Text decoding
 *
 * `TextDecoder` with `fatal: false` rather than `readFile(path, 'utf8')`: a GPX
 * written by an older Windows tool may be Latin-1, and replacement characters
 * in a description are better than refusing the whole file. A BOM is stripped
 * because `fast-xml-parser` treats it as content before the declaration.
 */

const MAX_BYTES = 512 * 1024 * 1024;

/** Progress is reported this often, not per point, which would dominate. */
const PROGRESS_POINT_INTERVAL = 10_000;

function decodeText(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export interface ParseResult {
  /** Absolute path, used as the key when committing. */
  sourcePath: string;
  file: ParsedFile;
}

/**
 * Reads and parses one file. **No database access.**
 *
 * Binary formats get the bytes; text formats get decoded text. Both paths end
 * in a `ParsedFile`, so the committer does not care which format it came from.
 */
export async function parseFile(sourcePath: string): Promise<ParseResult> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(sourcePath));
  } catch (cause) {
    throw new ServiceError(
      'IO_ERROR',
      `"${basename(sourcePath)}" could not be read.`,
      cause instanceof Error ? cause.message : String(cause),
    );
  }

  if (bytes.byteLength > MAX_BYTES) {
    throw new ServiceError(
      'INVALID_REQUEST',
      `"${basename(sourcePath)}" is larger than the ${Math.round(MAX_BYTES / 1024 / 1024)} MB import limit.`,
    );
  }

  const detection = detectFormat(sourcePath, bytes);

  if (detection.kind === 'unsupported') {
    // Named and explained, never accepted and failed opaquely later.
    throw new ServiceError('INVALID_REQUEST', detection.reason);
  }
  if (detection.kind === 'unknown') {
    throw new ServiceError('INVALID_REQUEST', detection.reason);
  }

  const file = await readByFormat(detection.format, bytes, sourcePath);

  if (!detection.byExtension) {
    file.warnings.push(
      `The extension of "${basename(sourcePath)}" does not match its contents; it was read as ${detection.format.toUpperCase()}.`,
    );
  }

  return { sourcePath, file };
}

async function readByFormat(
  format: ImportFormat,
  bytes: Uint8Array,
  sourcePath: string,
): Promise<ParsedFile> {
  switch (format) {
    case 'gpx':
      return readGpx(decodeText(bytes), sourcePath);
    case 'kml':
      return readKml(decodeText(bytes), sourcePath);
    case 'kmz':
      return readKmz(bytes, sourcePath);
    case 'tcx':
      return readTcx(decodeText(bytes), sourcePath);
    case 'fit':
      return readFit(bytes, sourcePath);
    case 'csv':
      return readCsv(decodeText(bytes), sourcePath);
    case 'json': {
      // A collection is not a list of candidate objects to pick from; it is a
      // whole library. It is validated here so the preview can report its
      // counts, and committed by its own path.
      const collection = parseCollection(decodeText(bytes));
      const file = emptyParsedFile('json', basename(sourcePath));
      file.warnings.push(
        `This is a TrailRT collection export containing ${collection.trips.length} trip${collection.trips.length === 1 ? '' : 's'}. Importing it adds all of them as new trips.`,
      );
      return file;
    }
  }
}

// ----------------------------------------------------------------- preview

export interface FilePreview {
  sourcePath: string;
  sourceName: string;
  format: ImportFormat;
  counts: {
    routes: number;
    tracks: number;
    waypoints: number;
    points: number;
  };
  routeNames: string[];
  trackNames: string[];
  waypointNames: string[];
  skipped: ParsedFile['skipped'];
  warnings: string[];
  unmappedMetadata: string[];
}

export function previewOf(result: ParseResult): FilePreview {
  const { file } = result;
  return {
    sourcePath: result.sourcePath,
    sourceName: file.sourceName,
    format: file.format,
    counts: {
      routes: file.routes.length,
      tracks: file.tracks.length,
      waypoints: file.waypoints.length,
      points: parsedPointCount(file),
    },
    routeNames: file.routes.map((r) => r.name),
    trackNames: file.tracks.map((t) => t.name),
    waypointNames: file.waypoints.map((w) => w.name),
    skipped: file.skipped,
    warnings: file.warnings,
    unmappedMetadata: file.unmappedMetadata,
  };
}

// ------------------------------------------------------------------ commit

export interface CommitSelection {
  /** Null means "create a trip named after the file". */
  destinationTripId: string | null;
  /** Indices into the parsed arrays. Omitted means everything. */
  routeIndices?: readonly number[];
  trackIndices?: readonly number[];
  waypointIndices?: readonly number[];
}

export interface CommitOptions {
  /** Retained alongside each imported track, so the original is recoverable. */
  originalBytes?: Uint8Array;
  onProgress?: (progress: ImportProgress) => void;
  fileIndex?: number;
  fileCount?: number;
}

function pick<T>(items: readonly T[], indices: readonly number[] | undefined): T[] {
  if (indices === undefined) return [...items];
  const wanted = new Set(indices);
  return items.filter((_, index) => wanted.has(index));
}

/** A trip named after the file, used when the user picks no destination. */
function tripNameFor(sourceName: string): string {
  const withoutExtension = sourceName.slice(
    0,
    sourceName.length - extname(sourceName).length,
  );
  const trimmed = withoutExtension.trim();
  return trimmed.length === 0 ? sourceName : trimmed;
}

/**
 * Writes one parsed file.
 *
 * Everything — the trip, the geometry and the history record's completion —
 * happens in a single transaction. A failure anywhere rolls the whole file
 * back, including an auto-created trip, so a half-imported trip cannot exist.
 */
export function commitFile(
  db: Db,
  result: ParseResult,
  selection: CommitSelection,
  options: CommitOptions = {},
): ImportReport {
  const { file } = result;
  const startedAt = Date.now();

  const historyId = historyRepo.begin(db, {
    sourceName: file.sourceName,
    sourceFormat: file.format,
    startedAt,
  });

  const routes = pick(file.routes, selection.routeIndices);
  const tracks = pick(file.tracks, selection.trackIndices);
  const waypoints = pick(file.waypoints, selection.waypointIndices);

  const deselected =
    file.routes.length -
    routes.length +
    (file.tracks.length - tracks.length) +
    (file.waypoints.length - waypoints.length);

  const report: ImportReport = {
    sourceName: file.sourceName,
    format: file.format,
    status: 'success',
    imported: { routes: 0, tracks: 0, waypoints: 0, points: 0 },
    skipped: [...file.skipped],
    warnings: [...file.warnings],
    unmappedMetadata: [...file.unmappedMetadata],
    destinationTripId: null,
    destinationTripName: null,
  };

  if (deselected > 0) {
    report.warnings.push(
      `${deselected} object${deselected === 1 ? '' : 's'} in the file ${deselected === 1 ? 'was' : 'were'} not selected and ${deselected === 1 ? 'was' : 'were'} not imported.`,
    );
  }

  const totalPoints =
    routes.reduce((sum, r) => sum + r.points.length, 0) +
    tracks.reduce(
      (sum, t) => sum + t.segments.reduce((s, seg) => s + seg.points.length, 0),
      0,
    ) +
    waypoints.length;

  let written = 0;
  const reportProgress = (): void => {
    options.onProgress?.({
      sourceName: file.sourceName,
      fileIndex: options.fileIndex ?? 0,
      fileCount: options.fileCount ?? 1,
      pointsWritten: written,
      pointsTotal: totalPoints,
    });
  };

  try {
    db.transaction(() => {
      const tripId =
        selection.destinationTripId ??
        tripRepo.insertTrip(db, {
          folderId: null,
          name: tripNameFor(file.sourceName),
          description: null,
          notes: `Imported from ${file.sourceName}.`,
          now: startedAt,
          id: randomUUID(),
        }).id;

      const trip = tripRepo.findTrip(db, tripId);
      if (trip === null) {
        throw new ServiceError(
          'NOT_FOUND',
          'The destination trip no longer exists.',
        );
      }

      for (const route of routes) {
        routeService.create(db, {
          tripId,
          name: route.name,
          colour: null,
          points: route.points,
          source: 'import',
          metadata: route.metadata,
        });
        report.imported.routes += 1;
        written += route.points.length;
        if (written % PROGRESS_POINT_INTERVAL < route.points.length) {
          reportProgress();
        }
      }

      for (const track of tracks) {
        trackService.createFromParsed(db, {
          tripId,
          parsed: track,
          source: 'import',
          ...(options.originalBytes === undefined
            ? {}
            : {
                originalBytes: options.originalBytes,
                originalFormat: file.format,
              }),
        });
        report.imported.tracks += 1;
        const points = track.segments.reduce(
          (sum, segment) => sum + segment.points.length,
          0,
        );
        written += points;
        if (written % PROGRESS_POINT_INTERVAL < points) reportProgress();
      }

      for (const waypoint of waypoints) {
        waypointService.create(db, {
          tripId,
          groupId: null,
          name: waypoint.name,
          lat: waypoint.lat,
          lon: waypoint.lon,
          eleM: waypoint.ele,
          description: waypoint.description,
          // The source's own symbol name, written back verbatim on export.
          symbol: waypoint.symbol ?? '',
          notes: waypoint.notes,
          source: 'import',
          metadata: waypoint.metadata,
        });
        report.imported.waypoints += 1;
        written += 1;
      }

      report.imported.points = written;
      report.destinationTripId = tripId;
      report.destinationTripName = trip.name;
      report.status =
        report.skipped.length > 0 ? 'partial' : 'success';

      historyRepo.finish(db, historyId, {
        status: report.status,
        report,
        destinationTripId: tripId,
        finishedAt: Date.now(),
      });

    });

    reportProgress();
    return report;
  } catch (cause) {
    // The import rolled back, so the history record must be completed outside
    // the failed transaction or it would roll back with everything else and
    // leave no evidence at all.
    const message =
      cause instanceof ParseError || cause instanceof ServiceError
        ? cause.message
        : cause instanceof Error
          ? cause.message
          : String(cause);

    const failed: ImportReport = {
      ...report,
      status: 'failed',
      imported: { routes: 0, tracks: 0, waypoints: 0, points: 0 },
      destinationTripId: null,
      destinationTripName: null,
      error: message,
    };

    historyRepo.finish(db, historyId, {
      status: 'failed',
      report: failed,
      destinationTripId: null,
      finishedAt: Date.now(),
    });

    return failed;
  }
}

/**
 * Commits a native collection file, which replaces the whole per-object flow.
 *
 * Kept separate rather than folded into `commitFile` because a collection is
 * not a set of objects to place in a trip — it brings its own trips, folders
 * and structure, and the destination chooser does not apply to it.
 */
export function commitCollection(
  db: Db,
  sourcePath: string,
  content: string,
  options: { nameSuffix?: string } = {},
): ImportReport {
  const sourceName = basename(sourcePath);
  const startedAt = Date.now();
  const historyId = historyRepo.begin(db, {
    sourceName,
    sourceFormat: 'json',
    startedAt,
  });

  try {
    const collection = parseCollection(content);
    const applied = applyCollection(db, collection, options);

    const report: ImportReport = {
      sourceName,
      format: 'json',
      status: 'success',
      imported: {
        routes: applied.counts.routes,
        tracks: applied.counts.tracks,
        waypoints: applied.counts.waypoints,
        points: applied.counts.points,
      },
      skipped: [],
      warnings: applied.warnings,
      unmappedMetadata: [],
      // A collection brings many trips, so there is no single destination to
      // name. Reported honestly as null rather than picking one arbitrarily.
      destinationTripId: null,
      destinationTripName: null,
    };

    historyRepo.finish(db, historyId, {
      status: 'success',
      report,
      destinationTripId: null,
      finishedAt: Date.now(),
    });

    return report;
  } catch (cause) {
    const failed: ImportReport = {
      sourceName,
      format: 'json',
      status: 'failed',
      imported: { routes: 0, tracks: 0, waypoints: 0, points: 0 },
      skipped: [],
      warnings: [],
      unmappedMetadata: [],
      destinationTripId: null,
      destinationTripName: null,
      error: cause instanceof Error ? cause.message : String(cause),
    };

    historyRepo.finish(db, historyId, {
      status: 'failed',
      report: failed,
      destinationTripId: null,
      finishedAt: Date.now(),
    });

    return failed;
  }
}

// -------------------------------------------------------------- multi-file

export interface ImportRunResult {
  reports: ImportReport[];
  /** True when every file succeeded. */
  allSucceeded: boolean;
}

/**
 * Imports several files.
 *
 * One transaction **per file**, not one for the batch: a user importing twenty
 * tracks should not lose nineteen because the twentieth was corrupt. Each file
 * reports its own outcome, and the dialog shows the set.
 */
export async function importFiles(
  db: Db,
  requests: readonly {
    sourcePath: string;
    destinationTripId: string | null;
    routeIndices?: readonly number[];
    trackIndices?: readonly number[];
    waypointIndices?: readonly number[];
    /** Retain the file bytes with imported tracks. On by default. */
    retainOriginal?: boolean;
  }[],
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportRunResult> {
  const reports: ImportReport[] = [];

  for (const [fileIndex, request] of requests.entries()) {
    try {
      // Sequential on purpose: parsing a 22 MB GPX while writing another to
      // the same SQLite connection would contend for the write lock and make
      // progress reporting meaningless.
      const parsed = await parseFile(request.sourcePath);

      if (parsed.file.format === 'json') {
        const bytes = await readFile(request.sourcePath);
        reports.push(
          commitCollection(db, request.sourcePath, decodeText(new Uint8Array(bytes))),
        );
        continue;
      }

      const retain = request.retainOriginal ?? true;
      const originalBytes = retain
        ? new Uint8Array(await readFile(request.sourcePath))
        : undefined;

      reports.push(
        commitFile(
          db,
          parsed,
          {
            destinationTripId: request.destinationTripId,
            ...(request.routeIndices === undefined
              ? {}
              : { routeIndices: request.routeIndices }),
            ...(request.trackIndices === undefined
              ? {}
              : { trackIndices: request.trackIndices }),
            ...(request.waypointIndices === undefined
              ? {}
              : { waypointIndices: request.waypointIndices }),
          },
          {
            ...(originalBytes === undefined ? {} : { originalBytes }),
            ...(onProgress === undefined ? {} : { onProgress }),
            fileIndex,
            fileCount: requests.length,
          },
        ),
      );
    } catch (cause) {
      // A file that cannot even be parsed still gets a record and a report, so
      // the user is told why rather than seeing it vanish.
      const sourceName = basename(request.sourcePath);
      const message =
        cause instanceof Error ? cause.message : String(cause);
      const detail =
        cause instanceof ParseError && cause.detail !== undefined
          ? cause.detail
          : undefined;

      const historyId = historyRepo.begin(db, {
        sourceName,
        sourceFormat: extname(request.sourcePath).replace('.', '') || 'unknown',
        startedAt: Date.now(),
      });

      const failed: ImportReport = {
        sourceName,
        format: 'gpx',
        status: 'failed',
        imported: { routes: 0, tracks: 0, waypoints: 0, points: 0 },
        skipped: [],
        warnings: [],
        unmappedMetadata: [],
        destinationTripId: null,
        destinationTripName: null,
        error: detail === undefined ? message : `${message} (${detail})`,
      };

      historyRepo.finish(db, historyId, {
        status: 'failed',
        report: failed,
        destinationTripId: null,
        finishedAt: Date.now(),
      });

      reports.push(failed);
    }
  }

  return {
    reports,
    allSucceeded: reports.every((report) => report.status !== 'failed'),
  };
}

export function listHistory(db: Db, limit?: number) {
  return historyRepo.list(db, limit);
}
