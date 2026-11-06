/**
 * Domain entity types shared by the main and renderer processes.
 *
 * This module is intentionally dependency-free. See
 * `.kiro/steering/architecture.md`.
 *
 * Conventions that hold throughout:
 * - Timestamps are UTC epoch milliseconds.
 * - Distances and elevations are metres (SI). Units are a display concern.
 * - `null` means genuinely absent. It is never a stand-in for zero.
 */

export type Id = string;

/** Epoch milliseconds, UTC. */
export type Timestamp = number;

export type TripStatus = 'active' | 'archived';

export interface Folder {
  id: Id;
  parentId: Id | null;
  name: string;
  sortOrder: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Trip {
  id: Id;
  folderId: Id | null;
  name: string;
  description: string | null;
  notes: string | null;
  status: TripStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** A trip plus the child counts the UI needs for labels and delete warnings. */
export interface TripWithCounts extends Trip {
  routeCount: number;
  trackCount: number;
  waypointCount: number;
}

/**
 * What the user currently has selected. Routes, tracks and waypoints are not
 * selectable until Phases 2 and 3, but the shape is fixed now so the properties
 * panel and map do not need reworking when they arrive.
 */
export type ObjectKind = 'folder' | 'trip' | 'route' | 'track' | 'waypoint';

export interface ObjectRef {
  kind: ObjectKind;
  id: Id;
}

/**
 * Library tree nodes.
 *
 * `folder` and `trip` are real containers. The `view` kind is a saved
 * cross-trip query rather than a storage location — see ADR 0004. A view node
 * reports whether the feature behind it exists yet, so the tree can say "later
 * phase" instead of rendering a misleading empty branch.
 */
export type TreeNodeKind = 'root' | 'folder' | 'trip' | 'view';

export type ViewId =
  | 'trips'
  | 'routes'
  | 'tracks'
  | 'waypoints'
  | 'imported'
  | 'recent';

export interface TreeNode {
  id: string;
  kind: TreeNodeKind;
  name: string;
  /** Present for `view` nodes only. */
  viewId?: ViewId;
  /** False when the backing feature arrives in a later phase. */
  available?: boolean;
  /** Present for `trip` nodes. */
  status?: TripStatus;
  children: TreeNode[];
}

export type ThemePreference = 'light' | 'dark' | 'system';
export type UnitSystem = 'metric' | 'imperial';
export type TripSortKey = 'name' | 'updatedAt' | 'createdAt';
export type SortDirection = 'asc' | 'desc';

export interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MapPosition {
  lat: number;
  lon: number;
  zoom: number;
}

export interface PanelLayout {
  libraryWidth: number;
  propertiesWidth: number;
  libraryVisible: boolean;
  propertiesVisible: boolean;
}

/**
 * Persisted application settings. Every field has a default in
 * `shared/domain/defaults.ts`, so a fresh database needs no seeding.
 */
export interface AppSettings {
  theme: ThemePreference;
  units: UnitSystem;
  mapProviderId: string;
  backupIntervalHours: number;
  backupRetention: number;
  /** Used for route duration estimates. Nothing is estimated without it. */
  planningSpeedKmh: number;
  tripSortKey: TripSortKey;
  tripSortDirection: SortDirection;
  panelLayout: PanelLayout;
  windowGeometry: WindowGeometry | null;
  mapPosition: MapPosition;
  expandedNodeIds: string[];
  showArchivedTrips: boolean;
}

export type SettingsKey = keyof AppSettings;
