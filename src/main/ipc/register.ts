import { app, dialog } from 'electron';
import { CHANNELS } from '@shared/ipc/channels';
import type { AppInfo, LicenceEntry } from '@shared/ipc/api';
import type { UndoState } from '@shared/domain/types';
import * as S from '@shared/ipc/schemas';
import { EVENTS } from '@shared/ipc/channels';
import { ctx, reopenDatabase } from '../context';
import * as backupService from '../services/backupService';
import * as folderService from '../services/folderService';
import type { Mutation } from '../services/folderService';
import * as geometryService from '../services/geometryService';
import * as libraryService from '../services/libraryService';
import * as routeService from '../services/routeService';
import * as settingsService from '../services/settingsService';
import * as tripService from '../services/tripService';
import * as undoService from '../services/undoService';
import * as waypointService from '../services/waypointService';
import { openExternal } from '../security/navigation';
import { installApplicationMenu } from '../menu/appMenu';
import { sendToRenderer } from '../window';
import { handle, handleNoArgs } from './handler';
import { RUNTIME_NOTICES, THIRD_PARTY_LICENCES } from '../licences';

const REPOSITORY_URL = 'https://github.com/trailrt/trailrt';

/**
 * Records a mutation's inverse on the undo stack, tells the renderer the
 * library changed, and pushes the new undo state so the Edit menu can update.
 *
 * Every mutating handler goes through this, which is what guarantees the stack
 * and the menu cannot fall out of step with the database.
 */
function commit<T>(mutation: Mutation<T>): T {
  undoService.record(mutation.inverse);
  ctx().notifyLibraryChanged();
  publishUndoState(undoService.state());
  return mutation.result;
}

/**
 * Tells the renderer and rebuilds the native menu.
 *
 * The Edit menu labels itself with what it will reverse, and Electron menus are
 * immutable once built, so a change in the stack means rebuilding. Doing both
 * from one function is what keeps the menu from drifting out of step.
 */
function publishUndoState(state: UndoState): void {
  sendToRenderer(EVENTS.undoStateChanged, state);
  installApplicationMenu(state);
}

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

  handle(CHANNELS.trips.create, S.tripCreateRequest, (req) =>
    commit(tripService.create(ctx().handle.db, req)));

  handle(CHANNELS.trips.update, S.tripUpdateRequest, (req) =>
    commit(tripService.update(ctx().handle.db, req)));

  handle(CHANNELS.trips.duplicate, S.tripDuplicateRequest, (req) =>
    commit(tripService.duplicate(ctx().handle.db, req.id)));

  handle(CHANNELS.trips.move, S.tripMoveRequest, (req) =>
    commit(tripService.move(ctx().handle.db, req)));

  handle(CHANNELS.trips.setStatus, S.tripSetStatusRequest, (req) =>
    commit(tripService.setStatus(ctx().handle.db, req)));

  handle(CHANNELS.trips.delete, S.tripDeleteRequest, (req) =>
    commit(tripService.remove(ctx().handle.db, req.id)));

  handle(CHANNELS.trips.search, S.tripSearchRequest, (req) =>
    tripService.search(ctx().handle.db, req.query),
  );

  // ------------------------------------------------------------- folders
  handleNoArgs(CHANNELS.folders.list, () => folderService.list(ctx().handle.db));

  handle(CHANNELS.folders.get, S.folderGetRequest, (req) =>
    folderService.get(ctx().handle.db, req.id),
  );

  handle(CHANNELS.folders.create, S.folderCreateRequest, (req) =>
    commit(folderService.create(ctx().handle.db, req)));

  handle(CHANNELS.folders.rename, S.folderRenameRequest, (req) =>
    commit(folderService.rename(ctx().handle.db, req)));

  handle(CHANNELS.folders.move, S.folderMoveRequest, (req) =>
    commit(folderService.move(ctx().handle.db, req)));

  handle(CHANNELS.folders.delete, S.folderDeleteRequest, (req) =>
    commit(folderService.remove(ctx().handle.db, req.id)));

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
    // The undo stack describes a database that no longer exists. Applying any
    // of it would corrupt the restored data, so it is discarded.
    const undoState = undoService.clear();
    ctx().notifyLibraryChanged();
    publishUndoState(undoState);
    return true as const;
  });

  // -------------------------------------------------------------- routes
  handle(CHANNELS.routes.listForTrip, S.routeListForTripRequest, (req) =>
    routeService.listForTrip(ctx().handle.db, req.tripId),
  );

  handleNoArgs(CHANNELS.routes.listAll, () =>
    routeService.listAll(ctx().handle.db),
  );

  handle(CHANNELS.routes.get, S.routeGetRequest, (req) =>
    routeService.get(ctx().handle.db, req.id),
  );

  handle(CHANNELS.routes.create, S.routeCreateRequest, (req) =>
    commit(routeService.create(ctx().handle.db, req)),
  );

  handle(CHANNELS.routes.update, S.routeUpdateRequest, (req) =>
    commit(routeService.update(ctx().handle.db, req)),
  );

  handle(CHANNELS.routes.setGeometry, S.routeSetGeometryRequest, (req) =>
    commit(routeService.setGeometry(ctx().handle.db, req)),
  );

  handle(CHANNELS.routes.reverse, S.routeReverseRequest, (req) =>
    commit(routeService.reverse(ctx().handle.db, req.id)),
  );

  handle(CHANNELS.routes.duplicate, S.routeDuplicateRequest, (req) =>
    commit(routeService.duplicate(ctx().handle.db, req.id)),
  );

  handle(CHANNELS.routes.move, S.routeMoveRequest, (req) =>
    commit(routeService.moveToTrip(ctx().handle.db, req)),
  );

  handle(CHANNELS.routes.delete, S.routeDeleteRequest, (req) =>
    commit(routeService.remove(ctx().handle.db, req.id)),
  );

  // ------------------------------------------------------------ waypoints
  handle(CHANNELS.waypoints.listForTrip, S.waypointListForTripRequest, (req) =>
    waypointService.listForTrip(ctx().handle.db, req.tripId),
  );

  handleNoArgs(CHANNELS.waypoints.listAll, () =>
    waypointService.listAll(ctx().handle.db),
  );

  handle(CHANNELS.waypoints.get, S.waypointGetRequest, (req) =>
    waypointService.get(ctx().handle.db, req.id),
  );

  handle(CHANNELS.waypoints.create, S.waypointCreateRequest, (req) =>
    commit(waypointService.create(ctx().handle.db, req)),
  );

  handle(CHANNELS.waypoints.update, S.waypointUpdateRequest, (req) =>
    commit(waypointService.update(ctx().handle.db, req)),
  );

  handle(CHANNELS.waypoints.move, S.waypointMoveRequest, (req) =>
    commit(waypointService.move(ctx().handle.db, req)),
  );

  handle(CHANNELS.waypoints.duplicate, S.waypointDuplicateRequest, (req) =>
    commit(waypointService.duplicate(ctx().handle.db, req.id)),
  );

  handle(CHANNELS.waypoints.moveToTrip, S.waypointMoveToTripRequest, (req) =>
    commit(waypointService.moveToTrip(ctx().handle.db, req)),
  );

  handle(CHANNELS.waypoints.delete, S.waypointDeleteRequest, (req) =>
    commit(waypointService.remove(ctx().handle.db, req.id)),
  );

  handle(CHANNELS.waypoints.search, S.waypointSearchRequest, (req) =>
    waypointService.search(ctx().handle.db, req.query),
  );

  handle(CHANNELS.waypoints.groups, S.waypointGroupsRequest, (req) =>
    waypointService.groups(ctx().handle.db, req.tripId),
  );

  handle(CHANNELS.waypoints.createGroup, S.waypointCreateGroupRequest, (req) =>
    commit(waypointService.createGroup(ctx().handle.db, req)),
  );

  // ------------------------------------------------------------- geometry
  handle(CHANNELS.geometry.forTrip, S.geometryForTripRequest, (req) =>
    geometryService.forTrip(ctx().handle.db, req.tripId),
  );

  // ----------------------------------------------------------------- undo
  handleNoArgs(CHANNELS.undo.state, () => undoService.state());

  handleNoArgs(CHANNELS.undo.undo, () => {
    const next = undoService.undo(ctx().handle.db);
    ctx().notifyLibraryChanged();
    publishUndoState(next);
    return next;
  });

  handleNoArgs(CHANNELS.undo.redo, () => {
    const next = undoService.redo(ctx().handle.db);
    ctx().notifyLibraryChanged();
    publishUndoState(next);
    return next;
  });

  handleNoArgs(CHANNELS.undo.clear, () => {
    const next = undoService.clear();
    publishUndoState(next);
    return next;
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
