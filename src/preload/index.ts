import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { CHANNELS, EVENTS, type MenuAction } from '@shared/ipc/channels';
import type { TrailRtApi } from '@shared/ipc/api';
import type { UndoState } from '@shared/domain/types';
import type { ImportProgress } from '@shared/io/types';

/**
 * The context bridge surface.
 *
 * Every capability is a named method. There is deliberately no
 * `invoke(channel, args)` passthrough — that would hand the renderer the whole
 * IPC surface and make the restricted interface decorative. Adding a capability
 * means adding a method here and a validated handler in the main process.
 *
 * This file contains no logic beyond marshalling. See
 * `.kiro/steering/architecture.md`.
 */

const call = <T>(channel: string, payload?: unknown): Promise<T> =>
  ipcRenderer.invoke(channel, payload) as Promise<T>;

/**
 * Wraps a main → renderer event. The `unsubscribe` return is what lets React
 * effects clean up; without it, remounting would stack duplicate listeners.
 */
function subscribe<A extends unknown[]>(
  channel: string,
  listener: (...args: A) => void,
): () => void {
  const wrapped = (_event: unknown, ...args: unknown[]): void => {
    listener(...(args as A));
  };
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

const api: TrailRtApi = {
  library: {
    tree: (req) => call(CHANNELS.library.tree, req),
  },
  trips: {
    list: (req) => call(CHANNELS.trips.list, req),
    get: (req) => call(CHANNELS.trips.get, req),
    create: (req) => call(CHANNELS.trips.create, req),
    update: (req) => call(CHANNELS.trips.update, req),
    duplicate: (req) => call(CHANNELS.trips.duplicate, req),
    move: (req) => call(CHANNELS.trips.move, req),
    setStatus: (req) => call(CHANNELS.trips.setStatus, req),
    delete: (req) => call(CHANNELS.trips.delete, req),
    search: (req) => call(CHANNELS.trips.search, req),
  },
  folders: {
    list: () => call(CHANNELS.folders.list),
    get: (req) => call(CHANNELS.folders.get, req),
    create: (req) => call(CHANNELS.folders.create, req),
    rename: (req) => call(CHANNELS.folders.rename, req),
    move: (req) => call(CHANNELS.folders.move, req),
    delete: (req) => call(CHANNELS.folders.delete, req),
  },
  settings: {
    all: () => call(CHANNELS.settings.all),
    set: (req) => call(CHANNELS.settings.set, req),
  },
  backup: {
    list: () => call(CHANNELS.backup.list),
    create: () => call(CHANNELS.backup.create),
    createTo: () => call(CHANNELS.backup.createTo),
    restore: (req) => call(CHANNELS.backup.restore, req),
  },
  routes: {
    listForTrip: (req) => call(CHANNELS.routes.listForTrip, req),
    listAll: () => call(CHANNELS.routes.listAll),
    get: (req) => call(CHANNELS.routes.get, req),
    create: (req) => call(CHANNELS.routes.create, req),
    update: (req) => call(CHANNELS.routes.update, req),
    setGeometry: (req) => call(CHANNELS.routes.setGeometry, req),
    reverse: (req) => call(CHANNELS.routes.reverse, req),
    duplicate: (req) => call(CHANNELS.routes.duplicate, req),
    move: (req) => call(CHANNELS.routes.move, req),
    delete: (req) => call(CHANNELS.routes.delete, req),
  },
  waypoints: {
    listForTrip: (req) => call(CHANNELS.waypoints.listForTrip, req),
    listAll: () => call(CHANNELS.waypoints.listAll),
    get: (req) => call(CHANNELS.waypoints.get, req),
    create: (req) => call(CHANNELS.waypoints.create, req),
    update: (req) => call(CHANNELS.waypoints.update, req),
    move: (req) => call(CHANNELS.waypoints.move, req),
    duplicate: (req) => call(CHANNELS.waypoints.duplicate, req),
    moveToTrip: (req) => call(CHANNELS.waypoints.moveToTrip, req),
    delete: (req) => call(CHANNELS.waypoints.delete, req),
    search: (req) => call(CHANNELS.waypoints.search, req),
    groups: (req) => call(CHANNELS.waypoints.groups, req),
    createGroup: (req) => call(CHANNELS.waypoints.createGroup, req),
  },
  tracks: {
    listForTrip: (req) => call(CHANNELS.tracks.listForTrip, req),
    listAll: () => call(CHANNELS.tracks.listAll),
    get: (req) => call(CHANNELS.tracks.get, req),
    geometry: (req) => call(CHANNELS.tracks.geometry, req),
    update: (req) => call(CHANNELS.tracks.update, req),
    move: (req) => call(CHANNELS.tracks.move, req),
    reverse: (req) => call(CHANNELS.tracks.reverse, req),
    previewSimplify: (req) => call(CHANNELS.tracks.previewSimplify, req),
    simplify: (req) => call(CHANNELS.tracks.simplify, req),
    split: (req) => call(CHANNELS.tracks.split, req),
    join: (req) => call(CHANNELS.tracks.join, req),
    deleteRange: (req) => call(CHANNELS.tracks.deleteRange, req),
    delete: (req) => call(CHANNELS.tracks.delete, req),
    hasOriginal: (req) => call(CHANNELS.tracks.hasOriginal, req),
    restoreOriginal: (req) => call(CHANNELS.tracks.restoreOriginal, req),
  },
  importing: {
    choose: () => call(CHANNELS.importing.choose),
    /**
     * Resolves dropped `File` objects to paths and stages them.
     *
     * `webUtils.getPathForFile` is the only way to do this under
     * `sandbox: true` — `File.path` was removed in Electron 32. It lives here
     * rather than in the renderer precisely so the renderer never holds the
     * resulting string: the paths go straight to the main process and come
     * back as opaque tokens.
     */
    addDroppedFiles: (files) => {
      const paths = files
        .map((file) => webUtils.getPathForFile(file))
        .filter((path) => path.length > 0);
      if (paths.length === 0) {
        return Promise.resolve({
          ok: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Those items could not be read as files.',
          },
        });
      }
      return call(CHANNELS.importing.addPaths, { paths });
    },
    commit: (req) => call(CHANNELS.importing.commit, req),
    discard: (req) => call(CHANNELS.importing.discard, req),
    history: (req) => call(CHANNELS.importing.history, req),
    clearHistory: () => call(CHANNELS.importing.clearHistory),
  },
  exporting: {
    options: (req) => call(CHANNELS.exporting.options, req),
    run: (req) => call(CHANNELS.exporting.run, req),
  },
  geometry: {
    forTrip: (req) => call(CHANNELS.geometry.forTrip, req),
  },
  routing: {
    status: () => call(CHANNELS.routing.status),
    consentNotice: (req) => call(CHANNELS.routing.consentNotice, req),
    test: (req) => call(CHANNELS.routing.test, req),
    snap: (req) => call(CHANNELS.routing.snap, req),
    routeLeg: (req) => call(CHANNELS.routing.routeLeg, req),
    createSnapped: (req) => call(CHANNELS.routing.createSnapped, req),
    provenance: (req) => call(CHANNELS.routing.provenance, req),
    match: (req) => call(CHANNELS.routing.match, req),
    attributes: (req) => call(CHANNELS.routing.attributes, req),
    clearAttributes: (req) => call(CHANNELS.routing.clearAttributes, req),
    profile: (req) => call(CHANNELS.routing.profile, req),
    speedDistribution: (req) =>
      call(CHANNELS.routing.speedDistribution, req),
  },
  undo: {
    state: () => call(CHANNELS.undo.state),
    undo: () => call(CHANNELS.undo.undo),
    redo: () => call(CHANNELS.undo.redo),
    clear: () => call(CHANNELS.undo.clear),
  },
  app: {
    info: () => call(CHANNELS.app.info),
    licences: () => call(CHANNELS.app.licences),
    openExternal: (req) => call(CHANNELS.app.openExternal, req),
    savePng: (req) => call(CHANNELS.app.savePng, req),
  },
  events: {
    onMenuAction: (listener) =>
      subscribe<[MenuAction]>(EVENTS.menuAction, listener),
    onThemeChanged: (listener) =>
      subscribe<[boolean]>(EVENTS.themeChanged, listener),
    onLibraryChanged: (listener) =>
      subscribe<[]>(EVENTS.libraryChanged, listener),
    onUndoStateChanged: (listener) =>
      subscribe<[UndoState]>(EVENTS.undoStateChanged, listener),
    onImportProgress: (listener) =>
      subscribe<[ImportProgress]>(EVENTS.importProgress, listener),
  },
};

contextBridge.exposeInMainWorld('trailrt', api);
