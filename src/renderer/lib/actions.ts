import type { RoutePoint } from '@shared/domain/types';
import type { ExportScopeRequest } from '@shared/ipc/schemas';
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
  if (selection.track !== null) return selection.track.tripId;
  if (selection.waypoint !== null) return selection.waypoint.tripId;
  return useGeometryStore.getState().tripId;
}

// ------------------------------------------------------------------ tracks

/**
 * Track editing.
 *
 * Deliberately range-based rather than per-vertex. A recorded track has
 * hundreds of thousands of samples, so "drag this point" is neither a gesture
 * a user wants nor one the undo stack can afford — see ADR 0003. What a user
 * actually does to a recording is trim it, split it, join it, or simplify it,
 * and those are the operations here.
 */

export async function renameTrack(id: string, name: string): Promise<void> {
  await run(() => call(api().tracks.update({ id, name })));
}

export async function setTrackColour(id: string, colour: string): Promise<void> {
  await run(() => call(api().tracks.update({ id, colour })));
}

export async function setTrackWidth(id: string, width: number): Promise<void> {
  await run(() => call(api().tracks.update({ id, width })));
}

export async function reverseTrack(id: string): Promise<void> {
  await run(() => call(api().tracks.reverse({ id })));
}

/** The resulting point count, so the user agrees to a known cost. */
export async function previewTrackSimplify(
  id: string,
  toleranceM: number,
): Promise<{ before: number; after: number } | null> {
  try {
    return await call(api().tracks.previewSimplify({ id, toleranceM }));
  } catch (cause) {
    toast(describeError(cause), 'error');
    return null;
  }
}

export async function simplifyTrack(
  id: string,
  toleranceM: number,
): Promise<void> {
  const ok = await run(() => call(api().tracks.simplify({ id, toleranceM })));
  if (ok) {
    // Honest about the limit: the inverse of a 200,000-point edit is not on the
    // undo stack, and the retained original is the way back.
    toast('Track simplified. Restore the original from its properties if needed.');
  }
}

export async function splitTrack(
  id: string,
  pointIndex: number,
): Promise<void> {
  await run(() => call(api().tracks.split({ id, pointIndex })));
}

export async function joinTracks(
  firstId: string,
  secondId: string,
): Promise<void> {
  await run(() => call(api().tracks.join({ firstId, secondId })));
}

export async function deleteTrackPointRange(
  id: string,
  from: number,
  to: number,
): Promise<void> {
  await run(() => call(api().tracks.deleteRange({ id, from, to })));
}

export async function restoreTrackOriginal(id: string): Promise<void> {
  const ok = await run(() => call(api().tracks.restoreOriginal({ id })));
  if (ok) toast('Track geometry restored from the imported file.');
}

export async function deleteTrack(id: string): Promise<void> {
  const ok = await run(() => call(api().tracks.delete({ id })));
  if (ok) {
    useSelectionStore.getState().clear();
    // Stated plainly rather than implying an undo that does not exist.
    toast('Track deleted. This one cannot be undone.');
  }
}

// ------------------------------------------------------- import and export

export async function chooseFilesToImport(): Promise<void> {
  const ui = useUiStore.getState();
  try {
    const staged = await call(api().importing.choose());
    if (staged.length === 0) return;
    ui.openDialog({ kind: 'import', staged });
  } catch (cause) {
    toast(describeError(cause), 'error');
  }
}

/** Drag-and-drop. The bridge resolves the paths; the renderer never sees them. */
export async function importDroppedFiles(files: readonly File[]): Promise<void> {
  const ui = useUiStore.getState();
  try {
    const staged = await call(api().importing.addDroppedFiles(files));
    if (staged.length === 0) return;
    ui.openDialog({ kind: 'import', staged });
  } catch (cause) {
    toast(describeError(cause), 'error');
  }
}

export function openExportDialog(scope: ExportScopeRequest): void {
  useUiStore.getState().openDialog({ kind: 'export', scope });
}

/** The export scope implied by the current selection. */
export function currentExportScope(): ExportScopeRequest | null {
  const selection = useSelectionStore.getState();
  if (selection.route !== null) return { kind: 'route', id: selection.route.id };
  if (selection.track !== null) return { kind: 'track', id: selection.track.id };
  if (selection.waypoint !== null) {
    return { kind: 'waypoint', id: selection.waypoint.id };
  }
  const tripId = currentTripId();
  return tripId === null ? null : { kind: 'trips', tripIds: [tripId] };
}
