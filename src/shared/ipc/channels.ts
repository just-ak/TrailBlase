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
  routes: {
    listForTrip: 'routes:listForTrip',
    listAll: 'routes:listAll',
    get: 'routes:get',
    create: 'routes:create',
    update: 'routes:update',
    setGeometry: 'routes:setGeometry',
    reverse: 'routes:reverse',
    duplicate: 'routes:duplicate',
    move: 'routes:move',
    delete: 'routes:delete',
  },
  waypoints: {
    listForTrip: 'waypoints:listForTrip',
    listAll: 'waypoints:listAll',
    get: 'waypoints:get',
    create: 'waypoints:create',
    update: 'waypoints:update',
    move: 'waypoints:move',
    duplicate: 'waypoints:duplicate',
    moveToTrip: 'waypoints:moveToTrip',
    delete: 'waypoints:delete',
    search: 'waypoints:search',
    groups: 'waypoints:groups',
    createGroup: 'waypoints:createGroup',
  },
  geometry: {
    forTrip: 'geometry:forTrip',
  },
  undo: {
    state: 'undo:state',
    undo: 'undo:undo',
    redo: 'undo:redo',
    clear: 'undo:clear',
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
  undoStateChanged: 'event:undoStateChanged',
} as const;

/**
 * Actions the native menu can dispatch into the renderer. Items whose feature
 * arrives in a later phase are present but disabled in the menu, so this list
 * is deliberately shorter than the menu itself.
 */
export const MENU_ACTIONS = [
  'trip:new',
  'folder:new',
  'route:new',
  'waypoint:new',
  'edit:undo',
  'edit:redo',
  'map:fitRoute',
  'map:returnToSelection',
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
