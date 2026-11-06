import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, EVENTS, type MenuAction } from '@shared/ipc/channels';
import type { TrailRtApi } from '@shared/ipc/api';

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
  app: {
    info: () => call(CHANNELS.app.info),
    licences: () => call(CHANNELS.app.licences),
    openExternal: (req) => call(CHANNELS.app.openExternal, req),
  },
  events: {
    onMenuAction: (listener) =>
      subscribe<[MenuAction]>(EVENTS.menuAction, listener),
    onThemeChanged: (listener) =>
      subscribe<[boolean]>(EVENTS.themeChanged, listener),
    onLibraryChanged: (listener) =>
      subscribe<[]>(EVENTS.libraryChanged, listener),
  },
};

contextBridge.exposeInMainWorld('trailrt', api);
