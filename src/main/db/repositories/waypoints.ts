import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import type {
  GeometrySource,
  Waypoint,
  WaypointGroup,
} from '@shared/domain/types';
import type { WaypointWithTrip } from '@shared/ipc/api';
import type { Db } from '../client';
import { trips, waypointGroups, waypoints } from '../schema';

export function rowToWaypoint(row: typeof waypoints.$inferSelect): Waypoint {
  return {
    id: row.id,
    tripId: row.tripId,
    groupId: row.groupId ?? null,
    name: row.name,
    lat: row.lat,
    lon: row.lon,
    eleM: row.eleM ?? null,
    description: row.description ?? null,
    symbol: row.symbol ?? null,
    notes: row.notes ?? null,
    source: row.source as GeometrySource,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listWaypointsForTrip(db: Db, tripId: string): Waypoint[] {
  return db
    .select()
    .from(waypoints)
    .where(eq(waypoints.tripId, tripId))
    .orderBy(asc(waypoints.name))
    .all()
    .map(rowToWaypoint);
}

export function listAllWaypoints(db: Db): WaypointWithTrip[] {
  return db
    .select({ waypoint: waypoints, tripName: trips.name })
    .from(waypoints)
    .innerJoin(trips, eq(waypoints.tripId, trips.id))
    .orderBy(asc(trips.name), asc(waypoints.name))
    .all()
    .map((r) => ({ ...rowToWaypoint(r.waypoint), tripName: r.tripName }));
}

export function findWaypoint(db: Db, id: string): Waypoint | null {
  const row = db.select().from(waypoints).where(eq(waypoints.id, id)).get();
  return row ? rowToWaypoint(row) : null;
}

export function searchWaypoints(db: Db, query: string): WaypointWithTrip[] {
  // Same escaping as the trip search: a literal '%' must not act as a wildcard,
  // and SQLite only honours the escape character when told via ESCAPE.
  const escaped = query.replace(/[\\%_]/g, (c) => `\\${c}`);
  const pattern = `%${escaped.toLowerCase()}%`;
  return db
    .select({ waypoint: waypoints, tripName: trips.name })
    .from(waypoints)
    .innerJoin(trips, eq(waypoints.tripId, trips.id))
    .where(sql`lower(${waypoints.name}) LIKE ${pattern} ESCAPE '\\'`)
    .orderBy(asc(waypoints.name))
    .all()
    .map((r) => ({ ...rowToWaypoint(r.waypoint), tripName: r.tripName }));
}

export interface InsertWaypointValues {
  /** Supplied explicitly when undo restores a deleted waypoint. */
  id?: string;
  tripId: string;
  groupId: string | null;
  name: string;
  lat: number;
  lon: number;
  eleM: number | null;
  description: string | null;
  symbol: string | null;
  notes: string | null;
  source: GeometrySource;
  now: number;
}

export function insertWaypoint(db: Db, values: InsertWaypointValues): Waypoint {
  const id = values.id ?? randomUUID();
  db.insert(waypoints)
    .values({
      id,
      tripId: values.tripId,
      groupId: values.groupId,
      name: values.name,
      lat: values.lat,
      lon: values.lon,
      eleM: values.eleM,
      description: values.description,
      symbol: values.symbol,
      notes: values.notes,
      source: values.source,
      createdAt: values.now,
      updatedAt: values.now,
    })
    .run();
  const created = findWaypoint(db, id);
  if (created === null) {
    throw new Error(`Waypoint ${id} vanished immediately after insert`);
  }
  return created;
}

export interface WaypointPatch {
  name?: string;
  lat?: number;
  lon?: number;
  eleM?: number | null;
  description?: string | null;
  symbol?: string;
  notes?: string | null;
  groupId?: string | null;
  tripId?: string;
}

export function updateWaypoint(
  db: Db,
  id: string,
  patch: WaypointPatch,
  now: number,
): void {
  const set: Record<string, unknown> = { updatedAt: now };
  for (const key of [
    'name',
    'lat',
    'lon',
    'eleM',
    'description',
    'symbol',
    'notes',
    'groupId',
    'tripId',
  ] as const) {
    const value = patch[key];
    if (value !== undefined) set[key] = value;
  }
  db.update(waypoints).set(set).where(eq(waypoints.id, id)).run();
}

export function deleteWaypoint(db: Db, id: string): void {
  db.delete(waypoints).where(eq(waypoints.id, id)).run();
}

// --------------------------------------------------------------- groups

export function listGroups(db: Db, tripId: string): WaypointGroup[] {
  return db
    .select()
    .from(waypointGroups)
    .where(eq(waypointGroups.tripId, tripId))
    .orderBy(asc(waypointGroups.name))
    .all()
    .map((row) => ({
      id: row.id,
      tripId: row.tripId,
      name: row.name,
      createdAt: row.createdAt,
    }));
}

export function insertGroup(
  db: Db,
  values: { id?: string; tripId: string; name: string; now: number },
): WaypointGroup {
  const id = values.id ?? randomUUID();
  db.insert(waypointGroups)
    .values({
      id,
      tripId: values.tripId,
      name: values.name,
      createdAt: values.now,
    })
    .run();
  const created = listGroups(db, values.tripId).find((g) => g.id === id);
  if (created === undefined) {
    throw new Error(`Waypoint group ${id} vanished immediately after insert`);
  }
  return created;
}

export function countWaypointsInTrip(db: Db, tripId: string): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(waypoints)
    .where(eq(waypoints.tripId, tripId))
    .get();
  return row?.n ?? 0;
}
