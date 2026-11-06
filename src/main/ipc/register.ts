import { app, dialog } from 'electron';
import { CHANNELS } from '@shared/ipc/channels';
import type { AppInfo, LicenceEntry } from '@shared/ipc/api';
import * as S from '@shared/ipc/schemas';
import { ctx, reopenDatabase } from '../context';
import * as backupService from '../services/backupService';
import * as folderService from '../services/folderService';
import * as libraryService from '../services/libraryService';
import * as settingsService from '../services/settingsService';
import * as tripService from '../services/tripService';
import { openExternal } from '../security/navigation';
import { handle, handleNoArgs } from './handler';
import { RUNTIME_NOTICES, THIRD_PARTY_LICENCES } from '../licences';

const REPOSITORY_URL = 'https://github.com/trailrt/trailrt';

/**
 * Wires every channel. Handlers validate then delegate; they contain no
 * business logic of their own.
 *
 * `ctx().handle.db` is read at call time rather than captured, because
 * restoring a backup replaces the database handle.
 */
export function registerIpcHandlers(): void {
  // ------------------------------------------------------------- library
  handle(CHANNELS.library.tree, S.libraryTreeRequest, (req) =>
    libraryService.tree(ctx().handle.db, { includeArchived: req.includeArchived }),
  );

  // --------------------------------------------------------------- trips
  handle(CHANNELS.trips.list, S.tripListRequest, (req) =>
    tripService.list(ctx().handle.db, {
      folderId: req.folderId,
      includeArchived: req.includeArchived,
      sortKey: req.sortKey,
      sortDirection: req.sortDirection,
    }),
  );

  handle(CHANNELS.trips.get, S.tripGetRequest, (req) =>
    tripService.get(ctx().handle.db, req.id),
  );

  handle(CHANNELS.trips.create, S.tripCreateRequest, (req) => {
    const { result } = tripService.create(ctx().handle.db, req);
    ctx().notifyLibraryChanged();
    return result;
  });

  handle(CHANNELS.trips.update, S.tripUpdateRequest, (req) => {
    const { result } = tripService.update(ctx().handle.db, req);
    ctx().notifyLibraryChanged();
    return result;
  });

  handle(CHANNELS.trips.duplicate, S.tripDuplicateRequest, (req) => {
    const { result } = tripService.duplicate(ctx().handle.db, req.id);
    ctx().notifyLibraryChanged();
    return result;
  });

  handle(CHANNELS.trips.move, S.tripMoveRequest, (req) => {
    const { result } = tripService.move(ctx().handle.db, req);
    ctx().notifyLibraryChanged();
    return result;
  });

  handle(CHANNELS.trips.setStatus, S.tripSetStatusRequest, (req) => {
    const { result } = tripService.setStatus(ctx().handle.db, req);
    ctx().notifyLibraryChanged();
    return result;
  });

  handle(CHANNELS.trips.delete, S.tripDeleteRequest, (req) => {
    const { result } = tripService.remove(ctx().handle.db, req.id);
    ctx().notifyLibraryChanged();
    return result;
  });

  handle(CHANNELS.trips.search, S.tripSearchRequest, (req) =>
    tripService.search(ctx().handle.db, req.query),
  );

  // ------------------------------------------------------------- folders
  handleNoArgs(CHANNELS.folders.list, () => folderService.list(ctx().handle.db));

  handle(CHANNELS.folders.get, S.folderGetRequest, (req) =>
    folderService.get(ctx().handle.db, req.id),
  );

  handle(CHANNELS.folders.create, S.folderCreateRequest, (req) => {
    const { result } = folderService.create(ctx().handle.db, req);
    ctx().notifyLibraryChanged();
    return result;
  });

  handle(CHANNELS.folders.rename, S.folderRenameRequest, (req) => {
    const { result } = folderService.rename(ctx().handle.db, req);
    ctx().notifyLibraryChanged();
    return result;
  });

  handle(CHANNELS.folders.move, S.folderMoveRequest, (req) => {
    const { result } = folderService.move(ctx().handle.db, req);
    ctx().notifyLibraryChanged();
    return result;
  });

  handle(CHANNELS.folders.delete, S.folderDeleteRequest, (req) => {
    const { result } = folderService.remove(ctx().handle.db, req.id);
    ctx().notifyLibraryChanged();
    return result;
  });

  // ------------------------------------------------------------ settings
  handleNoArgs(CHANNELS.settings.all, () => settingsService.all(ctx().handle.db));

  handle(CHANNELS.settings.set, S.settingsSetRequest, (req) =>
    settingsService.set(ctx().handle.db, req.key, req.value),
  );

  // -------------------------------------------------------------- backup
  handleNoArgs(CHANNELS.backup.list, () =>
    backupService.listBackups(ctx().paths.backupsDir),
  );

  handleNoArgs(CHANNELS.backup.create, async () => {
    const current = ctx();
    const retention = settingsService.all(current.handle.db).backupRetention;
    return backupService.createBackup(
      current.handle,
      current.paths.backupsDir,
      retention,
    );
  });

  handleNoArgs(CHANNELS.backup.createTo, async () => {
    const current = ctx();
    const stamp = new Date().toISOString().slice(0, 10);
    const chosen = await dialog.showSaveDialog({
      title: 'Save a Copy',
      defaultPath: `TrailRT-${stamp}.db`,
      filters: [{ name: 'TrailRT database', extensions: ['db'] }],
    });
    if (chosen.canceled || chosen.filePath === undefined) {
      return { cancelled: true, path: null };
    }
    await backupService.createBackupAt(current.handle, chosen.filePath);
    return { cancelled: false, path: chosen.filePath };
  });

  handle(CHANNELS.backup.restore, S.backupRestoreRequest, async (req) => {
    const current = ctx();
    const retention = settingsService.all(current.handle.db).backupRetention;
    await backupService.restoreBackup({
      handle: current.handle,
      databaseFile: current.paths.databaseFile,
      backupsDir: current.paths.backupsDir,
      fileName: req.fileName,
      retention,
    });
    reopenDatabase();
    ctx().notifyLibraryChanged();
    return true as const;
  });

  // ----------------------------------------------------------------- app
  handleNoArgs(CHANNELS.app.info, (): AppInfo => ({
    name: 'TrailRT',
    version: app.getVersion(),
    licence: 'GPL-3.0-or-later',
    repositoryUrl: REPOSITORY_URL,
    electron: process.versions.electron ?? 'unknown',
    chrome: process.versions.chrome ?? 'unknown',
    node: process.versions.node,
  }));

  handleNoArgs(CHANNELS.app.licences, (): LicenceEntry[] => [
    ...THIRD_PARTY_LICENCES,
    ...RUNTIME_NOTICES,
  ]);

  handle(CHANNELS.app.openExternal, S.openExternalRequest, async (req) => {
    await openExternal(req.url);
    return true as const;
  });
}
