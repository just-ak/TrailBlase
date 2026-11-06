import type { Bounds, TripGeometry } from '@shared/domain/types';
import { boundingBox } from '@shared/geo/distance';
import type { Db } from '../db/client';
import * as routeRepo from '../db/repositories/routes';
import * as waypointRepo from '../db/repositories/waypoints';
import * as routeService from './routeService';
import * as tripRepo from '../db/repositories/trips';
import { notFound } from './errors';

/**
 * Everything the map needs to draw one trip, in a single round trip.
 *
 * The alternative — one call per route for its points — turns a trip with
 * twenty routes into twenty-one IPC round trips on every selection change.
 */
export function forTrip(db: Db, tripId: string): TripGeometry {
  if (tripRepo.findTrip(db, tripId) === null) throw notFound('That trip');

  const routes = routeRepo.listRoutesForTrip(db, tripId).map((route) => {
    const points = routeRepo.listPoints(db, route.id);
    const stats = routeService.computeStats(points);
    return {
      ...route,
      elevMinM: stats.elevMinM,
      elevMaxM: stats.elevMaxM,
      points,
    };
  });

  const waypoints = waypointRepo.listWaypointsForTrip(db, tripId);

  // Bounds span every object in the trip, so "fit trip to screen" frames all
  // of it. Null when there is nothing to frame — an empty box is not a thing.
  const all = [
    ...routes.flatMap((r) => r.points.map((p) => ({ lat: p.lat, lon: p.lon }))),
    ...waypoints.map((w) => ({ lat: w.lat, lon: w.lon })),
  ];
  const bounds: Bounds | null = boundingBox(all);

  return { tripId, routes, waypoints, bounds };
}
