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
  tracks: {
    listForTrip: 'tracks:listForTrip',
    listAll: 'tracks:listAll',
    get: 'tracks:get',
    geometry: 'tracks:geometry',
    update: 'tracks:update',
    move: 'tracks:move',
    reverse: 'tracks:reverse',
    previewSimplify: 'tracks:previewSimplify',
    simplify: 'tracks:simplify',
    split: 'tracks:split',
    join: 'tracks:join',
    deleteRange: 'tracks:deleteRange',
    delete: 'tracks:delete',
    hasOriginal: 'tracks:hasOriginal',
    restoreOriginal: 'tracks:restoreOriginal',
  },
  /**
   * Import is a three-step conversation, not one call: the main process opens
   * the dialog, parses, and hands back **opaque tokens** plus previews. The
   * renderer confirms a selection against those tokens, so it never holds a
   * filesystem path it could ask us to read.
   */
  importing: {
    choose: 'import:choose',
    addPaths: 'import:addPaths',
    commit: 'import:commit',
    discard: 'import:discard',
    history: 'import:history',
    clearHistory: 'import:clearHistory',
  },
  exporting: {
    options: 'export:options',
    run: 'export:run',
  },
  geometry: {
    forTrip: 'geometry:forTrip',
  },
  /**
   * Routing and road attributes — the only channels that can cause an outbound
   * network request. `status` and `consentNotice` are local reads, there so the
   * UI can describe the configuration without triggering a call.
   */
  routing: {
    status: 'routing:status',
    consentNotice: 'routing:consentNotice',
    /**
     * Tests an endpoint by routing two fixed sample points.
     *
     * The one routing call that is not gated on consent, because it transmits
     * no geometry of the user's — see `providerService.testConnection`.
     */
    test: 'routing:test',
    snap: 'routing:snap',
    /**
     * Routes one leg and writes nothing. Backs the interactive snap routing
     * tool, where each click costs exactly one provider call.
     */
    routeLeg: 'routing:routeLeg',
    /** Saves a route built with the tool, as previewed. */
    createSnapped: 'routing:createSnapped',
    provenance: 'routing:provenance',
    match: 'routing:match',
    attributes: 'routing:attributes',
    clearAttributes: 'routing:clearAttributes',
    profile: 'routing:profile',
    speedDistribution: 'routing:speedDistribution',
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
    /**
     * Saves a PNG the renderer rendered, through a save dialog.
     *
     * The renderer rasterises because only it has a DOM; the main process owns
     * the dialog and the filesystem. The renderer never receives a path, only
     * the basename for its confirmation message.
     */
    savePng: 'app:savePng',
  },
} as const;

/** Main → renderer pushes. */
export const EVENTS = {
  menuAction: 'event:menuAction',
  themeChanged: 'event:themeChanged',
  libraryChanged: 'event:libraryChanged',
  undoStateChanged: 'event:undoStateChanged',
  /** Coarse progress during a large import, pushed per file and per batch. */
  importProgress: 'event:importProgress',
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
  'import:open',
  'export:open',
] as const;

export type MenuAction = (typeof MENU_ACTIONS)[number];
