import { create } from 'zustand';
import type {
  Folder,
  ObjectRef,
  RouteWithPoints,
  TripWithCounts,
  Waypoint,
} from '@shared/domain/types';
import { api, callOr } from '../lib/client';
import { useGeometryStore } from './geometryStore';

/**
 * What is currently selected, and the loaded detail for it.
 *
 * Selection is a reference plus separately-fetched detail rather than a copy of
 * the object, so the properties panel always shows canonical state after a
 * mutation.
 *
 * Selecting anything also ensures the map has that object's trip geometry
 * loaded — the map and the library are driven by the same selection, so
 * clicking either highlights both (Requirement 6.1).
 */

interface SelectionState {
  selected: ObjectRef | null;
  trip: TripWithCounts | null;
  folder: Folder | null;
  route: RouteWithPoints | null;
  waypoint: Waypoint | null;
  loading: boolean;

  select(ref: ObjectRef | null): Promise<void>;
  reload(): Promise<void>;
  clear(): void;
}

const EMPTY = {
  trip: null,
  folder: null,
  route: null,
  waypoint: null,
} as const;

/** Ensures the map is showing the trip that owns the selected object. */
async function ensureGeometry(tripId: string | null): Promise<void> {
  if (tripId === null) return;
  const geometry = useGeometryStore.getState();
  if (geometry.tripId === tripId) return;
  await geometry.load(tripId);
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selected: null,
  ...EMPTY,
  loading: false,

  select: async (ref) => {
    set({ selected: ref, ...EMPTY });
    if (ref === null) {
      useGeometryStore.getState().clear();
      return;
    }
    await get().reload();
  },

  reload: async () => {
    const ref = get().selected;
    if (ref === null) return;

    set({ loading: true });

    switch (ref.kind) {
      case 'trip': {
        const trip = await callOr(api().trips.get({ id: ref.id }), null);
        // A deleted object clears the selection rather than showing stale data.
        set({
          ...EMPTY,
          trip,
          loading: false,
          ...(trip === null ? { selected: null } : {}),
        });
        await ensureGeometry(trip?.id ?? null);
        return;
      }
      case 'folder': {
        const folder = await callOr(api().folders.get({ id: ref.id }), null);
        set({
          ...EMPTY,
          folder,
          loading: false,
          ...(folder === null ? { selected: null } : {}),
        });
        return;
      }
      case 'route': {
        const route = await callOr(api().routes.get({ id: ref.id }), null);
        set({
          ...EMPTY,
          route,
          loading: false,
          ...(route === null ? { selected: null } : {}),
        });
        await ensureGeometry(route?.tripId ?? null);
        return;
      }
      case 'waypoint': {
        const waypoint = await callOr(api().waypoints.get({ id: ref.id }), null);
        set({
          ...EMPTY,
          waypoint,
          loading: false,
          ...(waypoint === null ? { selected: null } : {}),
        });
        await ensureGeometry(waypoint?.tripId ?? null);
        return;
      }
      default: {
        // Tracks arrive in Phase 3.
        set({ ...EMPTY, loading: false });
        return;
      }
    }
  },

  clear: () => set({ selected: null, ...EMPTY, loading: false }),
}));
