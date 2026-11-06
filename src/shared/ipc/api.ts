import type {
  AppSettings,
  Folder,
  Route,
  RouteWithPoints,
  Trip,
  TreeNode,
  TripGeometry,
  TripWithCounts,
  UndoState,
  Waypoint,
  WaypointGroup,
} from '../domain/types';
import type { MenuAction } from './channels';
import type { Result } from './result';
import type * as S from './schemas';
import type { z } from 'zod';

/**
 * The exact surface the preload script exposes on `window.trailrt`.
 *
 * Both processes compile against this, so the bridge, the handlers and the
 * renderer client cannot drift apart without a type error. Note there is no
 * generic `invoke(channel, args)` — every capability is named, which is what
 * makes the restricted IPC surface meaningful rather than decorative.
 */

export interface AppInfo {
  name: string;
  version: string;
  licence: string;
  repositoryUrl: string;
  electron: string;
  chrome: string;
  node: string;
}

export interface LicenceEntry {
  name: string;
  version: string;
  licence: string;
}

export interface BackupEntry {
  fileName: string;
  createdAt: number;
  byteSize: number;
}

export interface DeleteTripResult {
  id: string;
  routeCount: number;
  trackCount: number;
  waypointCount: number;
}

export interface DeleteFolderResult {
  id: string;
  tripCount: number;
  folderCount: number;
}

type Req<T extends z.ZodType> = z.input<T>;

export interface TrailRtApi {
  library: {
    tree(req: Req<typeof S.libraryTreeRequest>): Promise<Result<TreeNode>>;
  };
  trips: {
    list(req: Req<typeof S.tripListRequest>): Promise<Result<TripWithCounts[]>>;
    get(req: Req<typeof S.tripGetRequest>): Promise<Result<TripWithCounts>>;
    create(req: Req<typeof S.tripCreateRequest>): Promise<Result<Trip>>;
    update(req: Req<typeof S.tripUpdateRequest>): Promise<Result<Trip>>;
    duplicate(req: Req<typeof S.tripDuplicateRequest>): Promise<Result<Trip>>;
    move(req: Req<typeof S.tripMoveRequest>): Promise<Result<Trip>>;
    setStatus(req: Req<typeof S.tripSetStatusRequest>): Promise<Result<Trip>>;
    delete(
      req: Req<typeof S.tripDeleteRequest>,
    ): Promise<Result<DeleteTripResult>>;
    search(
      req: Req<typeof S.tripSearchRequest>,
    ): Promise<Result<TripWithCounts[]>>;
  };
  folders: {
    list(): Promise<Result<Folder[]>>;
    get(req: Req<typeof S.folderGetRequest>): Promise<Result<Folder>>;
    create(req: Req<typeof S.folderCreateRequest>): Promise<Result<Folder>>;
    rename(req: Req<typeof S.folderRenameRequest>): Promise<Result<Folder>>;
    move(req: Req<typeof S.folderMoveRequest>): Promise<Result<Folder>>;
    delete(
      req: Req<typeof S.folderDeleteRequest>,
    ): Promise<Result<DeleteFolderResult>>;
  };
  settings: {
    all(): Promise<Result<AppSettings>>;
    set(req: Req<typeof S.settingsSetRequest>): Promise<Result<AppSettings>>;
  };
  backup: {
    list(): Promise<Result<BackupEntry[]>>;
    create(): Promise<Result<BackupEntry>>;
    createTo(): Promise<Result<{ cancelled: boolean; path: string | null }>>;
    restore(req: Req<typeof S.backupRestoreRequest>): Promise<Result<true>>;
  };
  routes: {
    listForTrip(
      req: Req<typeof S.routeListForTripRequest>,
    ): Promise<Result<Route[]>>;
    listAll(): Promise<Result<RouteWithTrip[]>>;
    get(req: Req<typeof S.routeGetRequest>): Promise<Result<RouteWithPoints>>;
    create(req: Req<typeof S.routeCreateRequest>): Promise<Result<Route>>;
    update(req: Req<typeof S.routeUpdateRequest>): Promise<Result<Route>>;
    setGeometry(
      req: Req<typeof S.routeSetGeometryRequest>,
    ): Promise<Result<Route>>;
    reverse(req: Req<typeof S.routeReverseRequest>): Promise<Result<Route>>;
    duplicate(req: Req<typeof S.routeDuplicateRequest>): Promise<Result<Route>>;
    move(req: Req<typeof S.routeMoveRequest>): Promise<Result<Route>>;
    delete(req: Req<typeof S.routeDeleteRequest>): Promise<Result<{ id: string }>>;
  };
  waypoints: {
    listForTrip(
      req: Req<typeof S.waypointListForTripRequest>,
    ): Promise<Result<Waypoint[]>>;
    listAll(): Promise<Result<WaypointWithTrip[]>>;
    get(req: Req<typeof S.waypointGetRequest>): Promise<Result<Waypoint>>;
    create(req: Req<typeof S.waypointCreateRequest>): Promise<Result<Waypoint>>;
    update(req: Req<typeof S.waypointUpdateRequest>): Promise<Result<Waypoint>>;
    move(req: Req<typeof S.waypointMoveRequest>): Promise<Result<Waypoint>>;
    duplicate(
      req: Req<typeof S.waypointDuplicateRequest>,
    ): Promise<Result<Waypoint>>;
    moveToTrip(
      req: Req<typeof S.waypointMoveToTripRequest>,
    ): Promise<Result<Waypoint>>;
    delete(
      req: Req<typeof S.waypointDeleteRequest>,
    ): Promise<Result<{ id: string }>>;
    search(
      req: Req<typeof S.waypointSearchRequest>,
    ): Promise<Result<WaypointWithTrip[]>>;
    groups(
      req: Req<typeof S.waypointGroupsRequest>,
    ): Promise<Result<WaypointGroup[]>>;
    createGroup(
      req: Req<typeof S.waypointCreateGroupRequest>,
    ): Promise<Result<WaypointGroup>>;
  };
  geometry: {
    forTrip(
      req: Req<typeof S.geometryForTripRequest>,
    ): Promise<Result<TripGeometry>>;
  };
  undo: {
    state(): Promise<Result<UndoState>>;
    undo(): Promise<Result<UndoState>>;
    redo(): Promise<Result<UndoState>>;
    clear(): Promise<Result<UndoState>>;
  };
  app: {
    info(): Promise<Result<AppInfo>>;
    licences(): Promise<Result<LicenceEntry[]>>;
    openExternal(req: Req<typeof S.openExternalRequest>): Promise<Result<true>>;
  };
  events: {
    /** Returns an unsubscribe function. */
    onMenuAction(listener: (action: MenuAction) => void): () => void;
    onThemeChanged(listener: (isDark: boolean) => void): () => void;
    onLibraryChanged(listener: () => void): () => void;
    onUndoStateChanged(listener: (state: UndoState) => void): () => void;
  };
}

/** Cross-trip listings carry the owning trip's name for the library views. */
export interface RouteWithTrip extends Route {
  tripName: string;
}

export interface WaypointWithTrip extends Waypoint {
  tripName: string;
}
