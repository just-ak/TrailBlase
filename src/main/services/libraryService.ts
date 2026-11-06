import type { Folder, TreeNode, TripWithCounts, ViewId } from '@shared/domain/types';
import type { Db } from '../db/client';
import * as folderService from './folderService';
import * as tripService from './tripService';

/**
 * Builds the library tree.
 *
 * Folders and trips are real containers. The Routes / Tracks / Waypoints /
 * Imported Data / Recently Used nodes are **saved views** — cross-trip queries,
 * not storage locations. See ADR 0004.
 *
 * A view whose backing feature arrives in a later phase is marked
 * `available: false` so the UI can say so explicitly, rather than rendering an
 * empty branch that looks broken. Requirement 4.2.
 */

interface ViewSpec {
  id: ViewId;
  name: string;
  /** False until the phase that implements it lands. */
  available: boolean;
}

const VIEWS: readonly ViewSpec[] = [
  { id: 'trips', name: 'Trips', available: true },
  { id: 'routes', name: 'Routes', available: false }, // Phase 2
  { id: 'tracks', name: 'Tracks', available: false }, // Phase 3
  { id: 'waypoints', name: 'Waypoints', available: false }, // Phase 2
  { id: 'imported', name: 'Imported Data', available: false }, // Phase 3
  { id: 'recent', name: 'Recently Used', available: false }, // Phase 2
];

function tripNode(trip: TripWithCounts): TreeNode {
  return {
    id: `trip:${trip.id}`,
    kind: 'trip',
    name: trip.name,
    status: trip.status,
    children: [],
  };
}

function buildFolderSubtree(
  folder: Folder,
  byParent: Map<string | null, Folder[]>,
  tripsByFolder: Map<string | null, TripWithCounts[]>,
): TreeNode {
  const childFolders = byParent.get(folder.id) ?? [];
  const childTrips = tripsByFolder.get(folder.id) ?? [];

  return {
    id: `folder:${folder.id}`,
    kind: 'folder',
    name: folder.name,
    children: [
      ...childFolders.map((f) => buildFolderSubtree(f, byParent, tripsByFolder)),
      ...childTrips.map(tripNode),
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

  const byParent = new Map<string | null, Folder[]>();
  for (const folder of folders) {
    const key = folder.parentId;
    const bucket = byParent.get(key);
    if (bucket === undefined) byParent.set(key, [folder]);
    else bucket.push(folder);
  }

  const tripsByFolder = new Map<string | null, TripWithCounts[]>();
  for (const trip of trips) {
    const key = trip.folderId;
    const bucket = tripsByFolder.get(key);
    if (bucket === undefined) tripsByFolder.set(key, [trip]);
    else bucket.push(trip);
  }

  const rootFolders = byParent.get(null) ?? [];
  const rootTrips = tripsByFolder.get(null) ?? [];

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
        ...rootFolders.map((f) => buildFolderSubtree(f, byParent, tripsByFolder)),
        ...rootTrips.map(tripNode),
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
