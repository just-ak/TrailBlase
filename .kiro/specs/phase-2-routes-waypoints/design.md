# Phase 2: Routes and Waypoints — Design

## Overview

Phase 2 makes TrailRT useful for planning: draw and edit routes on the map,
place and annotate waypoints, see statistics derived from real geometry, and
undo any of it.

Phase 1 established the shapes this builds on. Every mutation already goes
through a service method that returns its inverse (ADR 0001), the map already
owns a single imperative Leaflet instance, and `shared/geo` already computes
distance and elevation. Phase 2 adds entities and interaction; it does not
restructure anything.

Two decisions carry the weight of this phase: how undo works, and how route
geometry edits are represented. Both are settled below before any code.

## Undo and redo: a command log in the main process

Requirement 5 needs a bounded undo history. ADR 0001 ruled out "revert to last
saved file" because there is no save point, so this has to be a command history.

**It lives in the main process, not the renderer.** The database is the single
source of truth, and an undo stack in the renderer would desynchronise the
moment a mutation arrived from anywhere else — a menu action, a second window,
or a backup restore. Keeping it beside the data means the stack can never
describe a state the database was not in.

### The symmetry that makes it work

Every service mutation already returns `Mutation<T>`:

```ts
interface Mutation<T> {
  result: T;
  inverse: { kind: string; payload: Record<string, unknown> };
}
```

A command registry maps `kind` to the service call that applies it. Because
applying a command itself returns a `Mutation`, the inverse of an inverse comes
back for free:

```
do(cmd)   -> { result, inverse: undoCmd }   push undoCmd onto the undo stack
undo()    -> apply(undoCmd) -> { inverse: redoCmd }   push redoCmd onto redo
redo()    -> apply(redoCmd) -> { inverse: undoCmd }   push undoCmd onto undo
```

No separate "reverse operation" code, and no risk of a hand-written inverse
drifting from its forward operation. A new undoable action is a service method
plus one registry entry.

Rules that keep it honest:

- A new user action clears the redo stack. Branching history is not worth the
  confusion.
- The stack is bounded (50 entries) and holds only descriptors, not snapshots
  of whole objects, so it cannot grow without limit.
- **Trip and folder deletion stay out of the stack**, remaining
  confirmation-gated as in Phase 1. Their cascade spans several tables and a
  reliable inverse would mean snapshotting all of it. ADR 0001 already said
  this; it is restated because it is the obvious thing to get wrong.
- Route and waypoint deletion *is* undoable, via a restore command that
  recreates the object with its original id. Reusing the id matters: selection,
  and later attachments, refer to it.
- Each entry carries a human label ("Move route point", "Delete waypoint") so
  the Edit menu can say what it will undo rather than just "Undo".

## Route geometry: whole-array replacement

Requirement 2 lists point move, insert, delete and reorder, plus route reverse.
Representing each as its own command, each with its own inverse, is four
opportunities to get an off-by-one wrong.

Instead there is **one geometry command**: `route:setGeometry`, carrying the
complete point array. Its inverse is the same command with the previous array.
Move, insert, delete, reorder and reverse are all callers that compute a new
array.

This is viable because planned routes are small. A route is tens to low
hundreds of points — a human places them. That is a few kilobytes per undo
entry, which is nothing against a 50-entry bound.

It would *not* be viable for tracks, which run to hundreds of thousands of
points. Phase 3 track editing therefore needs a different approach, and ADR
0003 already anticipates that with its separate source-of-truth and render-cache
split. The two are deliberately not unified.

### Statistics are a cache, recomputed on write

`routes.distance_m`, `elev_gain_m`, `elev_loss_m` and `point_count` are caches
(Phase 1 schema). Every `setGeometry` recomputes them from the new points inside
the same transaction, so they cannot drift from the geometry.

Elevation gain stays `null` when no point carries elevation — never `0`. A flat
route and a route with unknown elevation are different facts and the properties
panel must be able to tell them apart. `shared/geo/elevationStats` already
returns nulls for this; Phase 2 just must not paper over it.

Duration is shown only as an estimate at the user's configured planning speed,
with the speed visible. Requirement 4.3 forbids presenting a bare number that
implies measurement.

## Module layout

Additions only; nothing moves.

```
src/
  shared/
    domain/
      types.ts         + Route, RoutePoint, Waypoint, WaypointGroup, stats
      symbols.ts       waypoint symbol vocabulary (Garmin-aligned names)
    ipc/
      channels.ts      + routes:*, waypoints:*, undo:*
      schemas.ts       + geometry, waypoint and undo request schemas
      api.ts           + the three new namespaces
  main/
    db/repositories/
      routes.ts        routes + route_points
      waypoints.ts     waypoints + waypoint_groups
    services/
      routeService.ts
      waypointService.ts
      undoService.ts   the stack
      commands.ts      kind -> service call registry
    ipc/register.ts    + new channels, each recording an undo entry
  renderer/
    stores/
      editorStore.ts   drawing mode, hover, pending geometry
    features/map/
      useRouteLayers.ts      polylines + draggable vertices
      useWaypointLayers.ts   markers
      markers.ts             DivIcon factories
    features/properties/
      RouteProperties.tsx
      WaypointProperties.tsx
```

`features/map/` still must not import trip management. Route and waypoint data
reach it as props from the app layer, not by importing the library store.

## Map interaction

The Leaflet instance stays single and imperative. Phase 2 adds layer effects
that attach to it, in the same pattern as the tile layer.

**Draw mode.** A mode flag in `editorStore` plus a Leaflet `click` handler that
appends a point. The cursor changes, a hint bar appears, Escape cancels without
persisting, and Enter or a double-click finishes. Segments are straight lines:
there is no routing provider until Phase 4, and drawing must not imply
road-snapping that nothing performs (Requirement 1.5).

**Vertex editing.** A selected route renders draggable circle markers at its
points. Drag commits on `dragend`, not on every move — one undo entry per
gesture, not per pixel. Clicking a segment inserts a point at the projected
position; Alt-clicking a vertex deletes it.

**Performance.** Vertices are only materialised for the *selected* route.
Rendering handles for every route in a trip would be both visually unreadable
and the obvious source of a slow map.

**Selection synchronisation.** The library tree and the map read the same
`selectionStore`, so clicking either highlights both. This already works for
trips; routes and waypoints join the same mechanism.

## Waypoint symbols

Requirement 3.5 asks for a symbol set whose names map onto Garmin's vocabulary,
so Phase 3 export keeps fidelity. `shared/domain/symbols.ts` holds the mapping:
a stable internal id, a display label, a glyph for the marker, and the Garmin
`<sym>` name used on export.

The set is deliberately small — around twenty symbols covering the common
outdoor cases — rather than an exhaustive clone. An unmapped imported symbol is
preserved verbatim in the database and rendered with a default glyph, so Phase 3
can round-trip it even though this build has no icon for it. Discarding it would
violate the import-fidelity rule.

## Technical risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Undo stack desynchronises from the database | Corrupt-looking state, lost edits | Stack lives in the main process beside the data; every entry derives from a real mutation's inverse rather than being hand-written |
| Vertex drag generating an undo entry per mouse-move | Unusable history | Commit on `dragend` only; one entry per gesture |
| Draw mode leaking: clicks still appending after finish | Phantom points | Mode is a single store flag; the Leaflet handler is attached and removed by effect, not left bound |
| Leaflet marker churn on every store update | Janky map | Layers keyed by object id and updated in place; full rebuild only when the selected trip changes |
| Elevation nulls rendered as 0 | Misleading data, breaks a steering rule | `shared/geo` returns nulls; properties panel renders `—`; covered by unit tests |
| Route point `seq` gaps after edits | Broken ordering, unique-constraint failures | `setGeometry` deletes and reinserts the whole array in one transaction, so `seq` is always dense |
| Deleted-then-undone object losing its id | Stale selection, future attachment orphans | Restore commands recreate with the original id |

## Out of scope for Phase 2

Stated so their absence is not read as an oversight: road-snapped routing
(Phase 4), elevation profile charts (Phase 4), external elevation lookup
(Phase 4), track editing and import/export (Phase 3), and sort-by-distance in
the library (Phase 3, when tracks also have distance). Waze hand-off is Phase 4
per ADR 0005.
