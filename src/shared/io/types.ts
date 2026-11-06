import type { RoutePoint } from '../domain/types';

/**
 * The contract between the format parsers and the import pipeline.
 *
 * Every parser produces a `ParsedFile`: candidate objects plus an honest
 * account of what it could not represent. The import-fidelity rule in
 * `.kiro/steering/architecture.md` means `skipped` and `unmappedMetadata` are
 * part of the output, not logging — the user is told what happened to every
 * part of their file.
 */

export const IMPORT_FORMATS = [
  'gpx',
  'kml',
  'kmz',
  'tcx',
  'fit',
  'csv',
  'json',
] as const;

export type ImportFormat = (typeof IMPORT_FORMATS)[number];

/** Formats we can write. TCX and FIT are read-only by design — see the design. */
export const EXPORT_FORMATS = ['gpx', 'kml', 'kmz', 'csv', 'json'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Recognised but deliberately unsupported, reported rather than failing oddly. */
export const UNSUPPORTED_FORMATS = ['gdb', 'img'] as const;

export interface ParsedTrackPoint {
  lat: number;
  lon: number;
  /** Metres, or null when the source carried none. Never 0 as a stand-in. */
  ele: number | null;
  /** Epoch milliseconds, or null. */
  time: number | null;
}

export interface ParsedTrackSegment {
  points: ParsedTrackPoint[];
}

export interface ParsedTrack {
  name: string;
  segments: ParsedTrackSegment[];
  /** Fields with no column of their own, preserved verbatim. */
  metadata: Record<string, unknown>;
}

export interface ParsedRoute {
  name: string;
  points: RoutePoint[];
  metadata: Record<string, unknown>;
}

export interface ParsedWaypoint {
  name: string;
  lat: number;
  lon: number;
  ele: number | null;
  description: string | null;
  /** The source's own symbol name, kept as-is so export can write it back. */
  symbol: string | null;
  notes: string | null;
  time: number | null;
  metadata: Record<string, unknown>;
}

/** Something present in the file that was not imported, and why. */
export interface SkippedItem {
  kind: string;
  name: string;
  reason: string;
}

export interface ParsedFile {
  format: ImportFormat;
  /** Basename of the source, used to name an auto-created trip. */
  sourceName: string;
  routes: ParsedRoute[];
  tracks: ParsedTrack[];
  waypoints: ParsedWaypoint[];
  /** Present but not imported. Never silently dropped. */
  skipped: SkippedItem[];
  /** Imported, but something was unusual. */
  warnings: string[];
  /**
   * Fields with no column, preserved in `metadata` and listed here so the user
   * knows they survived and a later phase can round-trip them.
   */
  unmappedMetadata: string[];
}

export function emptyParsedFile(
  format: ImportFormat,
  sourceName: string,
): ParsedFile {
  return {
    format,
    sourceName,
    routes: [],
    tracks: [],
    waypoints: [],
    skipped: [],
    warnings: [],
    unmappedMetadata: [],
  };
}

export function parsedPointCount(file: ParsedFile): number {
  return (
    file.routes.reduce((sum, r) => sum + r.points.length, 0) +
    file.tracks.reduce(
      (sum, t) => sum + t.segments.reduce((s, seg) => s + seg.points.length, 0),
      0,
    ) +
    file.waypoints.length
  );
}

/** What the user chose to import from a previewed file. */
export interface ImportSelection {
  sourcePath: string;
  /** Null means "create a trip named after the file". */
  destinationTripId: string | null;
  routeIndices: number[];
  trackIndices: number[];
  waypointIndices: number[];
}

export interface ImportReport {
  sourceName: string;
  format: ImportFormat;
  status: 'success' | 'partial' | 'failed';
  imported: {
    routes: number;
    tracks: number;
    waypoints: number;
    points: number;
  };
  skipped: SkippedItem[];
  warnings: string[];
  unmappedMetadata: string[];
  destinationTripId: string | null;
  destinationTripName: string | null;
  /** Present when the whole file failed. */
  error?: string;
}

export interface ImportHistoryEntry {
  id: string;
  sourceName: string;
  sourceFormat: string;
  status: 'success' | 'partial' | 'failed';
  report: ImportReport;
  startedAt: number;
  finishedAt: number | null;
  destinationTripId: string | null;
}

/** Progress pushed to the renderer during a large import. */
export interface ImportProgress {
  sourceName: string;
  fileIndex: number;
  fileCount: number;
  pointsWritten: number;
  pointsTotal: number;
}

export class ParseError extends Error {
  readonly format: string;
  readonly detail: string | undefined;

  constructor(format: string, message: string, detail?: string) {
    super(message);
    this.name = 'ParseError';
    this.format = format;
    this.detail = detail;
  }
}
