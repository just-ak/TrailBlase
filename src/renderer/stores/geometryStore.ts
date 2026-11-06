import { create } from 'zustand';
import type { RouteWithPoints, TripGeometry, Waypoint } from '@shared/domain/types';
import { api, callOr } from '../lib/client';

/**
 * Routes and waypoints for the trip currently being viewed.
 *
 * Fetched in one call (`geometry:forTrip`) rather than one per route: a trip
 * with twenty routes would otherwise mean twenty-one round trips on every
 * selection change.
 *
 * The main process remains the source of truth. This store is a cache that is
 * reloaded after any mutation, so what the map draws is always what was
 * persisted.
 */
interface GeometryState {
  tripId: string | null;
  geometry: TripGeometry | null;
  loading: boolean;

  load(tripId: string): Promise<void>;
  reload(): Promise<void>;
  clear(): void;

  findRoute(id: string): RouteWithPoints | null;
  findWaypoint(id: string): Waypoint | null;
}

let sequence = 0;

export const useGeometryStore = create<GeometryState>((set, get) => ({
  tripId: null,
  geometry: null,
  loading: false,

  load: async (tripId) => {
    // Guard against an earlier trip's response arriving after a later one and
    // painting the wrong geometry.
    const seq = ++sequence;
    set({ tripId, loading: true });
    const geometry = await callOr(api().geometry.forTrip({ tripId }), null);
    if (seq !== sequence) return;
    set({ geometry, loading: false });
  },

  reload: async () => {
    const { tripId } = get();
    if (tripId === null) return;
    await get().load(tripId);
  },

  clear: () => {
    sequence += 1;
    set({ tripId: null, geometry: null, loading: false });
  },

  findRoute: (id) => get().geometry?.routes.find((r) => r.id === id) ?? null,
  findWaypoint: (id) =>
    get().geometry?.waypoints.find((w) => w.id === id) ?? null,
}));
