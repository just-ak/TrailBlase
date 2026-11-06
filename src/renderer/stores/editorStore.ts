import { create } from 'zustand';
import type { RoutePoint } from '@shared/domain/types';

/**
 * Transient map editing state: what mode the map is in and what is being drawn.
 *
 * Nothing here is persisted. A route under construction only becomes a database
 * row when the user finishes it, so cancelling leaves no trace (Requirement
 * 1.4).
 */

export type EditorMode = 'idle' | 'drawRoute' | 'placeWaypoint';

interface EditorState {
  mode: EditorMode;
  /** Points placed so far in draw mode. */
  pending: RoutePoint[];
  /** The trip a new object will belong to. */
  targetTripId: string | null;

  startDrawRoute(tripId: string): void;
  startPlaceWaypoint(tripId: string): void;
  appendPending(point: RoutePoint): void;
  undoLastPending(): void;
  cancel(): void;
  finish(): RoutePoint[];
}

export const useEditorStore = create<EditorState>((set, get) => ({
  mode: 'idle',
  pending: [],
  targetTripId: null,

  startDrawRoute: (tripId) =>
    set({ mode: 'drawRoute', pending: [], targetTripId: tripId }),

  startPlaceWaypoint: (tripId) =>
    set({ mode: 'placeWaypoint', pending: [], targetTripId: tripId }),

  appendPending: (point) => set({ pending: [...get().pending, point] }),

  /** Backspace during drawing removes the last placed point. */
  undoLastPending: () => set({ pending: get().pending.slice(0, -1) }),

  cancel: () => set({ mode: 'idle', pending: [], targetTripId: null }),

  finish: () => {
    const points = get().pending;
    set({ mode: 'idle', pending: [], targetTripId: null });
    return points;
  },
}));
