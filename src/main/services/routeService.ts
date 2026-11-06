import { randomUUID } from 'node:crypto';
import type {
  Route,
  RoutePoint,
  RouteStats,
  RouteWithPoints,
} from '@shared/domain/types';
import type { RouteWithTrip } from '@shared/ipc/api';
import { elevationStats, pathDistance } from '@shared/geo/distance';
import { reversePoints } from '@shared/geo/routeEdit';
import type { Db } from '../db/client';
import * as repo from '../db/repositories/routes';
import * as tripRepo from '../db/repositories/trips';
import { notFound, ServiceError } from './errors';
import type { Mutation } from './folderService';

/**
 * Route use cases.
 *
 * All geometry editing funnels through `setGeometry`, which replaces the whole
 * point array and recomputes the statistics cache in one transaction. Move,
 * insert, delete, reorder and reverse are callers that build a new array — see
 * `shared/geo/routeEdit` and the Phase 2 design.
 */

function assertTripExists(db: Db, tripId: string): void {
  if (tripRepo.findTrip(db, tripId) === null) {
    throw notFound('That trip');
  }
}

/**
 * Derives statistics from geometry.
 *
 * Distance is 0 for a degenerate route because a zero-length path genuinely has
 * zero length. Elevation is `null` when no point carries any, because "flat"
 * and "unknown" are different facts and the UI must distinguish them.
 */
export function computeStats(points: readonly RoutePoint[]): RouteStats {
  const elevation = elevationStats(
    points.map((p) => ({ lat: p.lat, lon: p.lon, ele: p.ele })),
  );
  return {
    pointCount: points.length,
    distanceM: points.length === 0 ? null : pathDistance(points),
    elevGainM: elevation.gain,
    elevLossM: elevation.loss,
    elevMinM: elevation.min,
    elevMaxM: elevation.max,
  };
}

/** Attaches derived min/max elevation, which is not cached in the table. */
function withDerivedElevation(db: Db, route: Route): Route {
  const stats = computeStats(repo.listPoints(db, route.id));
  return { ...route, elevMinM: stats.elevMinM, elevMaxM: stats.elevMaxM };
}

export function listForTrip(db: Db, tripId: string): Route[] {
  assertTripExists(db, tripId);
  return repo
    .listRoutesForTrip(db, tripId)
    .map((route) => withDerivedElevation(db, route));
}

export function listAll(db: Db): RouteWithTrip[] {
  return repo.listAllRoutes(db);
}

export function get(db: Db, id: string): RouteWithPoints {
  const route = repo.findRouteWithPoints(db, id);
  if (route === null) throw notFound('That route');
  const stats = computeStats(route.points);
  return { ...route, elevMinM: stats.elevMinM, elevMaxM: stats.elevMaxM };
}

function requireRoute(db: Db, id: string): Route {
  const route = repo.findRoute(db, id);
  if (route === null) throw notFound('That route');
  return route;
}

export function create(
  db: Db,
  input: {
    tripId: string;
    name: string;
    colour: string | null;
    points: readonly RoutePoint[];
    source?: 'user' | 'import';
    id?: string;
  },
): Mutation<Route> {
  assertTripExists(db, input.tripId);

  const created = db.transaction((): Route => {
    const now = Date.now();
    const route = repo.insertRoute(db, {
      ...(input.id === undefined ? {} : { id: input.id }),
      tripId: input.tripId,
      name: input.name,
      colour: input.colour,
      source: input.source ?? 'user',
      now,
    });
    repo.replacePoints(db, route.id, input.points);
    const stats = computeStats(input.points);
    repo.writeStats(db, route.id, stats, now);
    return requireRoute(db, route.id);
  });

  return {
    result: withDerivedElevation(db, created),
    inverse: { kind: 'route:delete', payload: { id: created.id } },
  };
}

export function update(
  db: Db,
  input: { id: string; name?: string | undefined; colour?: string | null | undefined },
): Mutation<Route> {
  const before = requireRoute(db, input.id);

  const patch: repo.RoutePatch = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.colour !== undefined) patch.colour = input.colour;

  repo.updateRoute(db, input.id, patch, Date.now());

  return {
    result: withDerivedElevation(db, requireRoute(db, input.id)),
    inverse: {
      kind: 'route:update',
      payload: { id: before.id, name: before.name, colour: before.colour },
    },
  };
}

/**
 * Replaces a route's geometry.
 *
 * The inverse carries the previous point array, which is what makes every
 * editing gesture undoable through a single command.
 */
export function setGeometry(
  db: Db,
  input: { id: string; points: readonly RoutePoint[] },
): Mutation<Route> {
  requireRoute(db, input.id);
  const previous = repo.listPoints(db, input.id);

  const updated = db.transaction((): Route => {
    const now = Date.now();
    repo.replacePoints(db, input.id, input.points);
    repo.writeStats(db, input.id, computeStats(input.points), now);
    return requireRoute(db, input.id);
  });

  return {
    result: withDerivedElevation(db, updated),
    inverse: {
      kind: 'route:setGeometry',
      payload: { id: input.id, points: previous },
    },
  };
}

/** Reverse is a geometry change; it exists separately for the undo label. */
export function reverse(db: Db, id: string): Mutation<Route> {
  const points = repo.listPoints(db, id);
  const mutation = setGeometry(db, { id, points: reversePoints(points) });
  return {
    result: mutation.result,
    // Reversing again is the inverse, and reads better in the Edit menu than
    // "set geometry".
    inverse: { kind: 'route:reverse', payload: { id } },
  };
}

export function duplicate(db: Db, id: string): Mutation<Route> {
  const source = get(db, id);
  return create(db, {
    tripId: source.tripId,
    name: `${source.name} copy`,
    colour: source.colour,
    points: source.points,
    source: source.source,
  });
}

/** Moving a route between trips is a reparent, not a copy. ADR 0004. */
export function moveToTrip(
  db: Db,
  input: { id: string; tripId: string },
): Mutation<Route> {
  const before = requireRoute(db, input.id);
  assertTripExists(db, input.tripId);
  repo.updateRoute(db, input.id, { tripId: input.tripId }, Date.now());
  return {
    result: withDerivedElevation(db, requireRoute(db, input.id)),
    inverse: {
      kind: 'route:move',
      payload: { id: before.id, tripId: before.tripId },
    },
  };
}

/**
 * Deletes a route.
 *
 * Undoable, unlike trip deletion: a route is self-contained, so the inverse is
 * simply recreating it with the same id and geometry. Reusing the id keeps
 * selection and any later references valid.
 */
export function remove(db: Db, id: string): Mutation<{ id: string }> {
  const snapshot = get(db, id);
  repo.deleteRoute(db, id);

  return {
    result: { id },
    inverse: {
      kind: 'route:restore',
      payload: {
        id: snapshot.id,
        tripId: snapshot.tripId,
        name: snapshot.name,
        colour: snapshot.colour,
        source: snapshot.source,
        points: snapshot.points,
      },
    },
  };
}

/** Recreates a deleted route verbatim. Only reached through undo. */
export function restore(
  db: Db,
  input: {
    id: string;
    tripId: string;
    name: string;
    colour: string | null;
    source: 'user' | 'import';
    points: readonly RoutePoint[];
  },
): Mutation<Route> {
  if (repo.findRoute(db, input.id) !== null) {
    throw new ServiceError(
      'CONFLICT',
      'That route already exists and cannot be restored over.',
    );
  }
  return create(db, input);
}

/** Used by the import pipeline in Phase 3; stable id generation lives here. */
export function newRouteId(): string {
  return randomUUID();
}
