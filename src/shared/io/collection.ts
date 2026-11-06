import { z } from 'zod';

/**
 * The native JSON collection format.
 *
 * This is the "move my data to another machine" format, and it is a different
 * thing from the rolling SQLite snapshots in `backupService`. Those are a
 * binary copy of one install's database; this is a readable, versioned document
 * that can be imported into an existing collection without replacing it.
 *
 * Three decisions worth stating:
 *
 * - **Versioned envelope.** `format` and `version` come first so a future
 *   change is detectable rather than producing a confusing partial import. A
 *   file from a newer version is refused with an explanation, never
 *   best-effort parsed.
 * - **Validated with zod, not trusted.** A collection file is untrusted input
 *   like any other import. Parsing is schema-driven so a malformed document
 *   fails before anything is written.
 * - **Caches are omitted.** Distances, point counts and render geometry are
 *   derived, so they are recomputed on import rather than carried. Writing a
 *   cache into an interchange format is how a stale number outlives the data
 *   it described.
 *
 * Geometry is nested under its owner rather than stored in parallel arrays
 * joined by id. It makes the document readable, and it makes a partial file
 * impossible to misread: a route either has its points or is not there.
 */

export const COLLECTION_FORMAT = 'trailrt-collection';

/** Bump only for a breaking change; additive fields do not need it. */
export const COLLECTION_VERSION = 1;

const nullableNumber = z.number().finite().nullable();
const nullableText = z.string().nullable();

/** Arbitrary preserved metadata. Kept opaque: we store it, we do not read it. */
const metadata = z.record(z.string(), z.unknown()).default({});

export const collectionFolderSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  name: z.string(),
  sortOrder: z.number().int().default(0),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export const collectionRoutePointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  ele: nullableNumber,
  name: nullableText,
  symbol: nullableText,
  notes: nullableText,
});

export const collectionRouteSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  colour: nullableText,
  source: z.enum(['user', 'import']),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  metadata,
  points: z.array(collectionRoutePointSchema),
});

export const collectionTrackPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  ele: nullableNumber,
  time: z.number().int().nullable(),
});

export const collectionTrackSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  colour: nullableText,
  width: z.number().int().nullable(),
  source: z.enum(['user', 'import']),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  metadata,
  segments: z.array(z.object({ points: z.array(collectionTrackPointSchema) })),
});

export const collectionWaypointSchema = z.object({
  id: z.string().min(1),
  groupId: z.string().min(1).nullable(),
  name: z.string(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  eleM: nullableNumber,
  description: nullableText,
  symbol: nullableText,
  notes: nullableText,
  source: z.enum(['user', 'import']),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  metadata,
});

export const collectionTripSchema = z.object({
  id: z.string().min(1),
  folderId: z.string().min(1).nullable(),
  name: z.string(),
  description: nullableText,
  notes: nullableText,
  status: z.enum(['active', 'archived']),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  metadata,
  waypointGroups: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string(),
        createdAt: z.number().int(),
      }),
    )
    .default([]),
  routes: z.array(collectionRouteSchema).default([]),
  tracks: z.array(collectionTrackSchema).default([]),
  waypoints: z.array(collectionWaypointSchema).default([]),
});

export const collectionSchema = z.object({
  format: z.literal(COLLECTION_FORMAT),
  version: z.number().int().positive(),
  /** Informational: which build wrote the file. Never used to gate a read. */
  appVersion: z.string().default('unknown'),
  exportedAt: z.number().int(),
  folders: z.array(collectionFolderSchema).default([]),
  trips: z.array(collectionTripSchema).default([]),
});

export type Collection = z.infer<typeof collectionSchema>;
export type CollectionTrip = z.infer<typeof collectionTripSchema>;
export type CollectionFolder = z.infer<typeof collectionFolderSchema>;
export type CollectionRoute = z.infer<typeof collectionRouteSchema>;
export type CollectionTrack = z.infer<typeof collectionTrackSchema>;
export type CollectionWaypoint = z.infer<typeof collectionWaypointSchema>;

export interface CollectionCounts {
  folders: number;
  trips: number;
  routes: number;
  tracks: number;
  waypoints: number;
  points: number;
}

export function countCollection(collection: Collection): CollectionCounts {
  let routes = 0;
  let tracks = 0;
  let waypoints = 0;
  let points = 0;

  for (const trip of collection.trips) {
    routes += trip.routes.length;
    tracks += trip.tracks.length;
    waypoints += trip.waypoints.length;
    points += trip.waypoints.length;
    for (const route of trip.routes) points += route.points.length;
    for (const track of trip.tracks) {
      for (const segment of track.segments) points += segment.points.length;
    }
  }

  return {
    folders: collection.folders.length,
    trips: collection.trips.length,
    routes,
    tracks,
    waypoints,
    points,
  };
}
