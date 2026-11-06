import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import type {
  GeometrySource,
  Route,
  RoutePoint,
  RouteWithPoints,
} from '@shared/domain/types';
import type { RouteWithTrip } from '@shared/ipc/api';
import type { Db } from '../client';
import { encodeMetadata } from '../metadata';
import { routePoints, routes, trips } from '../schema';

/** Data access for routes and their points. Invariants live in the service. */

export function rowToRoute(row: typeof routes.$inferSelect): Route {
  return {
    id: row.id,
    tripId: row.tripId,
    name: row.name,
    colour: row.colour ?? null,
    source: row.source as GeometrySource,
    pointCount: row.pointCount,
    distanceM: row.distanceM ?? null,
    elevGainM: row.elevGainM ?? null,
    elevLossM: row.elevLossM ?? null,
    // Min and max are derived on read rather than cached: they are only needed
    // by the properties panel, and caching four numbers where two suffice is
    // more schema surface to keep consistent.
    elevMinM: null,
    elevMaxM: null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listRoutesForTrip(db: Db, tripId: string): Route[] {
  return db
    .select()
    .from(routes)
    .where(eq(routes.tripId, tripId))
    .orderBy(asc(routes.name))
    .all()
    .map(rowToRoute);
}

/** Cross-trip listing for the library's Routes view. */
export function listAllRoutes(db: Db): RouteWithTrip[] {
  return db
    .select({ route: routes, tripName: trips.name })
    .from(routes)
    .innerJoin(trips, eq(routes.tripId, trips.id))
    .orderBy(asc(trips.name), asc(routes.name))
    .all()
    .map((r) => ({ ...rowToRoute(r.route), tripName: r.tripName }));
}

export function findRoute(db: Db, id: string): Route | null {
  const row = db.select().from(routes).where(eq(routes.id, id)).get();
  return row ? rowToRoute(row) : null;
}

export function listPoints(db: Db, routeId: string): RoutePoint[] {
  return db
    .select()
    .from(routePoints)
    .where(eq(routePoints.routeId, routeId))
    .orderBy(asc(routePoints.seq))
    .all()
    .map((p) => ({
      lat: p.lat,
      lon: p.lon,
      ele: p.eleM ?? null,
      name: p.name ?? null,
      symbol: p.symbol ?? null,
      notes: p.notes ?? null,
    }));
}

export function findRouteWithPoints(
  db: Db,
  id: string,
): RouteWithPoints | null {
  const route = findRoute(db, id);
  if (route === null) return null;
  return { ...route, points: listPoints(db, id) };
}

export interface InsertRouteValues {
  /** Supplied explicitly when undo restores a deleted route with its own id. */
  id?: string;
  tripId: string;
  name: string;
  colour: string | null;
  source: GeometrySource;
  /** Imported fields with no column of their own. See db/metadata.ts. */
  metadata?: Record<string, unknown> | undefined;
  now: number;
}

export function insertRoute(db: Db, values: InsertRouteValues): Route {
  const id = values.id ?? randomUUID();
  db.insert(routes)
    .values({
      id,
      tripId: values.tripId,
      name: values.name,
      colour: values.colour,
      source: values.source,
      metadata: encodeMetadata(values.metadata),
      createdAt: values.now,
      updatedAt: values.now,
    })
    .run();
  const created = findRoute(db, id);
  if (created === null) {
    throw new Error(`Route ${id} vanished immediately after insert`);
  }
  return created;
}

export interface RoutePatch {
  name?: string;
  colour?: string | null;
  tripId?: string;
}

export function updateRoute(
  db: Db,
  id: string,
  patch: RoutePatch,
  now: number,
): void {
  const set: Record<string, unknown> = { updatedAt: now };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.colour !== undefined) set.colour = patch.colour;
  if (patch.tripId !== undefined) set.tripId = patch.tripId;
  db.update(routes).set(set).where(eq(routes.id, id)).run();
}

export function deleteRoute(db: Db, id: string): void {
  db.delete(routes).where(eq(routes.id, id)).run();
}

/**
 * Replaces a route's entire point array.
 *
 * Delete-then-reinsert rather than a diff. It keeps `seq` dense by
 * construction, so there is no path to a gap or a unique-constraint collision
 * after a reorder — which a positional diff makes easy to get wrong. Must run
 * inside the caller's transaction.
 */
export function replacePoints(
  db: Db,
  routeId: string,
  points: readonly RoutePoint[],
): void {
  db.delete(routePoints).where(eq(routePoints.routeId, routeId)).run();

  if (points.length === 0) return;

  const rows = points.map((point, index) => ({
    id: randomUUID(),
    routeId,
    seq: index,
    lat: point.lat,
    lon: point.lon,
    eleM: point.ele,
    name: point.name,
    symbol: point.symbol,
    notes: point.notes,
  }));

  // One multi-row insert; a per-point statement would be noticeably slower on
  // a few hundred points and this runs on every drag commit.
  db.insert(routePoints).values(rows).run();
}

/** Writes the derived statistics cache. Always paired with replacePoints. */
export function writeStats(
  db: Db,
  routeId: string,
  stats: {
    pointCount: number;
    distanceM: number | null;
    elevGainM: number | null;
    elevLossM: number | null;
  },
  now: number,
): void {
  db.update(routes)
    .set({
      pointCount: stats.pointCount,
      distanceM: stats.distanceM,
      elevGainM: stats.elevGainM,
      elevLossM: stats.elevLossM,
      updatedAt: now,
    })
    .where(eq(routes.id, routeId))
    .run();
}

export function countRoutesInTrip(db: Db, tripId: string): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(routes)
    .where(eq(routes.tripId, tripId))
    .get();
  return row?.n ?? 0;
}
