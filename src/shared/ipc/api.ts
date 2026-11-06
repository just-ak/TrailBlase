import type {
  AppSettings,
  Folder,
  Trip,
  TreeNode,
  TripWithCounts,
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
  };
}
