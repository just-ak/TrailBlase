import type {
  AppSettings,
  Folder,
  Route,
  RouteWithPoints,
  Track,
  TrackGeometry,
  TrackWithPoints,
  Trip,
  TreeNode,
  TripGeometry,
  TripWithCounts,
  UndoState,
  Waypoint,
  WaypointGroup,
} from '../domain/types';
import type {
  ExportFormat,
  ImportFormat,
  ImportHistoryEntry,
  ImportProgress,
  ImportReport,
  SkippedItem,
} from '../io/types';
import type { SpeedDistribution } from '../geo/speedBands';
import type { MatchedEdge } from '../routing/RoutingProvider';
import type {
  AttributeStatus,
  ConnectionTest,
  ConsentNotice,
  PreviewedLeg,
  Profile,
  RouteProvenance,
  RoutingStatus,
  SnapOutcome,
} from '../routing/results';
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
  tracks: {
    listForTrip(
      req: Req<typeof S.trackListForTripRequest>,
    ): Promise<Result<Track[]>>;
    listAll(): Promise<Result<TrackWithTrip[]>>;
    get(req: Req<typeof S.trackGetRequest>): Promise<Result<TrackWithPoints>>;
    /** Simplified or exact, depending on zoom. The response says which. */
    geometry(
      req: Req<typeof S.trackGeometryRequest>,
    ): Promise<Result<TrackGeometry>>;
    update(req: Req<typeof S.trackUpdateRequest>): Promise<Result<Track>>;
    move(req: Req<typeof S.trackMoveRequest>): Promise<Result<Track>>;
    reverse(
      req: Req<typeof S.trackReverseRequest>,
    ): Promise<Result<TrackWithPoints>>;
    /** The resulting point count, so the user sees it before applying. */
    previewSimplify(
      req: Req<typeof S.trackPreviewSimplifyRequest>,
    ): Promise<Result<{ before: number; after: number }>>;
    simplify(
      req: Req<typeof S.trackSimplifyRequest>,
    ): Promise<Result<TrackWithPoints>>;
    split(
      req: Req<typeof S.trackSplitRequest>,
    ): Promise<Result<{ first: TrackWithPoints; second: TrackWithPoints }>>;
    join(
      req: Req<typeof S.trackJoinRequest>,
    ): Promise<Result<TrackWithPoints>>;
    deleteRange(
      req: Req<typeof S.trackDeleteRangeRequest>,
    ): Promise<Result<TrackWithPoints>>;
    delete(
      req: Req<typeof S.trackDeleteRequest>,
    ): Promise<Result<{ id: string }>>;
    hasOriginal(
      req: Req<typeof S.trackHasOriginalRequest>,
    ): Promise<Result<{ hasOriginal: boolean; format: string | null }>>;
    restoreOriginal(
      req: Req<typeof S.trackRestoreOriginalRequest>,
    ): Promise<Result<TrackWithPoints>>;
  };
  importing: {
    /** Opens the file dialog in the main process and stages what was chosen. */
    choose(): Promise<Result<StagedImport[]>>;
    /**
     * Stages files from a drag-and-drop.
     *
     * Takes `File` objects, not paths: the bridge resolves them with
     * `webUtils.getPathForFile`, so the renderer never constructs a path.
     */
    addDroppedFiles(files: readonly File[]): Promise<Result<StagedImport[]>>;
    commit(
      req: Req<typeof S.importCommitRequest>,
    ): Promise<Result<ImportReport[]>>;
    discard(req: Req<typeof S.importDiscardRequest>): Promise<Result<true>>;
    history(
      req: Req<typeof S.importHistoryRequest>,
    ): Promise<Result<ImportHistoryEntry[]>>;
    clearHistory(): Promise<Result<{ removed: number }>>;
  };
  exporting: {
    /** Every writable format for a scope, each with its own loss list. */
    options(
      req: Req<typeof S.exportOptionsRequest>,
    ): Promise<Result<ExportFormatOption[]>>;
    /** Shows the save dialog and writes. Returns what happened, not a path. */
    run(req: Req<typeof S.exportRunRequest>): Promise<Result<ExportOutcome>>;
  };
  geometry: {
    forTrip(
      req: Req<typeof S.geometryForTripRequest>,
    ): Promise<Result<TripGeometry>>;
  };
  /**
   * Routing and road attributes.
   *
   * `status` and `consentNotice` are local reads so the UI can describe the
   * configuration without causing a request. `snap` and `match` are the only
   * two calls in the whole application that reach the network, and both refuse
   * with `CONSENT_REQUIRED` until the user has agreed to the configured host.
   */
  routing: {
    status(): Promise<Result<RoutingStatus>>;
    consentNotice(
      req: Req<typeof S.routingConsentNoticeRequest>,
    ): Promise<Result<ConsentNotice | null>>;
    /**
     * Routes two fixed sample points to prove an endpoint works. Sends none of
     * the user's geometry, so it is usable before consent is given.
     */
    test(
      req: Req<typeof S.routingTestRequest>,
    ): Promise<Result<ConnectionTest>>;
    snap(req: Req<typeof S.routingSnapRequest>): Promise<Result<SnapOutcome>>;
    /** One leg, no write. The interactive tool's per-click call. */
    routeLeg(
      req: Req<typeof S.routingRouteLegRequest>,
    ): Promise<Result<PreviewedLeg>>;
    createSnapped(
      req: Req<typeof S.routingCreateSnappedRequest>,
    ): Promise<Result<Route>>;
    provenance(
      req: Req<typeof S.routingProvenanceRequest>,
    ): Promise<Result<RouteProvenance>>;
    match(
      req: Req<typeof S.routingMatchRequest>,
    ): Promise<Result<AttributeStatus>>;
    attributes(
      req: Req<typeof S.routingAttributesRequest>,
    ): Promise<Result<{ status: AttributeStatus; edges: MatchedEdge[] } | null>>;
    clearAttributes(
      req: Req<typeof S.routingClearAttributesRequest>,
    ): Promise<Result<true>>;
    profile(req: Req<typeof S.routingProfileRequest>): Promise<Result<Profile>>;
    /**
     * Posted limits and recorded speeds are separate requests on purpose.
     * Null means the question cannot be answered for this geometry — no match
     * yet for `posted`, no timestamps for `recorded` — which is a different
     * answer from a distribution that is entirely Unknown.
     */
    speedDistribution(
      req: Req<typeof S.routingSpeedDistributionRequest>,
    ): Promise<
      Result<{
        distribution: SpeedDistribution;
        status: AttributeStatus | null;
      } | null>
    >;
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
    savePng(
      req: Req<typeof S.savePngRequest>,
    ): Promise<Result<{ cancelled: boolean; fileName: string | null }>>;
  };
  events: {
    /** Returns an unsubscribe function. */
    onMenuAction(listener: (action: MenuAction) => void): () => void;
    onThemeChanged(listener: (isDark: boolean) => void): () => void;
    onLibraryChanged(listener: () => void): () => void;
    onUndoStateChanged(listener: (state: UndoState) => void): () => void;
    onImportProgress(
      listener: (progress: ImportProgress) => void,
    ): () => void;
  };
}

/**
 * A file staged for import.
 *
 * `token` is opaque and `sourceName` is a basename: between them the renderer
 * can label the file and confirm the import without ever holding a path.
 */
export interface StagedImport {
  token: string;
  sourceName: string;
  preview: StagedPreview | null;
  /** Set when the file could not be parsed. Listed rather than hidden. */
  error: { message: string; detail?: string } | null;
}

export interface StagedPreview {
  sourceName: string;
  format: ImportFormat;
  counts: { routes: number; tracks: number; waypoints: number; points: number };
  routeNames: string[];
  trackNames: string[];
  waypointNames: string[];
  skipped: SkippedItem[];
  warnings: string[];
  unmappedMetadata: string[];
}

export interface ExportFormatOption {
  format: ExportFormat;
  label: string;
  extension: string;
  suggestedName: string;
  willWrite: { routes: number; tracks: number; waypoints: number };
  omitted: { routes: number; tracks: number; waypoints: number };
  /** Named losses, shown before the write rather than discovered after it. */
  losses: string[];
  empty: boolean;
}

export interface ExportOutcome {
  cancelled: boolean;
  /** Basename of what was written. Null when cancelled. */
  fileName: string | null;
  byteSize: number | null;
  losses: string[];
}

export interface TrackWithTrip extends Track {
  tripName: string;
}

/** Cross-trip listings carry the owning trip's name for the library views. */
export interface RouteWithTrip extends Route {
  tripName: string;
}

export interface WaypointWithTrip extends Waypoint {
  tripName: string;
}
