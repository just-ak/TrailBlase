import type { Bounds, TripGeometry } from '@shared/domain/types';
import { boundingBox } from '@shared/geo/distance';
import type { Db } from '../db/client';
import * as routeRepo from '../db/repositories/routes';
import * as trackRepo from '../db/repositories/tracks';
import * as waypointRepo from '../db/repositories/waypoints';
import * as routeService from './routeService';
import * as trackService from './trackService';
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

  // Metadata only. A track's points are fetched separately, at the zoom the
  // map is drawing, because a recorded track can hold 200,000 of them.
  const tracks = trackService.listForTrip(db, tripId);

  // Bounds span every object in the trip, so "fit trip to screen" frames all
  // of it. Null when there is nothing to frame — an empty box is not a thing.
  const all = [
    ...routes.flatMap((r) => r.points.map((p) => ({ lat: p.lat, lon: p.lon }))),
    ...waypoints.map((w) => ({ lat: w.lat, lon: w.lon })),
  ];

  // Track extents come from a SQL aggregate rather than their points, for the
  // same reason their geometry is not included here.
  const trackBox = trackRepo.trackBoundsForTrip(db, tripId);
  if (trackBox !== null) {
    all.push(
      { lat: trackBox.minLat, lon: trackBox.minLon },
      { lat: trackBox.maxLat, lon: trackBox.maxLon },
    );
  }

  const bounds: Bounds | null = boundingBox(all);

  return { tripId, routes, tracks, waypoints, bounds };
}
