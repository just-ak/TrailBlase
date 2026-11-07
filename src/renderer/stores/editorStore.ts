import { create } from 'zustand';
import type { RoutePoint } from '@shared/domain/types';
import type { LatLon } from '@shared/geo/distance';

/**
 * Transient map editing state: what mode the map is in and what is being drawn.
 *
 * Nothing here is persisted. A route under construction only becomes a database
 * row when the user finishes it, so cancelling leaves no trace (Requirement
 * 1.4). The measure tool goes further and never writes at all.
 */

export type EditorMode =
  | 'idle'
  | 'drawRoute'
  | 'placeWaypoint'
  | 'measure'
  /**
   * The interactive snap routing tool. Its geometry lives in
   * `snapRoutingStore`, because unlike every other mode it is filled in
   * asynchronously by a provider and needs ordering and staleness handling.
   */
  | 'snapRoute';

interface EditorState {
  mode: EditorMode;
  /** Points placed so far in draw mode. */
  pending: RoutePoint[];
  /** The trip a new object will belong to. */
  targetTripId: string | null;
  /**
   * Whether a route finished in draw mode should be snapped to roads.
   *
   * Kept out of settings on purpose: it is a property of the drawing gesture,
   * and a user who snapped one route has not asked for every future route to be
   * snapped. It resets whenever drawing starts.
   */
  snapWhileDrawing: boolean;
  /** Scratch points for the measure tool. Never written anywhere. */
  measurePoints: LatLon[];

  startDrawRoute(tripId: string): void;
  startPlaceWaypoint(tripId: string): void;
  startMeasure(): void;
  startSnapRoute(tripId: string): void;
  setSnapWhileDrawing(snap: boolean): void;
  appendPending(point: RoutePoint): void;
  undoLastPending(): void;
  appendMeasure(point: LatLon): void;
  undoLastMeasure(): void;
  clearMeasure(): void;
  cancel(): void;
  finish(): RoutePoint[];
}

export const useEditorStore = create<EditorState>((set, get) => ({
  mode: 'idle',
  pending: [],
  targetTripId: null,
  snapWhileDrawing: false,
  measurePoints: [],

  startDrawRoute: (tripId) =>
    set({
      mode: 'drawRoute',
      pending: [],
      targetTripId: tripId,
      snapWhileDrawing: false,
    }),

  startPlaceWaypoint: (tripId) =>
    set({ mode: 'placeWaypoint', pending: [], targetTripId: tripId }),

  // No trip id: a measurement belongs to nothing.
  startMeasure: () =>
    set({ mode: 'measure', measurePoints: [], targetTripId: null }),

  startSnapRoute: (tripId) =>
    set({ mode: 'snapRoute', pending: [], targetTripId: tripId }),

  setSnapWhileDrawing: (snapWhileDrawing) => set({ snapWhileDrawing }),

  appendPending: (point) => set({ pending: [...get().pending, point] }),

  /** Backspace during drawing removes the last placed point. */
  undoLastPending: () => set({ pending: get().pending.slice(0, -1) }),

  appendMeasure: (point) =>
    set({ measurePoints: [...get().measurePoints, point] }),

  undoLastMeasure: () =>
    set({ measurePoints: get().measurePoints.slice(0, -1) }),

  clearMeasure: () => set({ measurePoints: [] }),

  cancel: () =>
    set({
      mode: 'idle',
      pending: [],
      targetTripId: null,
      snapWhileDrawing: false,
      measurePoints: [],
    }),

  finish: () => {
    const points = get().pending;
    set({ mode: 'idle', pending: [], targetTripId: null });
    return points;
  },
}));
