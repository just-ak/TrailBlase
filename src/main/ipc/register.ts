import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { app, dialog } from 'electron';
import { CHANNELS } from '@shared/ipc/channels';
import type { AppInfo, LicenceEntry } from '@shared/ipc/api';
import type { TrackSegment, UndoState } from '@shared/domain/types';
import { IMPORT_FORMATS } from '@shared/io/types';
import * as S from '@shared/ipc/schemas';
import { EVENTS } from '@shared/ipc/channels';
import { ctx, reopenDatabase } from '../context';
import * as historyRepo from '../db/repositories/importHistory';
import * as exportService from '../io/exportService';
import * as importService from '../io/importService';
import * as importSession from '../io/importSession';
import { readGpx } from '../io/gpx/read';
import { readKml } from '../io/kml/read';
import { readTcx } from '../io/tcx/read';
import { readCsv } from '../io/csv/read';
import { ServiceError } from '../services/errors';
import * as trackService from '../services/trackService';
import * as backupService from '../services/backupService';
import * as folderService from '../services/folderService';
import type { Mutation } from '../services/folderService';
import * as geometryService from '../services/geometryService';
import * as libraryService from '../services/libraryService';
import * as profileService from '../services/profileService';
import * as providerService from '../services/providerService';
import * as roadAttributeService from '../services/roadAttributeService';
import * as routeService from '../services/routeService';
import * as routingService from '../services/routingService';
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
 * Re-reads the retained original bytes of a track to recover its geometry.
 *
 * Only the synchronous text formats are handled. KMZ and FIT are async, and
 * threading a promise through `restoreOriginal` would make the whole mutation
 * path async for one recovery case — so those are refused with an explanation
 * rather than half-supported. Re-importing the file is the alternative, and it
 * works today.
 */
function reparseTrackSegments(
  format: string,
  bytes: Uint8Array,
): readonly TrackSegment[] {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const source = `original.${format}`;

  const parsed = (() => {
    switch (format) {
      case 'gpx':
        return readGpx(text, source);
      case 'kml':
        return readKml(text, source);
      case 'tcx':
        return readTcx(text, source);
      case 'csv':
        return readCsv(text, source);
      default:
        throw new ServiceError(
          'INVALID_REQUEST',
          `Restoring from a retained ${format.toUpperCase()} file is not supported yet. Import the file again instead.`,
        );
    }
  })();

  return parsed.tracks.flatMap((track) =>
    track.segments.map((segment) => ({
      points: segment.points.map((point) => ({
        lat: point.lat,
        lon: point.lon,
        ele: point.ele,
        time: point.time,
      })),
    })),
  );
}

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
    libraryService.tree(ctx().handle.db, {
      includeArchived: req.includeArchived,
      sortKey: req.sortKey,
    }),
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

  // --------------------------------------------------------------- tracks
  handle(CHANNELS.tracks.listForTrip, S.trackListForTripRequest, (req) =>
    trackService.listForTrip(ctx().handle.db, req.tripId),
  );

  handleNoArgs(CHANNELS.tracks.listAll, () =>
    trackService.listAll(ctx().handle.db),
  );

  handle(CHANNELS.tracks.get, S.trackGetRequest, (req) =>
    trackService.get(ctx().handle.db, req.id),
  );

  handle(CHANNELS.tracks.geometry, S.trackGeometryRequest, (req) =>
    trackService.geometryFor(ctx().handle.db, req.id, req.zoom),
  );

  handle(CHANNELS.tracks.update, S.trackUpdateRequest, (req) =>
    commit(trackService.update(ctx().handle.db, req)),
  );

  handle(CHANNELS.tracks.move, S.trackMoveRequest, (req) =>
    commit(trackService.moveToTrip(ctx().handle.db, req)),
  );

  handle(CHANNELS.tracks.reverse, S.trackReverseRequest, (req) =>
    commit(trackService.reverse(ctx().handle.db, req.id)),
  );

  // Read-only: the preview exists so the user sees the cost before agreeing to
  // it, so it must not record anything on the undo stack.
  handle(CHANNELS.tracks.previewSimplify, S.trackPreviewSimplifyRequest, (req) =>
    trackService.previewSimplify(ctx().handle.db, req.id, req.toleranceM),
  );

  handle(CHANNELS.tracks.simplify, S.trackSimplifyRequest, (req) =>
    commit(trackService.simplifyTrack(ctx().handle.db, req.id, req.toleranceM)),
  );

  handle(CHANNELS.tracks.split, S.trackSplitRequest, (req) =>
    commit(trackService.split(ctx().handle.db, req.id, req.pointIndex)),
  );

  handle(CHANNELS.tracks.join, S.trackJoinRequest, (req) =>
    commit(trackService.join(ctx().handle.db, req)),
  );

  handle(CHANNELS.tracks.deleteRange, S.trackDeleteRangeRequest, (req) =>
    commit(
      trackService.deletePointRange(ctx().handle.db, req.id, req.from, req.to),
    ),
  );

  handle(CHANNELS.tracks.delete, S.trackDeleteRequest, (req) =>
    commit(trackService.remove(ctx().handle.db, req.id)),
  );

  handle(CHANNELS.tracks.hasOriginal, S.trackHasOriginalRequest, (req) => {
    const original = trackService.originalBytes(ctx().handle.db, req.id);
    return original === null
      ? { hasOriginal: false, format: null }
      : { hasOriginal: true, format: original.format };
  });

  handle(
    CHANNELS.tracks.restoreOriginal,
    S.trackRestoreOriginalRequest,
    (req) =>
      commit(
        trackService.restoreOriginal(
          ctx().handle.db,
          req.id,
          reparseTrackSegments,
        ),
      ),
  );

  // --------------------------------------------------------------- import
  handleNoArgs(CHANNELS.importing.choose, async () => {
    const chosen = await dialog.showOpenDialog({
      title: 'Import',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'All supported',
          extensions: [...IMPORT_FORMATS],
        },
        { name: 'GPX', extensions: ['gpx'] },
        { name: 'KML / KMZ', extensions: ['kml', 'kmz'] },
        { name: 'TCX', extensions: ['tcx'] },
        { name: 'FIT', extensions: ['fit'] },
        { name: 'CSV', extensions: ['csv'] },
        { name: 'TrailRT collection', extensions: ['json'] },
      ],
    });
    if (chosen.canceled) return [];
    return importSession.stageFiles(chosen.filePaths);
  });

  // Paths here come from `webUtils.getPathForFile` in the preload bridge, so
  // they originate from a real drag-and-drop rather than renderer-side string
  // construction.
  handle(CHANNELS.importing.addPaths, S.importAddPathsRequest, (req) =>
    importSession.stageFiles(req.paths),
  );

  handle(CHANNELS.importing.commit, S.importCommitRequest, async (req) => {
    const reports = await importSession.commitStaged(
      ctx().handle.db,
      req.files,
      (progress) => sendToRenderer(EVENTS.importProgress, progress),
    );
    // An import is not undoable — it can write hundreds of thousands of rows —
    // so the stack is left alone and the library is simply refreshed. Deleting
    // the imported trip is the documented way back.
    ctx().notifyLibraryChanged();
    return reports;
  });

  handle(CHANNELS.importing.discard, S.importDiscardRequest, (req) => {
    importSession.discard(req.tokens);
    return true as const;
  });

  handle(CHANNELS.importing.history, S.importHistoryRequest, (req) =>
    importService.listHistory(ctx().handle.db, req.limit),
  );

  handleNoArgs(CHANNELS.importing.clearHistory, () => ({
    removed: historyRepo.clear(ctx().handle.db),
  }));

  // --------------------------------------------------------------- export
  handle(CHANNELS.exporting.options, S.exportOptionsRequest, (req) =>
    exportService.formatOptions(ctx().handle.db, req.scope),
  );

  handle(CHANNELS.exporting.run, S.exportRunRequest, async (req) => {
    const db = ctx().handle.db;
    // Built before the dialog opens so an unwritable combination is refused
    // before the user has picked a filename.
    const result = await exportService.exportScope(db, req.scope, req.format);

    if (result.plan.empty) {
      throw new ServiceError(
        'INVALID_REQUEST',
        `There is nothing ${req.format.toUpperCase()} can carry in this selection.`,
      );
    }

    const chosen = await dialog.showSaveDialog({
      title: 'Export',
      defaultPath: `${result.plan.suggestedName}.${result.plan.extension}`,
      filters: [
        { name: req.format.toUpperCase(), extensions: [result.plan.extension] },
      ],
    });

    if (chosen.canceled || chosen.filePath === undefined) {
      return {
        cancelled: true,
        fileName: null,
        byteSize: null,
        losses: result.plan.losses,
      };
    }

    const payload =
      result.bytes ?? Buffer.from(result.text ?? '', 'utf8');
    await writeFile(chosen.filePath, payload);

    return {
      cancelled: false,
      // Basename only: the renderer gets a label to display, not a location.
      fileName: basename(chosen.filePath),
      byteSize: payload.byteLength,
      losses: result.plan.losses,
    };
  });

  // ------------------------------------------------------------- geometry
  handle(CHANNELS.geometry.forTrip, S.geometryForTripRequest, (req) =>
    geometryService.forTrip(ctx().handle.db, req.tripId),
  );

  // -------------------------------------------------------------- routing
  /*
   * The only handlers in the application that can cause an outbound request.
   *
   * `providerService.requireProvider` is the gate: it resolves the endpoint,
   * re-validates the origin and refuses until consent has been given. Every
   * network-touching handler below calls it first, so the consent check cannot
   * be bypassed by reaching a service directly.
   */
  handleNoArgs(CHANNELS.routing.status, () =>
    providerService.status(ctx().handle.db),
  );

  handle(
    CHANNELS.routing.consentNotice,
    S.routingConsentNoticeRequest,
    (req) => providerService.consentNotice(req.endpoint),
  );

  handle(CHANNELS.routing.snap, S.routingSnapRequest, async (req) => {
    const db = ctx().handle.db;
    const { provider, mode } = providerService.requireProvider(db);

    const mutation = await routingService.snapRoute(db, {
      routeId: req.routeId,
      provider,
      // An explicit mode in the request wins over the stored preference, so
      // the snap button can offer a one-off mode without writing a setting.
      mode: req.mode ?? mode,
      controlPoints: req.controlPoints,
    });

    /*
     * The road-attribute cache is dropped rather than left to go stale.
     *
     * A snap replaces the geometry, so the cached edges now describe a line
     * that no longer exists. `geometry_hash` would catch that on the next read
     * and report it stale, but a stale cache for geometry that was *just*
     * replaced is noise: the honest state is "not matched yet".
     */
    roadAttributeService.clear(db, 'route', req.routeId);

    return commit(mutation);
  });

  handle(CHANNELS.routing.provenance, S.routingProvenanceRequest, (req) =>
    routingService.provenance(ctx().handle.db, req.routeId),
  );

  handle(CHANNELS.routing.match, S.routingMatchRequest, async (req) => {
    const db = ctx().handle.db;
    const { provider, mode } = providerService.requireProvider(db);

    return roadAttributeService.match(db, {
      ownerType: req.ownerType,
      ownerId: req.ownerId,
      provider,
      mode: req.mode ?? mode,
      force: req.force,
    });
  });

  handle(CHANNELS.routing.attributes, S.routingAttributesRequest, (req) =>
    roadAttributeService.cached(ctx().handle.db, req.ownerType, req.ownerId),
  );

  handle(
    CHANNELS.routing.clearAttributes,
    S.routingClearAttributesRequest,
    (req) => {
      roadAttributeService.clear(ctx().handle.db, req.ownerType, req.ownerId);
      return true as const;
    },
  );

  handle(CHANNELS.routing.profile, S.routingProfileRequest, (req) =>
    profileService.profileFor(ctx().handle.db, {
      ownerType: req.ownerType,
      ownerId: req.ownerId,
      maxSamples: req.maxSamples,
    }),
  );

  handle(
    CHANNELS.routing.speedDistribution,
    S.routingSpeedDistributionRequest,
    (req) => {
      const db = ctx().handle.db;
      const units = settingsService.all(db).units;

      if (req.source === 'posted') {
        return roadAttributeService.postedDistribution(
          db,
          req.ownerType,
          req.ownerId,
          units,
        );
      }

      // Recorded speed is a property of a recording. A route is a plan and has
      // none, which is refused rather than answered with an empty chart.
      if (req.ownerType !== 'track') {
        throw new ServiceError(
          'INVALID_REQUEST',
          'A route has no recorded speed. It is a plan, not a recording.',
        );
      }

      const distribution = roadAttributeService.recordedDistribution(
        db,
        req.ownerId,
        units,
      );
      return distribution === null ? null : { distribution, status: null };
    },
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

  handle(CHANNELS.app.savePng, S.savePngRequest, async (req) => {
    /*
     * Validated as base64 before it is decoded.
     *
     * `Buffer.from(x, 'base64')` silently skips anything outside the alphabet,
     * so a malformed payload would be written as a short, corrupt file rather
     * than refused. Checking first means the failure is a message instead of a
     * broken image on disk.
     */
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(req.base64)) {
      throw new ServiceError(
        'INVALID_REQUEST',
        'That image data was not valid, so nothing was written.',
      );
    }

    const bytes = Buffer.from(req.base64, 'base64');

    const chosen = await dialog.showSaveDialog({
      title: 'Save image',
      defaultPath: `${req.suggestedName}.png`,
      filters: [{ name: 'PNG image', extensions: ['png'] }],
    });

    if (chosen.canceled || chosen.filePath === undefined) {
      return { cancelled: true as const, fileName: null };
    }

    await writeFile(chosen.filePath, bytes);
    // Basename only: a label to display, not a location.
    return { cancelled: false as const, fileName: basename(chosen.filePath) };
  });
}
