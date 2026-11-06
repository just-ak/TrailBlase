import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type {
  SortDirection,
  Trip,
  TripSortKey,
  TripStatus,
  TripWithCounts,
} from '@shared/domain/types';
import type { Db } from '../client';
import { trips } from '../schema';

export function rowToTrip(row: typeof trips.$inferSelect): Trip {
  return {
    id: row.id,
    folderId: row.folderId ?? null,
    name: row.name,
    description: row.description ?? null,
    notes: row.notes ?? null,
    status: row.status as TripStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Correlated child counts.
 *
 * Written with explicit table aliases rather than interpolated drizzle column
 * objects. Interpolating `${waypoints.tripId}` renders an *unqualified*
 * `"trip_id"`, which inside the subquery resolves against `waypoints` itself —
 * producing `where "trip_id" = "id"`, a comparison of a waypoint's trip to its
 * own id, which is never true and silently yields 0. Aliasing removes the
 * ambiguity entirely.
 */
const countsSelect = {
  routeCount: sql<number>`(select count(*) from routes r where r.trip_id = trips.id)`,
  trackCount: sql<number>`(select count(*) from tracks tr where tr.trip_id = trips.id)`,
  waypointCount: sql<number>`(select count(*) from waypoints w where w.trip_id = trips.id)`,
};

function orderFor(key: TripSortKey, direction: SortDirection) {
  const column =
    key === 'name'
      ? trips.name
      : key === 'createdAt'
        ? trips.createdAt
        : trips.updatedAt;
  return direction === 'asc' ? asc(column) : desc(column);
}

export interface ListTripsOptions {
  folderId?: string | null | undefined;
  includeArchived: boolean;
  sortKey: TripSortKey;
  sortDirection: SortDirection;
}

export function listTrips(db: Db, options: ListTripsOptions): TripWithCounts[] {
  const filters = [];
  if (!options.includeArchived) filters.push(eq(trips.status, 'active'));
  if (options.folderId !== undefined) {
    filters.push(
      options.folderId === null
        ? isNull(trips.folderId)
        : eq(trips.folderId, options.folderId),
    );
  }

  const rows = db
    .select({ trip: trips, ...countsSelect })
    .from(trips)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(orderFor(options.sortKey, options.sortDirection))
    .all();

  return rows.map((r) => ({
    ...rowToTrip(r.trip),
    routeCount: r.routeCount,
    trackCount: r.trackCount,
    waypointCount: r.waypointCount,
  }));
}

export function findTrip(db: Db, id: string): Trip | null {
  const row = db.select().from(trips).where(eq(trips.id, id)).get();
  return row ? rowToTrip(row) : null;
}

export function findTripWithCounts(db: Db, id: string): TripWithCounts | null {
  const row = db
    .select({ trip: trips, ...countsSelect })
    .from(trips)
    .where(eq(trips.id, id))
    .get();
  if (!row) return null;
  return {
    ...rowToTrip(row.trip),
    routeCount: row.routeCount,
    trackCount: row.trackCount,
    waypointCount: row.waypointCount,
  };
}

export function searchTrips(db: Db, query: string): TripWithCounts[] {
  // A user typing "%" or "_" means those characters literally, so they are
  // escaped. SQLite only treats a character as an escape when an explicit
  // ESCAPE clause says so — without it the backslashes would be matched
  // literally and the search would find nothing.
  const escaped = query.replace(/[\\%_]/g, (c) => `\\${c}`);
  const pattern = `%${escaped.toLowerCase()}%`;
  const rows = db
    .select({ trip: trips, ...countsSelect })
    .from(trips)
    .where(sql`lower(${trips.name}) LIKE ${pattern} ESCAPE '\\'`)
    .orderBy(asc(trips.name))
    .all();
  return rows.map((r) => ({
    ...rowToTrip(r.trip),
    routeCount: r.routeCount,
    trackCount: r.trackCount,
    waypointCount: r.waypointCount,
  }));
}

export interface InsertTripValues {
  id: string;
  folderId: string | null;
  name: string;
  description: string | null;
  notes: string | null;
  status?: TripStatus;
  now: number;
}

export function insertTrip(db: Db, values: InsertTripValues): Trip {
  db.insert(trips)
    .values({
      id: values.id,
      folderId: values.folderId,
      name: values.name,
      description: values.description,
      notes: values.notes,
      status: values.status ?? 'active',
      createdAt: values.now,
      updatedAt: values.now,
    })
    .run();
  const created = findTrip(db, values.id);
  if (created === null) {
    throw new Error(`Trip ${values.id} vanished immediately after insert`);
  }
  return created;
}

export interface TripPatch {
  name?: string;
  description?: string | null;
  notes?: string | null;
  folderId?: string | null;
  status?: TripStatus;
}

export function updateTrip(
  db: Db,
  id: string,
  patch: TripPatch,
  now: number,
): void {
  const set: Record<string, unknown> = { updatedAt: now };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.notes !== undefined) set.notes = patch.notes;
  if (patch.folderId !== undefined) set.folderId = patch.folderId;
  if (patch.status !== undefined) set.status = patch.status;
  db.update(trips).set(set).where(eq(trips.id, id)).run();
}

export function deleteTrip(db: Db, id: string): void {
  db.delete(trips).where(eq(trips.id, id)).run();
}

export function tripChildCounts(
  db: Db,
  id: string,
): { routeCount: number; trackCount: number; waypointCount: number } {
  const row = db
    .select(countsSelect)
    .from(trips)
    .where(eq(trips.id, id))
    .get();
  return {
    routeCount: row?.routeCount ?? 0,
    trackCount: row?.trackCount ?? 0,
    waypointCount: row?.waypointCount ?? 0,
  };
}
