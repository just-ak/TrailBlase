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
import * as trackRepo from '../db/repositories/tracks';
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
  { id: 'tracks', name: 'Tracks', available: true },
  { id: 'waypoints', name: 'Waypoints', available: true },
  { id: 'imported', name: 'Imported Data', available: true },
  { id: 'recent', name: 'Recently Used', available: false }, // later
];

/**
 * Sort key for the cross-trip views.
 *
 * Distance is only offered now that both routes and tracks have one. A null
 * distance sorts last rather than as zero: an object whose length is unknown
 * is not the shortest one.
 */
export type ObjectSortKey = 'name' | 'distance' | 'updatedAt';

function byDistance(
  a: number | null,
  b: number | null,
  direction: 1 | -1,
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * direction;
}

/** Metres rendered compactly for a tree row; full formatting is the UI's job. */
function shortDistance(metres: number | null): string | undefined {
  if (metres === null) return undefined;
  return metres < 1000
    ? `${Math.round(metres)} m`
    : `${(metres / 1000).toFixed(1)} km`;
}

/**
 * A track row.
 *
 * Takes a structural subset rather than a full `Track`: the repository's
 * cross-trip listing returns rows without the derived fields (`segmentCount`,
 * `durationS`, elevation range), and a tree row needs none of them. Asking for
 * only what is used avoids a cast that would claim otherwise.
 */
function trackNode(
  track: { id: string; name: string; distanceM: number | null },
  path: string,
): TreeNode {
  const detail = shortDistance(track.distanceM);
  return {
    id: `${path}/track:${track.id}`,
    ref: { kind: 'track', id: track.id },
    kind: 'track',
    name: track.name,
    ...(detail === undefined ? {} : { detail }),
    children: [],
  };
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
  tracks: readonly { id: string; name: string; distanceM: number | null }[],
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
      ...tracks.map((t) => trackNode(t, path)),
      ...waypoints.map((w) => waypointNode(w, path)),
    ],
  };
}

export function tree(
  db: Db,
  options: { includeArchived: boolean; sortKey?: ObjectSortKey },
): TreeNode {
  const sortKey = options.sortKey ?? 'name';
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
  const allTracks = trackRepo.listAllTracks(db);
  const allWaypoints = waypointRepo.listAllWaypoints(db);

  const routesByTrip = new Map<string, Route[]>();
  for (const route of allRoutes) {
    const bucket = routesByTrip.get(route.tripId);
    if (bucket === undefined) routesByTrip.set(route.tripId, [route]);
    else bucket.push(route);
  }

  type TrackRow = (typeof allTracks)[number];
  const tracksByTrip = new Map<string, TrackRow[]>();
  for (const track of allTracks) {
    const bucket = tracksByTrip.get(track.tripId);
    if (bucket === undefined) tracksByTrip.set(track.tripId, [track]);
    else bucket.push(track);
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
      tracksByTrip.get(trip.id) ?? [],
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
        .toSorted((a, b) =>
          sortKey === 'distance'
            ? byDistance(a.distanceM, b.distanceM, 1)
            : a.name.localeCompare(b.name),
        )
        .map((route) => ({
          ...routeNode(route, 'view:routes'),
          detail: route.tripName,
        }));
    } else if (view.id === 'tracks') {
      node.children = allTracks
        .filter((track) => visibleTripIds.has(track.tripId))
        .toSorted((a, b) =>
          sortKey === 'distance'
            ? byDistance(a.distanceM, b.distanceM, 1)
            : a.name.localeCompare(b.name),
        )
        .map((track) => ({
          ...trackNode(track, 'view:tracks'),
          detail: track.tripName,
        }));
    } else if (view.id === 'waypoints') {
      node.children = allWaypoints
        .filter((waypoint) => visibleTripIds.has(waypoint.tripId))
        .map((waypoint) => ({
          ...waypointNode(waypoint, 'view:waypoints'),
          detail: waypoint.tripName,
        }));
    } else if (view.id === 'imported') {
      // Everything whose geometry came from a file rather than being drawn
      // here. A cross-trip view over `source`, which is exactly what the
      // column is for.
      node.children = [
        ...allRoutes
          .filter(
            (route) =>
              route.source === 'import' && visibleTripIds.has(route.tripId),
          )
          .map((route) => ({
            ...routeNode(route, 'view:imported'),
            detail: route.tripName,
          })),
        ...allTracks
          .filter(
            (track) =>
              track.source === 'import' && visibleTripIds.has(track.tripId),
          )
          .map((track) => ({
            ...trackNode(track, 'view:imported'),
            detail: track.tripName,
          })),
        ...allWaypoints
          .filter(
            (waypoint) =>
              waypoint.source === 'import' &&
              visibleTripIds.has(waypoint.tripId),
          )
          .map((waypoint) => ({
            ...waypointNode(waypoint, 'view:imported'),
            detail: waypoint.tripName,
          })),
      ];
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
