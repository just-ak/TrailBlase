import type { RoutePoint } from '@shared/domain/types';
import {
  deletePoint,
  insertPointAt,
  movePoint,
} from '@shared/geo/routeEdit';
import { api, call, describeError } from './client';
import { useEditorStore } from '../stores/editorStore';
import { useGeometryStore } from '../stores/geometryStore';
import { useLibraryStore } from '../stores/libraryStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useUiStore } from '../stores/uiStore';

/**
 * Editing operations, in one place.
 *
 * The map, the library tree, the properties panel and the native menus all
 * reach the same functions, so there is a single definition of what "delete a
 * route" means and a single place that refreshes the stores afterwards.
 *
 * Geometry edits compute the new point array with the pure helpers in
 * `shared/geo/routeEdit` and send the whole array. One command covers every
 * gesture, and its inverse is the previous array — see the Phase 2 design.
 */

function toast(message: string, tone: 'info' | 'error' = 'info'): void {
  useUiStore.getState().showToast(message, tone);
}

/** Refreshes everything a mutation could have changed. */
async function refreshAll(): Promise<void> {
  await Promise.all([
    useGeometryStore.getState().reload(),
    useLibraryStore.getState().refresh(),
    useSelectionStore.getState().reload(),
  ]);
}

async function run(
  operation: () => Promise<unknown>,
  failureNote?: string,
): Promise<boolean> {
  try {
    await operation();
    await refreshAll();
    return true;
  } catch (cause) {
    toast(failureNote ?? describeError(cause), 'error');
    // Reload anyway: the local cache may be mid-edit and must not be left
    // showing something the database rejected.
    await refreshAll();
    return false;
  }
}

// ------------------------------------------------------------------ routes

export async function createRouteFromPoints(
  tripId: string,
  points: readonly RoutePoint[],
  name = 'New Route',
): Promise<void> {
  if (points.length === 0) {
    toast('Nothing to save — place at least one point.', 'error');
    return;
  }
  try {
    const route = await call(
      api().routes.create({ tripId, name, points: [...points] }),
    );
    await refreshAll();
    await useSelectionStore.getState().select({ kind: 'route', id: route.id });
    toast(`Route saved with ${points.length} points.`);
  } catch (cause) {
    toast(describeError(cause), 'error');
  }
}

/** Replaces geometry. All gestures funnel through here. */
async function setGeometry(
  routeId: string,
  points: readonly RoutePoint[],
): Promise<void> {
  await run(() =>
    call(api().routes.setGeometry({ id: routeId, points: [...points] })),
  );
}

function pointsOf(routeId: string): RoutePoint[] | null {
  return useGeometryStore.getState().findRoute(routeId)?.points ?? null;
}

export async function moveRouteVertex(
  routeId: string,
  index: number,
  lat: number,
  lon: number,
): Promise<void> {
  const points = pointsOf(routeId);
  if (points === null) return;
  await setGeometry(routeId, movePoint(points, index, lat, lon));
}

export async function deleteRouteVertex(
  routeId: string,
  index: number,
): Promise<void> {
  const points = pointsOf(routeId);
  if (points === null) return;
  if (points.length <= 1) {
    // Deleting the last point would leave a route with no geometry at all.
    // Deleting the route is a different, confirmable action.
    toast('A route needs at least one point. Delete the route instead.', 'error');
    return;
  }
  await setGeometry(routeId, deletePoint(points, index));
}

export async function insertRouteVertex(
  routeId: string,
  index: number,
  lat: number,
  lon: number,
): Promise<void> {
  const points = pointsOf(routeId);
  if (points === null) return;
  await setGeometry(
    routeId,
    insertPointAt(points, index, {
      lat,
      lon,
      ele: null,
      name: null,
      symbol: null,
      notes: null,
    }),
  );
}

export async function reverseRoute(routeId: string): Promise<void> {
  await run(() => call(api().routes.reverse({ id: routeId })));
}

export async function duplicateRoute(routeId: string): Promise<void> {
  try {
    const copy = await call(api().routes.duplicate({ id: routeId }));
    await refreshAll();
    await useSelectionStore.getState().select({ kind: 'route', id: copy.id });
  } catch (cause) {
    toast(describeError(cause), 'error');
  }
}

export async function renameRoute(routeId: string, name: string): Promise<void> {
  await run(() => call(api().routes.update({ id: routeId, name })));
}

export async function setRouteColour(
  routeId: string,
  colour: string,
): Promise<void> {
  await run(() => call(api().routes.update({ id: routeId, colour })));
}

export async function deleteRoute(routeId: string): Promise<void> {
  const ok = await run(() => call(api().routes.delete({ id: routeId })));
  if (ok) {
    useSelectionStore.getState().clear();
    toast('Route deleted. Undo with ⌘Z.');
  }
}

// --------------------------------------------------------------- waypoints

export async function createWaypoint(
  tripId: string,
  lat: number,
  lon: number,
  name = 'New Waypoint',
): Promise<void> {
  try {
    const waypoint = await call(
      api().waypoints.create({ tripId, name, lat, lon }),
    );
    await refreshAll();
    await useSelectionStore
      .getState()
      .select({ kind: 'waypoint', id: waypoint.id });
  } catch (cause) {
    toast(describeError(cause), 'error');
  }
}

export async function moveWaypoint(
  id: string,
  lat: number,
  lon: number,
): Promise<void> {
  await run(() => call(api().waypoints.move({ id, lat, lon })));
}

export async function updateWaypoint(
  id: string,
  patch: {
    name?: string;
    lat?: number;
    lon?: number;
    eleM?: number | null;
    description?: string | null;
    symbol?: string;
    notes?: string | null;
  },
): Promise<void> {
  await run(() => call(api().waypoints.update({ id, ...patch })));
}

export async function duplicateWaypoint(id: string): Promise<void> {
  try {
    const copy = await call(api().waypoints.duplicate({ id }));
    await refreshAll();
    await useSelectionStore.getState().select({ kind: 'waypoint', id: copy.id });
  } catch (cause) {
    toast(describeError(cause), 'error');
  }
}

export async function deleteWaypoint(id: string): Promise<void> {
  const ok = await run(() => call(api().waypoints.delete({ id })));
  if (ok) {
    useSelectionStore.getState().clear();
    toast('Waypoint deleted. Undo with ⌘Z.');
  }
}

// -------------------------------------------------------------------- undo

export async function undo(): Promise<void> {
  try {
    await call(api().undo.undo());
    await refreshAll();
  } catch (cause) {
    toast(describeError(cause), 'error');
  }
}

export async function redo(): Promise<void> {
  try {
    await call(api().undo.redo());
    await refreshAll();
  } catch (cause) {
    toast(describeError(cause), 'error');
  }
}

// ------------------------------------------------------------------- modes

/**
 * Starts drawing a route in the trip that owns the current selection.
 *
 * Requires a trip context: a route must belong to exactly one trip (ADR 0004),
 * so there is no sensible "draw with nothing selected".
 */
export function startDrawingRoute(): void {
  const tripId = currentTripId();
  if (tripId === null) {
    toast('Select a trip first — a route has to belong to one.', 'error');
    return;
  }
  useEditorStore.getState().startDrawRoute(tripId);
}

export function startPlacingWaypoint(): void {
  const tripId = currentTripId();
  if (tripId === null) {
    toast('Select a trip first — a waypoint has to belong to one.', 'error');
    return;
  }
  useEditorStore.getState().startPlaceWaypoint(tripId);
}

/** The trip implied by the current selection, whatever kind it is. */
export function currentTripId(): string | null {
  const selection = useSelectionStore.getState();
  if (selection.trip !== null) return selection.trip.id;
  if (selection.route !== null) return selection.route.tripId;
  if (selection.waypoint !== null) return selection.waypoint.tripId;
  return useGeometryStore.getState().tripId;
}
