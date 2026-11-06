import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  COLLECTION_FORMAT,
  COLLECTION_VERSION,
  collectionSchema,
  countCollection,
  type Collection,
  type CollectionCounts,
} from '@shared/io/collection';
import { ParseError } from '@shared/io/types';
import type { Db } from '../../db/client';
import { folders } from '../../db/schema';
import * as folderRepo from '../../db/repositories/folders';
import * as trackRepo from '../../db/repositories/tracks';
import * as tripRepo from '../../db/repositories/trips';
import * as waypointRepo from '../../db/repositories/waypoints';
import * as routeService from '../../services/routeService';
import * as trackService from '../../services/trackService';

/**
 * Native JSON collection reader.
 *
 * ## Identifiers are remapped, not reused
 *
 * Every imported object gets a fresh UUID, and internal references are
 * rewritten consistently. This makes import a **merge**: bringing a collection
 * onto a machine that already has data cannot overwrite an existing object
 * that happens to share an id, and importing the same file twice gives two
 * copies rather than a silent half-overwrite.
 *
 * The alternative — honouring the stored ids — would make the operation a
 * partial restore with no warning about what it replaced. If a user wants an
 * exact restore, the SQLite snapshot in `backupService` is the tool for that,
 * and it says plainly that it replaces everything.
 *
 * ## Everything or nothing
 *
 * The whole apply runs in one transaction. A collection that fails halfway
 * leaves no folders, no trips and no orphaned geometry.
 */

export interface ApplyCollectionResult {
  counts: CollectionCounts;
  /** Imported id keyed by the id in the file, for reporting and tests. */
  tripIds: Record<string, string>;
  folderIds: Record<string, string>;
  warnings: string[];
}

export function parseCollection(content: string): Collection {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (cause) {
    throw new ParseError(
      'json',
      'This file is not valid JSON, so it cannot be a TrailRT collection.',
      cause instanceof Error ? cause.message : String(cause),
    );
  }

  // The envelope is checked before the schema so the error names the real
  // problem: "this is a different kind of JSON" rather than a list of missing
  // fields.
  const envelope = raw as { format?: unknown; version?: unknown };

  if (envelope.format !== COLLECTION_FORMAT) {
    throw new ParseError(
      'json',
      'This JSON file is not a TrailRT collection export.',
      `Expected format "${COLLECTION_FORMAT}", found ${JSON.stringify(envelope.format) ?? 'nothing'}.`,
    );
  }

  if (
    typeof envelope.version === 'number' &&
    envelope.version > COLLECTION_VERSION
  ) {
    throw new ParseError(
      'json',
      `This collection was written by a newer version of TrailRT (format version ${envelope.version}; this build understands ${COLLECTION_VERSION}). Update the app before importing it.`,
    );
  }

  const parsed = collectionSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ParseError(
      'json',
      'This collection file is not in a shape TrailRT can read.',
      first === undefined
        ? undefined
        : `${first.path.join('.') || '(root)'}: ${first.message}`,
    );
  }

  return parsed.data;
}

export interface ApplyCollectionOptions {
  /**
   * Suffix appended to every imported trip name, so a merge is visible in the
   * library rather than producing indistinguishable duplicates.
   */
  nameSuffix?: string;
}

export function applyCollection(
  db: Db,
  collection: Collection,
  options: ApplyCollectionOptions = {},
): ApplyCollectionResult {
  const folderIds: Record<string, string> = {};
  const tripIds: Record<string, string> = {};
  const warnings: string[] = [];

  db.transaction(() => {
    const now = Date.now();

    // Folders first, in document order. `buildCollection` emits ancestors
    // before descendants, but a hand-edited file might not, so an unresolved
    // parent falls back to the root with a warning instead of failing.
    for (const folder of collection.folders) {
      const parentId =
        folder.parentId === null ? null : folderIds[folder.parentId] ?? null;

      if (folder.parentId !== null && parentId === null) {
        warnings.push(
          `Folder "${folder.name}" referenced a parent that was not in the file; it was placed at the top level.`,
        );
      }

      const created = folderRepo.insertFolder(db, {
        id: randomUUID(),
        parentId,
        name: folder.name,
        now,
      });
      folderIds[folder.id] = created.id;

      // `insertFolder` has no sortOrder parameter — nothing in the app sets it
      // yet — so the stored order is applied directly rather than widening the
      // repository for one caller.
      if (folder.sortOrder !== 0) {
        db.update(folders)
          .set({ sortOrder: folder.sortOrder })
          .where(eq(folders.id, created.id))
          .run();
      }
    }

    for (const trip of collection.trips) {
      const folderId =
        trip.folderId === null ? null : folderIds[trip.folderId] ?? null;

      if (trip.folderId !== null && folderId === null) {
        warnings.push(
          `Trip "${trip.name}" referenced a folder that was not in the file; it was placed at the top level.`,
        );
      }

      const inserted = tripRepo.insertTrip(db, {
        id: randomUUID(),
        folderId,
        name:
          options.nameSuffix === undefined
            ? trip.name
            : `${trip.name}${options.nameSuffix}`,
        description: trip.description,
        notes: trip.notes,
        status: trip.status,
        metadata: trip.metadata,
        now,
      });
      tripIds[trip.id] = inserted.id;

      const groupIds: Record<string, string> = {};
      for (const group of trip.waypointGroups) {
        groupIds[group.id] = waypointRepo.insertGroup(db, {
          id: randomUUID(),
          tripId: inserted.id,
          name: group.name,
          now,
        }).id;
      }

      for (const route of trip.routes) {
        // Through the service, so distance and elevation caches are computed
        // from the geometry rather than carried over from the file.
        // Through the services, so the distance and elevation caches are
        // computed from the geometry rather than carried over from the file.
        routeService.create(db, {
          tripId: inserted.id,
          name: route.name,
          colour: route.colour,
          points: route.points,
          source: route.source,
          metadata: route.metadata,
        });
      }

      for (const track of trip.tracks) {
        const created = trackService.createFromParsed(db, {
          tripId: inserted.id,
          source: track.source,
          parsed: {
            name: track.name,
            segments: track.segments,
            metadata: track.metadata,
          },
        }).result;

        // Colour and width are not part of `createFromParsed`, which exists
        // for the import path where a file supplies neither.
        if (track.colour !== null || track.width !== null) {
          trackRepo.updateTrack(
            db,
            created.id,
            { colour: track.colour, width: track.width },
            now,
          );
        }
      }

      for (const waypoint of trip.waypoints) {
        const groupId =
          waypoint.groupId === null
            ? null
            : groupIds[waypoint.groupId] ?? null;

        if (waypoint.groupId !== null && groupId === null) {
          warnings.push(
            `Waypoint "${waypoint.name}" referenced a group that was not in the file; it was left ungrouped.`,
          );
        }

        // Straight to the repository: the symbol is written back verbatim,
        // whereas `waypointService.create` substitutes a default for an empty
        // one. A round trip must not change what the file said.
        waypointRepo.insertWaypoint(db, {
          id: randomUUID(),
          tripId: inserted.id,
          groupId,
          name: waypoint.name,
          lat: waypoint.lat,
          lon: waypoint.lon,
          eleM: waypoint.eleM,
          description: waypoint.description,
          symbol: waypoint.symbol,
          notes: waypoint.notes,
          source: waypoint.source,
          metadata: waypoint.metadata,
          now,
        });
      }
    }
  });

  return {
    counts: countCollection(collection),
    tripIds,
    folderIds,
    warnings,
  };
}

/** Parse and apply in one step, for the import pipeline. */
export function readCollection(
  content: string,
  options: ApplyCollectionOptions = {},
): (db: Db) => ApplyCollectionResult {
  const collection = parseCollection(content);
  return (db) => applyCollection(db, collection, options);
}
