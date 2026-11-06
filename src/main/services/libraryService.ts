import type {
  Folder,
  Route,
  TreeNode,
  TripWithCounts,
  ViewId,
  Waypoint,
} from '@shared/domain/types';
import type { Db } from '../db/client';
import * as routeRepo from '../db/repositories/routes';
import * as waypointRepo from '../db/repositories/waypoints';
import * as folderService from './folderService';
import * as tripService from './tripService';

/**
 * Builds the library tree.
 *
 * Folders and trips are real containers; routes and waypoints are children of
 * their trip. The Routes / Tracks / Waypoints / Imported Data / Recently Used
 * nodes are **saved views** — cross-trip queries, not storage locations. See
 * ADR 0004.
 *
 * A view whose backing feature arrives in a later phase is marked
 * `available: false` so the UI can say so, rather than rendering an empty
 * branch that looks broken (Requirement 4.2).
 */

interface ViewSpec {
  id: ViewId;
  name: string;
  available: boolean;
}

const VIEWS: readonly ViewSpec[] = [
  { id: 'trips', name: 'Trips', available: true },
  { id: 'routes', name: 'Routes', available: true },
  { id: 'tracks', name: 'Tracks', available: false }, // Phase 3
  { id: 'waypoints', name: 'Waypoints', available: true },
  { id: 'imported', name: 'Imported Data', available: false }, // Phase 3
  { id: 'recent', name: 'Recently Used', available: false }, // later
];

/** Metres rendered compactly for a tree row; full formatting is the UI's job. */
function shortDistance(metres: number | null): string | undefined {
  if (metres === null) return undefined;
  return metres < 1000
    ? `${Math.round(metres)} m`
    : `${(metres / 1000).toFixed(1)} km`;
}

/** `path` makes the node id unique even when the object appears twice. */
function routeNode(route: Route, path: string): TreeNode {
  const detail = shortDistance(route.distanceM);
  return {
    id: `${path}/route:${route.id}`,
    ref: { kind: 'route', id: route.id },
    kind: 'route',
    name: route.name,
    ...(detail === undefined ? {} : { detail }),
    children: [],
  };
}

function waypointNode(waypoint: Waypoint, path: string): TreeNode {
  return {
    id: `${path}/waypoint:${waypoint.id}`,
    ref: { kind: 'waypoint', id: waypoint.id },
    kind: 'waypoint',
    name: waypoint.name,
    children: [],
  };
}

function tripNode(
  trip: TripWithCounts,
  routes: readonly Route[],
  waypoints: readonly Waypoint[],
): TreeNode {
  const path = `trip:${trip.id}`;
  return {
    id: path,
    ref: { kind: 'trip', id: trip.id },
    kind: 'trip',
    name: trip.name,
    status: trip.status,
    children: [
      ...routes.map((r) => routeNode(r, path)),
      ...waypoints.map((w) => waypointNode(w, path)),
    ],
  };
}

export function tree(db: Db, options: { includeArchived: boolean }): TreeNode {
  const folders = folderService.list(db);
  const trips = tripService.list(db, {
    includeArchived: options.includeArchived,
    sortKey: 'name',
    sortDirection: 'asc',
  });

  // Fetched once and grouped, rather than queried per trip inside the
  // recursion — a collection with many trips would otherwise issue a query per
  // trip per render of the tree.
  const allRoutes = routeRepo.listAllRoutes(db);
  const allWaypoints = waypointRepo.listAllWaypoints(db);

  const routesByTrip = new Map<string, Route[]>();
  for (const route of allRoutes) {
    const bucket = routesByTrip.get(route.tripId);
    if (bucket === undefined) routesByTrip.set(route.tripId, [route]);
    else bucket.push(route);
  }

  const waypointsByTrip = new Map<string, Waypoint[]>();
  for (const waypoint of allWaypoints) {
    const bucket = waypointsByTrip.get(waypoint.tripId);
    if (bucket === undefined) waypointsByTrip.set(waypoint.tripId, [waypoint]);
    else bucket.push(waypoint);
  }

  const buildTrip = (trip: TripWithCounts): TreeNode =>
    tripNode(
      trip,
      routesByTrip.get(trip.id) ?? [],
      waypointsByTrip.get(trip.id) ?? [],
    );

  const foldersByParent = new Map<string | null, Folder[]>();
  for (const folder of folders) {
    const bucket = foldersByParent.get(folder.parentId);
    if (bucket === undefined) foldersByParent.set(folder.parentId, [folder]);
    else bucket.push(folder);
  }

  const tripsByFolder = new Map<string | null, TripWithCounts[]>();
  for (const trip of trips) {
    const bucket = tripsByFolder.get(trip.folderId);
    if (bucket === undefined) tripsByFolder.set(trip.folderId, [trip]);
    else bucket.push(trip);
  }

  const buildFolder = (folder: Folder): TreeNode => ({
    id: `folder:${folder.id}`,
    ref: { kind: 'folder', id: folder.id },
    kind: 'folder',
    name: folder.name,
    children: [
      ...(foldersByParent.get(folder.id) ?? []).map(buildFolder),
      ...(tripsByFolder.get(folder.id) ?? []).map(buildTrip),
    ],
  });

  const visibleTripIds = new Set(trips.map((t) => t.id));

  const viewNodes: TreeNode[] = VIEWS.map((view) => {
    const node: TreeNode = {
      id: `view:${view.id}`,
      kind: 'view',
      name: view.name,
      viewId: view.id,
      available: view.available,
      children: [],
    };

    if (view.id === 'trips') {
      node.children = [
        ...(foldersByParent.get(null) ?? []).map(buildFolder),
        ...(tripsByFolder.get(null) ?? []).map(buildTrip),
      ];
    } else if (view.id === 'routes') {
      // Cross-trip view: flat, annotated with the owning trip.
      node.children = allRoutes
        .filter((route) => visibleTripIds.has(route.tripId))
        .map((route) => ({
          ...routeNode(route, 'view:routes'),
          detail: route.tripName,
        }));
    } else if (view.id === 'waypoints') {
      node.children = allWaypoints
        .filter((waypoint) => visibleTripIds.has(waypoint.tripId))
        .map((waypoint) => ({
          ...waypointNode(waypoint, 'view:waypoints'),
          detail: waypoint.tripName,
        }));
    }

    return node;
  });

  return {
    id: 'root',
    kind: 'root',
    name: 'My Collection',
    children: viewNodes,
  };
}
