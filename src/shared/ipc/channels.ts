/**
 * IPC channel names. The renderer never sees these strings — the preload bridge
 * exposes named methods instead, so there is no generic passthrough to abuse.
 */
export const CHANNELS = {
  library: {
    tree: 'library:tree',
  },
  trips: {
    list: 'trips:list',
    get: 'trips:get',
    create: 'trips:create',
    update: 'trips:update',
    duplicate: 'trips:duplicate',
    move: 'trips:move',
    setStatus: 'trips:setStatus',
    delete: 'trips:delete',
    search: 'trips:search',
  },
  folders: {
    list: 'folders:list',
    get: 'folders:get',
    create: 'folders:create',
    rename: 'folders:rename',
    move: 'folders:move',
    delete: 'folders:delete',
  },
  settings: {
    all: 'settings:all',
    set: 'settings:set',
  },
  backup: {
    list: 'backup:list',
    create: 'backup:create',
    createTo: 'backup:createTo',
    restore: 'backup:restore',
  },
  app: {
    info: 'app:info',
    licences: 'app:licences',
    openExternal: 'app:openExternal',
  },
} as const;

/** Main → renderer pushes. */
export const EVENTS = {
  menuAction: 'event:menuAction',
  themeChanged: 'event:themeChanged',
  libraryChanged: 'event:libraryChanged',
} as const;

/**
 * Actions the native menu can dispatch into the renderer. Items whose feature
 * arrives in a later phase are present but disabled in the menu, so this list
 * is deliberately shorter than the menu itself.
 */
export const MENU_ACTIONS = [
  'trip:new',
  'folder:new',
  'trip:rename',
  'trip:duplicate',
  'trip:delete',
  'selection:delete',
  'selection:selectAll',
  'panel:toggleLibrary',
  'panel:togglePanelProperties',
  'map:layers',
  'map:zoomIn',
  'map:zoomOut',
  'map:fitTrip',
  'settings:open',
  'about:open',
  'backup:create',
  'backup:restore',
  'export:copy',
] as const;

export type MenuAction = (typeof MENU_ACTIONS)[number];
