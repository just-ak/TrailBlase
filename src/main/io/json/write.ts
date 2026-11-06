import {
  COLLECTION_FORMAT,
  COLLECTION_VERSION,
  type Collection,
  type CollectionFolder,
  type CollectionTrip,
} from '@shared/io/collection';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { decodeMetadata } from '../../db/metadata';
import { routes, tracks, trips, waypoints } from '../../db/schema';
import * as folderRepo from '../../db/repositories/folders';
import * as routeRepo from '../../db/repositories/routes';
import * as trackRepo from '../../db/repositories/tracks';
import * as tripRepo from '../../db/repositories/trips';
import * as waypointRepo from '../../db/repositories/waypoints';

/**
 * Native JSON collection writer.
 *
 * Reads through the repositories rather than the services, because this is a
 * verbatim dump: no statistics, no undo entries, no side effects. Derived
 * columns are deliberately not written — see `shared/io/collection.ts`.
 *
 * `metadata` is stored as a JSON string in SQLite and emitted as a real object
 * here, so the document is readable and a round trip does not double-encode
 * it. A column holding unparseable JSON is dropped with the rest of the object
 * intact rather than failing the whole export; that is the only lossy path and
 * it only triggers on data we did not write.
 */

/**
 * Reads the raw `metadata` column, which the repositories do not expose.
 *
 * Takes a typed Drizzle table rather than a table name, so there is no SQL
 * string built from a parameter here.
 */
function metadataFor(
  db: Db,
  table: typeof trips | typeof routes | typeof tracks | typeof waypoints,
  id: string,
): Record<string, unknown> {
  const row = db
    .select({ metadata: table.metadata })
    .from(table)
    .where(eq(table.id, id))
    .get();
  return decodeMetadata(row?.metadata);
}

function tripToCollection(db: Db, tripId: string): CollectionTrip {
  const trip = tripRepo.findTrip(db, tripId);
  if (trip === null) {
    throw new Error(`Trip ${tripId} disappeared during export.`);
  }

  return {
    id: trip.id,
    folderId: trip.folderId,
    name: trip.name,
    description: trip.description,
    notes: trip.notes,
    status: trip.status,
    createdAt: trip.createdAt,
    updatedAt: trip.updatedAt,
    metadata: metadataFor(db, trips, trip.id),

    waypointGroups: waypointRepo.listGroups(db, trip.id).map((group) => ({
      id: group.id,
      name: group.name,
      createdAt: group.createdAt,
    })),

    routes: routeRepo.listRoutesForTrip(db, trip.id).map((route) => ({
      id: route.id,
      name: route.name,
      colour: route.colour,
      source: route.source,
      createdAt: route.createdAt,
      updatedAt: route.updatedAt,
      metadata: metadataFor(db, routes, route.id),
      points: routeRepo.listPoints(db, route.id),
    })),

    tracks: trackRepo.listTracksForTrip(db, trip.id).map((track) => {
      // Points come back flat with their segment index; regroup rather than
      // issuing one query per segment.
      const segments: { points: { lat: number; lon: number; ele: number | null; time: number | null }[] }[] = [];
      for (const point of trackRepo.listTrackPoints(db, track.id)) {
        let segment = segments[point.segmentIndex];
        if (segment === undefined) {
          segment = { points: [] };
          segments[point.segmentIndex] = segment;
        }
        segment.points.push({
          lat: point.lat,
          lon: point.lon,
          ele: point.eleM,
          time: point.recordedAt,
        });
      }

      return {
        id: track.id,
        name: track.name,
        colour: track.colour,
        width: track.width,
        source: track.source,
        createdAt: track.createdAt,
        updatedAt: track.updatedAt,
        metadata: metadataFor(db, tracks, track.id),
        segments: segments.filter((s) => s !== undefined),
      };
    }),

    waypoints: waypointRepo.listWaypointsForTrip(db, trip.id).map((waypoint) => ({
      id: waypoint.id,
      groupId: waypoint.groupId,
      name: waypoint.name,
      lat: waypoint.lat,
      lon: waypoint.lon,
      eleM: waypoint.eleM,
      description: waypoint.description,
      symbol: waypoint.symbol,
      notes: waypoint.notes,
      source: waypoint.source,
      createdAt: waypoint.createdAt,
      updatedAt: waypoint.updatedAt,
      metadata: metadataFor(db, waypoints, waypoint.id),
    })),
  };
}

export interface BuildCollectionOptions {
  /** Specific trips, or every trip when omitted. */
  tripIds?: readonly string[];
  /** Archived trips are included by default; this is a data export. */
  includeArchived?: boolean;
  appVersion?: string;
  now?: number;
}

export function buildCollection(
  db: Db,
  options: BuildCollectionOptions = {},
): Collection {
  const includeArchived = options.includeArchived ?? true;

  const tripIds =
    options.tripIds ??
    tripRepo
      .listTrips(db, {
        includeArchived,
        sortKey: 'createdAt',
        sortDirection: 'asc',
      })
      .map((trip) => trip.id);

  // Not `trips`: that name belongs to the Drizzle table imported above.
  const exported = tripIds.map((id) => tripToCollection(db, id));

  // Only folders that are reachable from an exported trip, plus their
  // ancestors. Exporting the whole folder tree alongside a single trip would
  // import a pile of empty folders on the other side.
  const allFolders = folderRepo.listFolders(db);
  const byId = new Map(allFolders.map((folder) => [folder.id, folder]));
  const needed = new Set<string>();

  const includeAncestors = (folderId: string | null): void => {
    let current = folderId;
    while (current !== null && !needed.has(current)) {
      const folder = byId.get(current);
      if (folder === undefined) return;
      needed.add(folder.id);
      current = folder.parentId;
    }
  };

  for (const trip of exported) includeAncestors(trip.folderId);

  return {
    format: COLLECTION_FORMAT,
    version: COLLECTION_VERSION,
    appVersion: options.appVersion ?? 'unknown',
    exportedAt: options.now ?? Date.now(),
    folders: orderParentsFirst(
      allFolders.filter((folder) => needed.has(folder.id)),
    ),
    trips: exported,
  };
}

/**
 * Orders folders so every parent precedes its children.
 *
 * `listFolders` sorts by sort order then name, which puts "Alps" before its
 * parent "Europe". An importer walking the array in order would then see a
 * parent reference it cannot resolve yet, so the ordering is a correctness
 * requirement of the format, not presentation.
 */
function orderParentsFirst(
  selected: readonly CollectionFolder[],
): CollectionFolder[] {
  const remaining = new Map(selected.map((folder) => [folder.id, folder]));
  const emitted = new Set<string>();
  const ordered: CollectionFolder[] = [];

  const emit = (folder: CollectionFolder): void => {
    if (emitted.has(folder.id)) return;
    const parentId = folder.parentId;
    if (parentId !== null) {
      const parent = remaining.get(parentId);
      // A parent outside the selection cannot be emitted; the importer treats
      // the dangling reference as a root placement and says so.
      if (parent !== undefined) emit(parent);
    }
    emitted.add(folder.id);
    ordered.push(folder);
  };

  for (const folder of selected) emit(folder);
  return ordered;
}

/**
 * Serialises a collection.
 *
 * Two-space indentation, because the point of this format over the SQLite
 * snapshot is that a human can open it. `JSON.stringify` writes numbers with
 * `String` semantics, so coordinate precision survives exactly.
 */
export function writeCollection(collection: Collection): string {
  return `${JSON.stringify(collection, null, 2)}\n`;
}
