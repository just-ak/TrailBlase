# Phase 2: Routes and Waypoints — Tasks

Execute in order. The data and command layers come first so the map and panels
are built against a settled contract, and the undo stack exists before the
editing gestures that need it — retrofitting history onto working gestures is
how per-pixel undo entries happen.

Update `docs/progress-mindmap.svg` as each task changes status.

- [x] 1. Shared contracts for routes and waypoints
  - `shared/domain/types.ts`: `Route`, `RoutePoint`, `Waypoint`,
    `WaypointGroup`, `RouteStats`, extend `ObjectRef` usage
  - `shared/domain/symbols.ts`: the waypoint symbol vocabulary with internal
    id, label, glyph and Garmin `<sym>` name
  - `shared/ipc/channels.ts`: `routes:*`, `waypoints:*`, `undo:*`, new menu
    actions for route and waypoint creation
  - `shared/ipc/schemas.ts`: coordinate-validated point arrays, waypoint
    fields, undo requests
  - `shared/ipc/api.ts`: the three new namespaces
  - Unit tests: schema rejection of out-of-range coordinates, empty point
    arrays, over-long names, and unknown symbol ids
  - _Requirements: 3.2, 3.5, 3.7_

- [x] 2. Route and waypoint repositories
  - `main/db/repositories/routes.ts`: routes plus dense-`seq` point writes
  - `main/db/repositories/waypoints.ts`: waypoints and waypoint groups
  - Cross-trip listing queries for the library views
  - Unit tests: point ordering survives a round trip, `seq` stays dense after a
    replace, cascade on trip delete still holds
  - _Requirements: 7.1_

- [x] 3. Route service with geometry and derived statistics
  - create, rename, set colour, duplicate, delete, restore-with-id
  - `setGeometry`: delete and reinsert the whole array in one transaction, then
    recompute `distance_m`, `point_count`, `elev_gain_m`, `elev_loss_m`
  - Point operations expressed as callers that build a new array: append, move,
    insert at segment, delete, reorder, reverse
  - Every mutation returns its inverse
  - Unit tests: statistics match `shared/geo` fixtures; elevation stays `null`
    when no point carries elevation; a degenerate one-point route is valid;
    imported geometry is never modified implicitly
  - _Requirements: 1.3, 1.5, 2.3, 2.4, 2.5, 2.6, 4.1, 4.2, 4.4_

- [x] 4. Waypoint service
  - create (map click or manual coordinates), update, move, delete,
    restore-with-id, group assignment, search
  - Coordinate validation rejects out-of-range values with a clear message
  - Elevation absent means `null`, never `0`
  - Unit tests: validation, grouping, search, cascade, null elevation
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 3.7_

- [x] 5. Command registry and undo service
  - `main/services/commands.ts`: `kind` → service call, covering
    `route:*` and `waypoint:*` plus the Phase 1 `trip:*` and `folder:*`
    mutations that are safely invertible
  - `main/services/undoService.ts`: bounded stack, redo cleared on new action,
    human labels, deletion of trips and folders deliberately excluded
  - Unit tests: undo restores prior state; redo reapplies; a new action clears
    redo; the bound is enforced; an undone delete restores the original id;
    undo of a geometry edit restores the exact point array
  - _Requirements: 5.1, 5.3, 5.4_

- [x] 6. IPC and preload wiring
  - Handlers for all route, waypoint and undo channels, each recording an undo
    entry where appropriate
  - Preload bridge methods; no generic passthrough
  - Unit tests: invalid payloads rejected at the boundary
  - _Requirements: 3.2, 5.1_

- [x] 7. Waypoint map layer
  - `features/map/markers.ts`: DivIcon factories driven by the symbol vocabulary
  - `features/map/useWaypointLayers.ts`: markers keyed by id, updated in place
  - Click to select, drag to reposition committing on `dragend`
  - _Requirements: 3.3, 6.1, 6.4_

- [x] 8. Route map layer
  - Polylines for every route in the selected trip, coloured per route
  - Draggable vertices for the selected route only
  - Start and end emphasis
  - _Requirements: 6.1, 6.4_

- [x] 9. Route drawing mode
  - `editorStore`: mode flag, pending points, hint bar
  - Map click appends; running distance shown live
  - Enter or double-click finishes and persists; Escape cancels without
    persisting a partial route
  - Straight segments only, with the UI making clear no road-snapping occurs
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 10. Route vertex editing
  - Drag a vertex to move it; click a segment to insert; Alt-click to delete
  - Reverse, duplicate, rename and delete a route
  - One undo entry per gesture
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 11. Route and waypoint properties panels
  - Route: name, colour, distance, point count, start and end coordinates,
    elevation gain and loss where available, estimated duration labelled as an
    estimate with the planning speed shown
  - Waypoint: name, coordinates (editable with validation), elevation,
    description, symbol, notes
  - Absent data renders as "not available", never as zero
  - _Requirements: 3.4, 3.7, 4.1, 4.2, 4.3_

- [x] 12. Library tree completion
  - Routes and waypoints nested under their trip
  - Cross-trip Routes and Waypoints views populated
  - Move a route or waypoint between trips as a reparent, with the UI stating it
    is a move and not a copy
  - _Requirements: 7.1, 7.2_

- [x] 13. Undo and redo in the UI
  - Edit menu Undo and Redo enabled from the stack state, labelled with the
    action they will reverse
  - ⌘Z and ⇧⌘Z
  - Map, library and properties all reflect an undone change
  - _Requirements: 5.2, 5.3_

- [x] 14. Context menus and map controls
  - Object and empty-space context menus offering only contextually valid
    actions
  - Fit route to screen, fit trip to screen, return to selection — now that
    there is geometry to fit, the View menu items become functional
  - _Requirements: 6.2, 6.3_

- [x] 15. End-to-end tests
  - Draw a route on the map, save it, reopen and confirm the geometry
  - Drag a vertex and confirm the statistics update
  - Create a waypoint by coordinate entry and by map click
  - Undo and redo across a geometry edit and a deletion
  - Route geometry preserved exactly across a restart
  - _Requirements: 1.1, 2.2, 3.1, 5.3_

- [x] 16. Phase 2 verification pass
  - `npm run verify` green, and the e2e suite green against the packaged build
  - Walk the source-spec Phase 2 acceptance criteria: a route can be created on
    the map, routes save and reopen, waypoints persist, route geometry is
    preserved
  - Update the mindmap to show Phase 2 complete
  - Record any discovered limitation in `docs/adr/` rather than leaving a
    placeholder in the UI
  - _Requirements: all_
