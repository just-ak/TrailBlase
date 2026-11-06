import { EXPORT_FORMATS, type ExportFormat } from '@shared/io/types';
import type { Db } from '../db/client';
import * as tripRepo from '../db/repositories/trips';
import { ServiceError } from '../services/errors';
import * as routeService from '../services/routeService';
import * as trackService from '../services/trackService';
import * as waypointService from '../services/waypointService';
import { writeCsv } from './csv/write';
import { writeGpx } from './gpx/write';
import { routeToKmlPath, writeKml, type KmlPathInput } from './kml/write';
import { writeKmz } from './kmz/write';
import { buildCollection, writeCollection } from './json/write';

/**
 * Export.
 *
 * ## TCX and FIT are not writable, on purpose
 *
 * Both formats are built around a recording device: session summaries, lap
 * triggers, device identifiers, sport classifications. TrailRT holds none of
 * that, so writing one would mean inventing it. A file that claims to be a
 * Garmin activity and is not would be worse than the absence of the option, so
 * the option is absent and `explainFormat` says why if the user asks.
 *
 * ## Losses are named before the write, not after
 *
 * `planExport` reports what a given scope-and-format combination cannot carry
 * — "CSV holds waypoints only; 3 routes and 1 track will not be written" — and
 * the dialog shows that before anything touches the disk. Writing silently and
 * letting the user discover the gap later is the behaviour the honesty rule in
 * `.kiro/steering/architecture.md` exists to prevent.
 */

export type ExportScope =
  | { kind: 'route'; id: string }
  | { kind: 'track'; id: string }
  | { kind: 'waypoint'; id: string }
  | { kind: 'trips'; tripIds: readonly string[] }
  | { kind: 'everything' };

/** What each writable format can carry. */
interface FormatCapability {
  routes: boolean;
  tracks: boolean;
  waypoints: boolean;
  /** Binary output rather than text. */
  binary: boolean;
  extension: string;
  label: string;
}

const CAPABILITIES: Record<ExportFormat, FormatCapability> = {
  gpx: {
    routes: true,
    tracks: true,
    waypoints: true,
    binary: false,
    extension: 'gpx',
    label: 'GPX',
  },
  kml: {
    routes: true,
    tracks: true,
    waypoints: true,
    binary: false,
    extension: 'kml',
    label: 'KML',
  },
  kmz: {
    routes: true,
    tracks: true,
    waypoints: true,
    binary: true,
    extension: 'kmz',
    label: 'KMZ',
  },
  csv: {
    routes: false,
    tracks: false,
    waypoints: true,
    binary: false,
    extension: 'csv',
    label: 'CSV',
  },
  json: {
    routes: true,
    tracks: true,
    waypoints: true,
    binary: false,
    extension: 'json',
    label: 'TrailRT collection',
  },
};

/** The reason a format is read-only, for the dialog rather than a tooltip. */
const READ_ONLY_REASONS: Record<string, string> = {
  tcx: 'TCX describes a recorded activity: laps, device and session summaries that TrailRT does not hold. Writing one would mean inventing that data, so TrailRT reads TCX but does not write it. Export as GPX instead.',
  fit: 'FIT is a device recording format with required device and session messages TrailRT does not hold. TrailRT reads FIT but does not write it. Export as GPX instead.',
  gdb: 'Garmin GDB is a proprietary binary format with no open writer. Export as GPX, which BaseCamp reads.',
};

export function explainFormat(format: string): string | null {
  return READ_ONLY_REASONS[format.toLowerCase()] ?? null;
}

export function isWritable(format: string): format is ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(format.toLowerCase());
}

// --------------------------------------------------------------- gathering

interface Gathered {
  routes: ReturnType<typeof routeService.get>[];
  tracks: ReturnType<typeof trackService.get>[];
  waypoints: ReturnType<typeof waypointService.get>[];
  tripIds: string[];
  /** Document-level name: a single trip's name, or a count. */
  name: string;
}

function gather(db: Db, scope: ExportScope): Gathered {
  switch (scope.kind) {
    case 'route': {
      const route = routeService.get(db, scope.id);
      return {
        routes: [route],
        tracks: [],
        waypoints: [],
        tripIds: [route.tripId],
        name: route.name,
      };
    }
    case 'track': {
      const track = trackService.get(db, scope.id);
      return {
        routes: [],
        tracks: [track],
        waypoints: [],
        tripIds: [track.tripId],
        name: track.name,
      };
    }
    case 'waypoint': {
      const waypoint = waypointService.get(db, scope.id);
      return {
        routes: [],
        tracks: [],
        waypoints: [waypoint],
        tripIds: [waypoint.tripId],
        name: waypoint.name,
      };
    }
    case 'trips':
    case 'everything': {
      const tripIds =
        scope.kind === 'everything'
          ? tripRepo
              .listTrips(db, {
                includeArchived: true,
                sortKey: 'name',
                sortDirection: 'asc',
              })
              .map((trip) => trip.id)
          : [...scope.tripIds];

      if (tripIds.length === 0) {
        throw new ServiceError(
          'INVALID_REQUEST',
          'There is nothing to export.',
        );
      }

      const gathered: Gathered = {
        routes: [],
        tracks: [],
        waypoints: [],
        tripIds,
        name: '',
      };

      for (const tripId of tripIds) {
        const trip = tripRepo.findTrip(db, tripId);
        if (trip === null) {
          throw new ServiceError('NOT_FOUND', 'That trip no longer exists.');
        }
        for (const route of routeService.listForTrip(db, tripId)) {
          gathered.routes.push(routeService.get(db, route.id));
        }
        for (const track of trackService.listForTrip(db, tripId)) {
          gathered.tracks.push(trackService.get(db, track.id));
        }
        gathered.waypoints.push(...waypointService.listForTrip(db, tripId));
      }

      const first = tripRepo.findTrip(db, tripIds[0] as string);
      gathered.name =
        tripIds.length === 1
          ? (first?.name ?? 'Export')
          : `${tripIds.length} trips`;

      return gathered;
    }
  }
}

// ------------------------------------------------------------------- plan

export interface ExportPlan {
  format: ExportFormat;
  extension: string;
  /** A filename stem, with no extension and no path. */
  suggestedName: string;
  willWrite: { routes: number; tracks: number; waypoints: number };
  /** Objects the format cannot carry at all. */
  omitted: { routes: number; tracks: number; waypoints: number };
  /** What is written but altered, each naming the specific loss. */
  losses: string[];
  /** True when the format cannot carry anything in this scope. */
  empty: boolean;
}

/** Characters that are either path syntax or reserved on some filesystem. */
const UNSAFE_FILENAME_CHARS = new Set('<>:"/\\|?*');

/**
 * A filename stem from an object or trip name.
 *
 * Control characters are filtered by code point rather than by a regex range:
 * a `\u0000-\u001F` class trips the linter, and an explicit comparison makes
 * the intent — strip anything a filesystem or shell could misread — plainer
 * than the escape sequence did.
 */
function safeFileStem(name: string): string {
  const cleaned = [...name]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      if (code < 0x20 || code === 0x7f) return '-';
      return UNSAFE_FILENAME_CHARS.has(char) ? '-' : char;
    })
    .join('')
    .replaceAll(/\s+/g, ' ')
    .trim()
    // A leading dot would make the export a hidden file.
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim();

  return cleaned.length === 0 ? 'export' : cleaned;
}

export function planExport(
  db: Db,
  scope: ExportScope,
  format: ExportFormat,
): ExportPlan {
  const capability = CAPABILITIES[format];
  const gathered = gather(db, scope);

  const willWrite = {
    routes: capability.routes ? gathered.routes.length : 0,
    tracks: capability.tracks ? gathered.tracks.length : 0,
    waypoints: capability.waypoints ? gathered.waypoints.length : 0,
  };
  const omitted = {
    routes: capability.routes ? 0 : gathered.routes.length,
    tracks: capability.tracks ? 0 : gathered.tracks.length,
    waypoints: capability.waypoints ? 0 : gathered.waypoints.length,
  };

  const losses: string[] = [];

  if (omitted.routes > 0 || omitted.tracks > 0) {
    const parts: string[] = [];
    if (omitted.routes > 0) {
      parts.push(`${omitted.routes} route${omitted.routes === 1 ? '' : 's'}`);
    }
    if (omitted.tracks > 0) {
      parts.push(`${omitted.tracks} track${omitted.tracks === 1 ? '' : 's'}`);
    }
    losses.push(
      `${capability.label} holds waypoints only. ${parts.join(' and ')} will not be written.`,
    );
  }

  if (format === 'kml' || format === 'kmz') {
    // KML has one path type with no per-vertex attributes, so a route's point
    // names and symbols have nowhere to go.
    const annotated = gathered.routes.filter((route) =>
      route.points.some(
        (point) =>
          point.name !== null || point.symbol !== null || point.notes !== null,
      ),
    ).length;
    if (annotated > 0) {
      losses.push(
        `KML paths carry no per-point attributes, so names, symbols and notes on the points of ${annotated} route${annotated === 1 ? '' : 's'} will be lost. GPX keeps them.`,
      );
    }

    const timed = gathered.tracks.filter((track) =>
      track.segments.some((segment) =>
        segment.points.some((point) => point.time !== null),
      ),
    ).length;
    if (timed > 0) {
      losses.push(
        `KML LineStrings carry no timestamps, so the recorded times on ${timed} track${timed === 1 ? '' : 's'} will be lost. GPX keeps them.`,
      );
    }

    if (willWrite.waypoints > 0) {
      losses.push(
        'KML has no Garmin symbol vocabulary, so waypoint symbols are not written.',
      );
    }
  }

  if (format === 'csv' && willWrite.waypoints > 0) {
    losses.push(
      'CSV carries no waypoint grouping; every waypoint is written as a flat row.',
    );
  }

  if (format === 'json') {
    losses.push(
      'A TrailRT collection is only read by TrailRT. Use GPX for other applications.',
    );
    if (scope.kind === 'route' || scope.kind === 'track' || scope.kind === 'waypoint') {
      losses.push(
        'A collection export covers whole trips, so the trip containing this object is written in full.',
      );
    }
  }

  const empty =
    willWrite.routes === 0 &&
    willWrite.tracks === 0 &&
    willWrite.waypoints === 0;

  return {
    format,
    extension: capability.extension,
    suggestedName: safeFileStem(gathered.name),
    willWrite,
    omitted,
    losses,
    empty,
  };
}

// ------------------------------------------------------------------ write

export interface ExportResult {
  plan: ExportPlan;
  /** Text output. Present for every format except KMZ. */
  text?: string;
  /** Binary output. Present for KMZ only. */
  bytes?: Uint8Array;
}

/** Tracks and routes alike become KML paths; KML has one path type. */
function toKmlPaths(gathered: Gathered): KmlPathInput[] {
  return [
    ...gathered.routes.map((route) => routeToKmlPath(route.name, route.points)),
    ...gathered.tracks.map((track) => ({
      name: track.name,
      segments: track.segments,
    })),
  ];
}

export async function exportScope(
  db: Db,
  scope: ExportScope,
  format: ExportFormat,
): Promise<ExportResult> {
  if (!isWritable(format)) {
    const reason = explainFormat(format);
    throw new ServiceError(
      'INVALID_REQUEST',
      reason ?? `TrailRT cannot write ${String(format).toUpperCase()}.`,
    );
  }

  const plan = planExport(db, scope, format);
  const gathered = gather(db, scope);

  switch (format) {
    case 'gpx':
      return {
        plan,
        text: writeGpx({
          name: gathered.name,
          waypoints: gathered.waypoints.map((waypoint) => ({
            name: waypoint.name,
            lat: waypoint.lat,
            lon: waypoint.lon,
            eleM: waypoint.eleM,
            description: waypoint.description,
            symbol: waypoint.symbol,
            notes: waypoint.notes,
          })),
          routes: gathered.routes.map((route) => ({
            name: route.name,
            points: route.points,
          })),
          tracks: gathered.tracks.map((track) => ({
            name: track.name,
            segments: track.segments,
          })),
        }),
      };

    case 'kml':
      return {
        plan,
        text: writeKml({
          name: gathered.name,
          waypoints: gathered.waypoints.map((waypoint) => ({
            name: waypoint.name,
            lat: waypoint.lat,
            lon: waypoint.lon,
            eleM: waypoint.eleM,
            description: waypoint.description,
          })),
          paths: toKmlPaths(gathered),
        }),
      };

    case 'kmz':
      return {
        plan,
        bytes: await writeKmz({
          name: gathered.name,
          waypoints: gathered.waypoints.map((waypoint) => ({
            name: waypoint.name,
            lat: waypoint.lat,
            lon: waypoint.lon,
            eleM: waypoint.eleM,
            description: waypoint.description,
          })),
          paths: toKmlPaths(gathered),
        }),
      };

    case 'csv':
      return {
        plan,
        text: writeCsv(
          gathered.waypoints.map((waypoint) => ({
            name: waypoint.name,
            lat: waypoint.lat,
            lon: waypoint.lon,
            eleM: waypoint.eleM,
            description: waypoint.description,
            symbol: waypoint.symbol,
          })),
        ),
      };

    case 'json':
      return {
        plan,
        text: writeCollection(
          buildCollection(db, { tripIds: gathered.tripIds }),
        ),
      };
  }
}

/** The formats offered for a scope, with the losses each would incur. */
export function formatOptions(
  db: Db,
  scope: ExportScope,
): (ExportPlan & { label: string })[] {
  return EXPORT_FORMATS.map((format) => ({
    ...planExport(db, scope, format),
    label: CAPABILITIES[format].label,
  }));
}
