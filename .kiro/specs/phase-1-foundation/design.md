# Phase 1: Application Foundation — Design

## Overview

Three processes, one contract. The Electron **main** process owns everything
privileged: the SQLite file, the filesystem, dialogs and menus. The **renderer**
is a React app with no system access. **Preload** is a thin, enumerated bridge
between them. A fourth directory, `shared/`, holds the types and zod schemas
both sides compile against, so the IPC contract cannot drift.

The foundational constraint is that Phase 1 must not have to be restructured by
Phases 2–5. Three decisions carry that weight: the full database schema is
created in migration 0001 rather than grown per phase; every mutation goes
through a service method with an explicit inverse so the Phase 2 undo stack has
something to record; and the map talks to a `MapProvider` interface from day
one so Garmin and offline providers are additive.

## Product identity

Fixed now because these values propagate into the bundle, the DMG, the window
title, the app support directory path and the tile User-Agent, and changing them
later means migrating a user's database location.

| Field                 | Value                                                |
| --------------------- | ---------------------------------------------------- |
| Display name          | TrailRT                                              |
| Bundle identifier     | `com.trailrt.app`                                    |
| npm package name      | `trailrt`                                            |
| App support directory | `~/Library/Application Support/TrailRT/`             |
| Database file         | `trailrt.db` (WAL sidecars alongside)                |
| Backups directory     | `~/Library/Application Support/TrailRT/backups/`     |
| Attachments directory | `~/Library/Application Support/TrailRT/attachments/` |
| Tile User-Agent       | `TrailRT/<version> (+https://github.com/…)`          |

`productName` and `appId` are set explicitly in `electron-builder.yml`, so the
workspace directory name has no effect on the build.

## Signing posture

No Developer ID initially, so the build is **ad-hoc signed** with hardened
runtime retained (ADR 0009). The detail that matters: an ad-hoc signature has no
Apple Team ID, which mismatches the Apple-signed Electron frameworks and causes
a launch failure unless the entitlements grant
`com.apple.security.cs.disable-library-validation`. Electron additionally needs
`com.apple.security.cs.allow-jit`. Both go in `build/entitlements.mac.plist`
from the start, which is also what the eventually-signed build wants, so
acquiring a certificate later changes only `mac.identity` and the notarisation
switch — no restructuring.

The user-visible cost is a Gatekeeper block on a downloaded DMG, and macOS no
longer offers the Control-click bypass. That is a documentation obligation, not
something to engineer around.

## Project structure

```
trailrt/
├── electron.vite.config.ts        three builds: main, preload, renderer
├── electron-builder.yml
├── drizzle.config.ts
├── vitest.config.ts
├── playwright.config.ts
├── .nvmrc                         26
├── build/                         icon.icns, entitlements
├── test-data/                     synthetic fixtures
├── docs/
│   ├── adr/
│   └── progress-mindmap.svg
└── src/
    ├── main/
    │   ├── index.ts               app lifecycle, single-instance lock
    │   ├── window.ts              BrowserWindow + geometry persistence
    │   ├── security/
    │   │   ├── csp.ts             CSP header, tile host allowlist
    │   │   └── navigation.ts      window-open and navigation guards
    │   ├── db/
    │   │   ├── client.ts          better-sqlite3 + drizzle, pragmas
    │   │   ├── schema.ts          drizzle table definitions
    │   │   ├── migrate.ts         migration runner
    │   │   ├── migrations/
    │   │   └── repositories/      trips, folders, settings, importHistory
    │   ├── services/
    │   │   ├── tripService.ts
    │   │   ├── folderService.ts
    │   │   ├── settingsService.ts
    │   │   └── backupService.ts
    │   ├── ipc/
    │   │   ├── register.ts        wires all namespaces
    │   │   ├── handler.ts         validate → delegate → Result wrapper
    │   │   ├── trips.ts
    │   │   ├── folders.ts
    │   │   ├── settings.ts
    │   │   └── backup.ts
    │   └── menu/
    │       ├── appMenu.ts
    │       └── actions.ts
    ├── preload/
    │   └── index.ts               contextBridge surface, no logic
    ├── shared/
    │   ├── domain/                Trip, Folder, Settings, TreeNode types
    │   ├── ipc/
    │   │   ├── channels.ts        channel name constants
    │   │   ├── schemas.ts         zod request/response pairs
    │   │   └── result.ts          Result<T> discriminated union
    │   ├── geo/                   distance, bbox, formatting (pure)
    │   └── map/
    │       └── MapProvider.ts     interface + OSM descriptor
    └── renderer/
        ├── main.tsx
        ├── index.css              Tailwind 4 @theme tokens
        ├── app/
        │   ├── App.tsx
        │   └── Layout.tsx         three-panel split, persisted sizes
        ├── features/
        │   ├── library/           tree, search, context menus, DnD
        │   ├── map/               MapView, providers, controls
        │   ├── properties/        inspector panel
        │   └── settings/
        ├── stores/                zustand: library, selection, ui, settings
        ├── components/            Button, Dialog, Tree, Split primitives
        └── hooks/
```

Boundary rules are enforced by convention plus an oxlint
`no-restricted-imports` rule: `shared/` imports nothing privileged,
`renderer/` never imports from `main/`, and `features/map/` never imports
trip-management or database code.

## Database schema

SQLite via better-sqlite3, described with Drizzle, migrated with drizzle-kit.
Migration 0001 creates the whole schema. Phase 1 only wires repositories for
folders, trips, settings and import history, but the tables exist so later
phases add behaviour rather than structure.

Conventions throughout: text UUID primary keys from `crypto.randomUUID()`;
timestamps as `INTEGER` UTC epoch milliseconds; distances in metres and
elevations in metres as `REAL`; `NULL` for genuinely absent data, never a
sentinel zero.

```
folders
  id              TEXT PK
  parent_id       TEXT NULL → folders(id) ON DELETE CASCADE
  name            TEXT NOT NULL
  sort_order      INTEGER NOT NULL DEFAULT 0
  created_at      INTEGER NOT NULL
  updated_at      INTEGER NOT NULL
  INDEX (parent_id)

trips
  id              TEXT PK
  folder_id       TEXT NULL → folders(id) ON DELETE SET NULL
  name            TEXT NOT NULL
  description     TEXT NULL
  notes           TEXT NULL
  status          TEXT NOT NULL DEFAULT 'active'   CHECK IN ('active','archived')
  metadata        TEXT NULL                        -- JSON
  created_at      INTEGER NOT NULL
  updated_at      INTEGER NOT NULL
  INDEX (folder_id), INDEX (status), INDEX (updated_at)

routes                                             -- Phase 2
  id              TEXT PK
  trip_id         TEXT NOT NULL → trips(id) ON DELETE CASCADE
  name            TEXT NOT NULL
  colour          TEXT NULL
  source          TEXT NOT NULL DEFAULT 'user'     -- 'user' | 'import'
  point_count     INTEGER NOT NULL DEFAULT 0       -- cache
  distance_m      REAL NULL                        -- cache
  elev_gain_m     REAL NULL                        -- cache, NULL if no ele data
  elev_loss_m     REAL NULL                        -- cache
  created_at      INTEGER NOT NULL
  updated_at      INTEGER NOT NULL
  INDEX (trip_id)

route_points                                       -- Phase 2
  id              TEXT PK
  route_id        TEXT NOT NULL → routes(id) ON DELETE CASCADE
  seq             INTEGER NOT NULL
  lat             REAL NOT NULL
  lon             REAL NOT NULL
  ele_m           REAL NULL
  name            TEXT NULL
  symbol          TEXT NULL
  notes           TEXT NULL
  UNIQUE (route_id, seq)

tracks                                             -- Phase 3
  id              TEXT PK
  trip_id         TEXT NOT NULL → trips(id) ON DELETE CASCADE
  name            TEXT NOT NULL
  colour          TEXT NULL
  width           INTEGER NULL
  source          TEXT NOT NULL DEFAULT 'import'
  point_count     INTEGER NOT NULL DEFAULT 0       -- cache
  distance_m      REAL NULL                        -- cache
  elev_gain_m     REAL NULL                        -- cache
  elev_loss_m     REAL NULL                        -- cache
  started_at      INTEGER NULL
  ended_at        INTEGER NULL
  render_geometry BLOB NULL                        -- cache, see ADR 0003
  render_tolerance_m REAL NULL
  created_at      INTEGER NOT NULL
  updated_at      INTEGER NOT NULL
  INDEX (trip_id)

track_points                                       -- Phase 3, source of truth
  id              TEXT PK
  track_id        TEXT NOT NULL → tracks(id) ON DELETE CASCADE
  segment_index   INTEGER NOT NULL DEFAULT 0
  seq             INTEGER NOT NULL
  lat             REAL NOT NULL
  lon             REAL NOT NULL
  ele_m           REAL NULL
  recorded_at     INTEGER NULL
  UNIQUE (track_id, segment_index, seq)

track_sources                                      -- Phase 3, ADR 0003
  id              TEXT PK
  track_id        TEXT NOT NULL → tracks(id) ON DELETE CASCADE
  format          TEXT NOT NULL
  content_hash    TEXT NOT NULL
  original_bytes  BLOB NOT NULL
  created_at      INTEGER NOT NULL

waypoint_groups                                    -- Phase 2
  id              TEXT PK
  trip_id         TEXT NOT NULL → trips(id) ON DELETE CASCADE
  name            TEXT NOT NULL
  created_at      INTEGER NOT NULL

waypoints                                          -- Phase 2
  id              TEXT PK
  trip_id         TEXT NOT NULL → trips(id) ON DELETE CASCADE
  group_id        TEXT NULL → waypoint_groups(id) ON DELETE SET NULL
  name            TEXT NOT NULL
  lat             REAL NOT NULL
  lon             REAL NOT NULL
  ele_m           REAL NULL
  description     TEXT NULL
  symbol          TEXT NULL
  notes           TEXT NULL
  source          TEXT NOT NULL DEFAULT 'user'
  created_at      INTEGER NOT NULL
  updated_at      INTEGER NOT NULL
  INDEX (trip_id), INDEX (lat, lon)

attachments
  id              TEXT PK
  owner_type      TEXT NOT NULL   CHECK IN ('trip','route','track','waypoint')
  owner_id        TEXT NOT NULL
  kind            TEXT NOT NULL   -- 'photo' | 'file'
  relative_path   TEXT NOT NULL   -- under appSupport/attachments
  content_hash    TEXT NOT NULL
  byte_size       INTEGER NOT NULL
  mime_type       TEXT NULL
  created_at      INTEGER NOT NULL
  INDEX (owner_type, owner_id)

settings
  key             TEXT PK
  value           TEXT NOT NULL   -- JSON
  updated_at      INTEGER NOT NULL

import_history
  id              TEXT PK
  source_name     TEXT NOT NULL
  source_format   TEXT NOT NULL
  destination_trip_id TEXT NULL → trips(id) ON DELETE SET NULL
  status          TEXT NOT NULL   CHECK IN ('success','partial','failed')
  report          TEXT NOT NULL   -- JSON: counts, warnings, skipped
  started_at      INTEGER NOT NULL
  finished_at     INTEGER NULL
```

Attachments store bytes on disk and metadata in the database, keeping the
database small enough that rolling backups stay cheap. `track_points` as source
of truth with `render_geometry` as an explicit, rebuildable cache is ADR 0003.
Strict `NOT NULL` + `CASCADE` ownership of child objects is ADR 0004.

## IPC contract

One pattern, applied uniformly. Channels are namespaced constants; each has a
zod request schema and a response type; handlers validate then delegate to a
service and never contain business logic.

```ts
// shared/ipc/result.ts
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; detail?: string } };
```

```ts
// main/ipc/handler.ts — the only place ipcMain.handle is called
export function handle<Req, Res>(
  channel: string,
  schema: ZodType<Req>,
  fn: (req: Req) => Promise<Res> | Res,
): void {
  ipcMain.handle(channel, async (_event, raw): Promise<Result<Res>> => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "INVALID_REQUEST", message: "…" } };
    }
    try {
      return { ok: true, data: await fn(parsed.data) };
    } catch (err) {
      return { ok: false, error: toAppError(err) };
    }
  });
}
```

Phase 1 channels: `trips:list|create|rename|update|duplicate|move|archive|delete`,
`folders:list|create|rename|move|delete`, `library:tree`,
`settings:get|set|all`, `backup:create|restore|list`, `window:state`,
`shell:openExternal`.

Preload exposes these as named methods grouped by namespace —
`window.trailrt.trips.create(...)` — and nothing else. No generic `invoke`.
The renderer never sees a channel string.

## Renderer state

Four zustand stores with distinct jobs, which keeps re-renders local:

- `libraryStore` — tree data, expansion state, sort, search query
- `selectionStore` — currently selected object reference
- `uiStore` — panel sizes, panel visibility, theme
- `settingsStore` — mirror of persisted settings

Stores hold no business logic. Mutations call the bridge, then apply the
returned canonical object. The main process is the single source of truth;
stores are a cache of it. No optimistic writes in Phase 1 — correctness over
perceived speed while the foundation settles.

### Mutation shape for future undo

Per ADR 0001 there is no save step, so undo must be a command history. Phase 1
does not build the stack, but every service mutation is written as a method
that returns enough information to invert it, and components never write to the
database through any other route. Phase 2 adds the stack above this without
touching call sites.

## Map module

```ts
// shared/map/MapProvider.ts
export interface MapProvider {
  readonly id: string;
  readonly name: string;
  readonly kind: "raster-tiles" | "vector-tiles" | "offline" | "garmin";
  readonly attribution: string;
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly tileUrlTemplate: string;
  readonly subdomains?: readonly string[];
  readonly requiresApiKey: boolean;
}
```

Phase 1 registers one provider, OpenStreetMap, from a registry module. The
component reads whichever provider the settings store names; no tile URL appears
in JSX. Adding OpenTopoMap in Phase 4 is a registry entry plus a CSP allowlist
entry, with no component change.

`RoutingProvider` and `GarminMapProvider` are deliberately _not_ stubbed in
Phase 1. An empty interface with no implementation and no caller is a
placeholder, and the steering rules forbid those. They are designed in Phases 4
and 5, which the module layout accommodates.

There is no `react-leaflet`. It is Hippocratic-2.1 licensed, which is
incompatible with the project's GPL-3.0 licence, so Leaflet (BSD-2-Clause) is
driven directly through in-house hooks — see ADR 0008. In practice this costs
little, because the lifecycle below is the imperative escape hatch rather than
the declarative API that a binding would provide. `features/map/` owns a
`useLeafletMap` hook for instance creation, teardown and resize, plus one effect
per layer type.

Leaflet lifecycle details that matter: the map instance is created once in a
ref and never recreated on re-render; a `ResizeObserver` on the container calls
`invalidateSize()` to satisfy Requirement 3.4; tile loading uses Leaflet
defaults with no prefetch, and `crossOrigin` is left unset so the browser cache
handles tiles normally per Requirement 8.5.

## Security implementation

CSP is applied via `onHeadersReceived`, assembled from the tile hosts of the
registered providers:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://tile.openstreetmap.org;
connect-src 'self';
font-src 'self';
object-src 'none';
frame-src 'none';
base-uri 'none';
form-action 'none';
```

`style-src 'unsafe-inline'` is required by Leaflet's inline transforms. It is
the one relaxation, and it is scoped to styles only.

`setWindowOpenHandler` returns `{ action: 'deny' }` unconditionally.
`will-navigate` is cancelled for anything that is not the renderer entry point.
External links go through a validator that requires `https:` and a host on the
allowlist before reaching `shell.openExternal`.

A single-instance lock guards the database, per Requirement 1.5.

## Backup strategy

`backupService` uses better-sqlite3's `db.backup()` rather than copying the
file, because WAL means the main file alone is not a consistent snapshot.
Automatic backups run on a timer and at clean shutdown, writing to
`appSupport/backups/` with a bounded generation count. Restore validates the
candidate by opening it read-only and checking `user_version` and the presence
of expected tables before swapping, and snapshots the current database first.

## Technical risks

| Risk                                                                       | Impact                                                | Mitigation                                                                                   |
| -------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `better-sqlite3` native build against Electron 45 ABI                      | Blocks everything                                     | `@electron/rebuild` in a postinstall step; verified early as task 2, before any feature work |
| npm 11 blocks lifecycle scripts; `electron` and `better-sqlite3` need them | Install appears to succeed but produces a broken tree | Explicit approved-scripts list in `package.json`, verified in task 1                         |
| Leaflet in React 19 strict mode double-invokes effects                     | Duplicate map instances, grey tiles                   | Single imperative instance in a ref, guarded init, `invalidateSize()` on resize              |
| TypeScript 7 ecosystem gaps                                                | Lint or tooling breakage                              | oxlint instead of typescript-eslint, ADR 0002; `tsc --noEmit` is the type gate               |
| OSM tile policy breach                                                     | Access blocked for all users                          | Descriptive User-Agent, no prefetch, no area download, documented in Requirement 8           |
| Tree drag-and-drop cycles                                                  | Corrupt hierarchy                                     | Server-side ancestry check rejects the move, Requirement 5.6; unit tested                    |
| Playwright Electron support is less mature than its browser support        | Flaky E2E                                             | Keep E2E to the four acceptance flows; put detailed logic in Vitest                          |
| Panel and map resize interaction                                           | Visual breakage, Requirement 3.4                      | `ResizeObserver`, not window resize events                                                   |
| In-house Leaflet integration replaces a community binding                  | Map bugs we own rather than inherit fixes for         | Small surface, covered by Phase 1 map tests; forced by licence, ADR 0008                     |
| A dependency added without a licence check                                 | GPL-3.0 violation in a shipped build                  | Check before adding per `.kiro/steering/licensing.md`; register regenerated in same change   |

## Out of scope for Phase 1

Stated explicitly so their absence is not read as an oversight: routes, tracks,
waypoints, import, export, elevation profiles, routing, Garmin anything, undo
history, sort by distance, attachments UI, and offline map sources. Menu items
for these are present and disabled per Requirement 10.2.
