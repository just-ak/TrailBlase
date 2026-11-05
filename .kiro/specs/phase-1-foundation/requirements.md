# Phase 1: Application Foundation — Requirements

## Introduction

Phase 1 delivers a running, secure, persistent macOS desktop shell: the
three-panel BaseCamp-style layout, a trip library backed by SQLite, an
OpenStreetMap view behind a provider abstraction, native menus, settings, and
backup. No routes, tracks, waypoints, or import/export — those are Phases 2–3.

The goal is a foundation that later phases extend without restructuring. Where
Phase 1 deliberately stops short of the source specification, that is recorded
in `.kiro/specs/spec-review.md` rather than left implicit.

Phase 1 is complete when all acceptance criteria below are verified and the
four source-spec acceptance criteria hold: the app launches on macOS, the map
renders, trips can be created, renamed and deleted, and trips survive a
restart.

## Requirements

### Requirement 1: Application launches as a native macOS app

**User story:** As a user, I want to launch TrailRT like any other Mac
application, so that it feels like a desktop tool rather than a web page.

#### Acceptance criteria

1. WHEN the application is launched THEN the system SHALL display a single main
   window with a native macOS title bar and standard window controls.
2. WHEN the window is resized or moved THEN the system SHALL persist the
   geometry and SHALL restore it on next launch.
3. WHEN the window is closed THEN the system SHALL quit the application, as is
   conventional for single-window document-less Mac apps.
4. WHEN the application starts THEN the window SHALL become visible only after
   the first render is ready, with no white flash.
5. IF a second instance is launched THEN the system SHALL focus the existing
   window instead of opening a second one, because two processes writing one
   SQLite file is a corruption risk.

### Requirement 2: Electron security baseline

**User story:** As a user, I want the application to be hardened against
malicious file content, so that opening someone else's GPS file cannot
compromise my machine.

#### Acceptance criteria

1. THE renderer SHALL run with `contextIsolation: true`,
   `nodeIntegration: false` and `sandbox: true`.
2. THE preload script SHALL expose only an explicitly enumerated API surface,
   and SHALL NOT expose a generic channel-passthrough function.
3. WHEN any IPC message is received THEN the main process SHALL validate the
   payload against a zod schema before acting on it, and SHALL reject invalid
   payloads with a structured error.
4. WHEN an IPC handler fails THEN it SHALL return a `{ ok: false, error }`
   result rather than propagating an exception across the process boundary.
5. THE main process SHALL set a Content-Security-Policy on renderer responses
   with `script-src 'self'`, and SHALL allowlist tile hosts in `img-src` only.
6. WHEN the renderer attempts to navigate to a non-local URL, or to open a new
   window THEN the system SHALL deny it.
7. WHEN an external link is activated THEN the system SHALL validate its scheme
   and host against an allowlist before passing it to `shell.openExternal`.
8. THE renderer SHALL have no direct filesystem or database access by any path.

### Requirement 3: Three-panel application layout

**User story:** As a BaseCamp user, I want the familiar library / map /
properties arrangement, so that I can work without relearning the interface.

#### Acceptance criteria

1. THE main window SHALL present a left library panel, a centre map panel and a
   right properties panel.
2. WHEN the user drags a panel divider THEN the system SHALL resize the
   adjacent panels, SHALL enforce minimum widths, and SHALL persist the sizes
   across restarts.
3. WHEN the user toggles the library or properties panel THEN the system SHALL
   hide or show it and the map SHALL reflow to fill the space.
4. WHEN the window is resized THEN the map SHALL resize correctly with no grey
   tile gutters and no stale tile layout.
5. THE layout SHALL remain usable down to a window width of 1024 px.

### Requirement 4: Trip library tree

**User story:** As a user, I want a hierarchical library of my trips and
folders, so that I can organise my trip planning.

#### Acceptance criteria

1. THE library SHALL display a tree rooted at "My Collection" containing a
   Trips branch and a Folders hierarchy.
2. THE tree SHALL include placeholder branches for Routes, Tracks, Waypoints,
   Imported Data and Recently Used, rendered as cross-trip views per ADR 0004.
   IF the underlying feature is not yet implemented THEN the branch SHALL state
   that it arrives in a later phase rather than appearing broken or empty.
3. WHEN the user expands or collapses a node THEN the system SHALL persist that
   state across restarts.
4. WHEN the user selects a node THEN the properties panel SHALL show that
   object's details.
5. THE tree SHALL support sorting trips by name and by date.
6. Sort by distance SHALL NOT appear in Phase 1, because no distance-bearing
   objects exist until Phase 3.

### Requirement 5: Trip and folder management

**User story:** As a user, I want to create, rename, move and delete trips and
folders, so that I can keep my collection organised.

#### Acceptance criteria

1. WHEN the user creates a trip THEN the system SHALL persist it with a
   generated ID, a name, creation and modification timestamps, and SHALL select
   it in the tree.
2. WHEN the user renames a trip or folder THEN the system SHALL persist the new
   name and SHALL update the modification timestamp.
3. WHEN the user duplicates a trip THEN the system SHALL create an independent
   copy including its child objects, named distinctly from the original.
4. WHEN the user deletes a trip or a non-empty folder THEN the system SHALL
   require confirmation, and the confirmation SHALL state what will be deleted
   including child counts.
5. WHEN the user moves a trip to a folder, by menu or by drag-and-drop THEN the
   system SHALL persist the new parent.
6. WHEN the user drags a folder into its own descendant THEN the system SHALL
   reject the move rather than creating a cycle.
7. WHEN the user archives a trip THEN the system SHALL set its status to
   archived and SHALL hide it from the default tree while keeping it reachable
   through a filter.
8. WHEN the user types in the library search field THEN the system SHALL filter
   the tree to matching trips and folders.
9. THE system SHALL enforce uniqueness of nothing by name; duplicate names are
   permitted, as in BaseCamp.

### Requirement 6: Local SQLite persistence with migrations

**User story:** As a user, I want my data stored locally with no account, so
that my trips are mine and work offline.

#### Acceptance criteria

1. THE system SHALL store all user data in a SQLite database in the macOS
   application support directory.
2. THE system SHALL NOT require any network service or account to start or to
   operate on existing data.
3. WHEN the application starts THEN it SHALL apply any pending migrations
   before serving queries, and SHALL fail loudly with an actionable message if
   migration fails.
4. THE initial migration SHALL create the full schema from section 12 of the
   source specification: folders, trips, routes, route points, tracks, track
   points, waypoints, attachments, settings and import history.
5. THE database SHALL use `journal_mode = WAL` and SHALL enforce
   `foreign_keys = ON`.
6. WHEN a multi-statement mutation is performed THEN it SHALL run in a single
   transaction.
7. THE schema SHALL store coordinates and elevations in SI units and timestamps
   as UTC epoch milliseconds.
8. THE schema SHALL make elevation and time columns nullable, and absent values
   SHALL be stored as NULL rather than zero.

### Requirement 7: Persistence across restart

**User story:** As a user, I want everything exactly as I left it when I
reopen the app.

#### Acceptance criteria

1. WHEN the user creates, renames, moves or deletes a trip and then restarts
   the application THEN the change SHALL be present.
2. WHEN the application restarts THEN it SHALL restore window geometry, panel
   sizes, panel visibility, tree expansion state, theme, selected object and
   last map position and zoom.
3. IF the application is terminated uncheckedly mid-write THEN the system SHALL
   recover to the last committed transaction on next start without data loss
   beyond that transaction.

### Requirement 8: OpenStreetMap display behind a provider abstraction

**User story:** As a user, I want an interactive map, and as a maintainer I
want to add map providers later without touching trip management.

#### Acceptance criteria

1. THE map SHALL render OpenStreetMap tiles from
   `https://tile.openstreetmap.org/{z}/{x}/{y}.png` via Leaflet.
2. THE map SHALL display OpenStreetMap attribution visibly at all times.
3. THE tile source SHALL be supplied by a `MapProvider` implementation resolved
   from configuration, and the tile URL SHALL NOT be hardcoded in a component.
4. THE system SHALL send a descriptive User-Agent identifying the application
   and version, as the OSM tile usage policy requires.
5. THE system SHALL NOT prefetch, bulk download, or offer any area-download of
   tiles. Caching SHALL be limited to tiles fetched for user-initiated viewing,
   honouring HTTP cache headers.
6. THE map SHALL support zoom and pan by mouse, trackpad and keyboard.
7. THE map SHALL provide zoom in, zoom out and a layer selector control.
8. WHEN tiles cannot be fetched THEN the map SHALL remain interactive over
   cached or blank tiles and SHALL show a non-blocking offline indicator.
9. THE map module SHALL NOT import trip-management or database code.

### Requirement 9: Backup and restore

**User story:** As a user, I want my trip collection protected against
corruption and mistakes.

#### Acceptance criteria

1. THE system SHALL create an automatic backup of the database on a rolling
   schedule, retaining a bounded number of generations.
2. WHEN the user requests a manual backup THEN the system SHALL write a
   consistent snapshot to a user-chosen location using SQLite's backup API, not
   a naive file copy.
3. WHEN the user restores a backup THEN the system SHALL require confirmation,
   SHALL back up the current database first, and SHALL reload the application
   state afterwards.
4. IF a backup file is not a valid TrailRT database THEN the restore SHALL be
   refused with a clear message and the current database SHALL be untouched.

### Requirement 10: Application menus and keyboard shortcuts

**User story:** As a Mac user, I want native menus and standard shortcuts.

#### Acceptance criteria

1. THE system SHALL install a native menu bar with the application menu plus
   File, Edit, View, Trip and Help, matching section 16 of the source
   specification.
2. Menu items whose feature arrives in a later phase SHALL be present but
   disabled, so the menu structure is honest about what is not yet available.
3. THE File menu SHALL expose New Trip, Save a Copy…, Backup, Restore and Quit
   in Phase 1. Open, Import and Export SHALL be disabled until Phase 3.
   Per ADR 0001 there is no bare "Save".
4. THE View menu SHALL expose Show/Hide Library, Show/Hide Properties, Map
   Layers, Zoom In and Zoom Out, all functional in Phase 1.
5. Standard shortcuts SHALL follow macOS conventions, including ⌘N for New
   Trip, ⌘W, ⌘Q and ⌘, for Settings.
6. Edit menu Undo and Redo SHALL be present and disabled in Phase 1, with the
   history stack arriving in Phase 2.

### Requirement 11: Settings and theming

**User story:** As a user, I want to configure the app and match my system
appearance.

#### Acceptance criteria

1. THE system SHALL provide a settings surface reachable from the application
   menu, covering theme, map provider, units and backup frequency.
2. THE system SHALL support light and dark themes plus a follow-system option,
   and SHALL apply changes without a restart.
3. WHEN a setting is changed THEN it SHALL be persisted to the settings table
   immediately.
4. THE units setting SHALL affect display only; stored values SHALL remain SI.

### Requirement 12: Build, packaging and distribution

**User story:** As a maintainer, I want a reproducible dev loop and a
distributable Mac build.

#### Acceptance criteria

1. THE project SHALL provide a development command with hot module replacement
   in the renderer and automatic restart of the main process.
2. THE project SHALL build a macOS application bundle and a DMG installer via
   electron-builder.
3. THE bundle SHALL carry an application icon, a version number and a bundle
   identifier.
4. THE build SHALL use ad-hoc signing (`mac.identity: "-"`) with hardened
   runtime retained, since no Developer ID is available initially. The
   entitlements file SHALL include
   `com.apple.security.cs.disable-library-validation` and
   `com.apple.security.cs.allow-jit`, without which an ad-hoc signed Electron
   app fails to launch. See ADR 0009.
5. THE build configuration SHALL be shaped so that obtaining a Developer ID
   later requires only supplying a certificate and enabling notarisation, with
   no change to entitlements, hardened runtime or targets.
6. THE ad-hoc signed bundle SHALL be verified to launch on Apple Silicon and to
   pass `codesign --verify --deep --strict`.
7. THE README and release notes SHALL document the Gatekeeper block that an
   unnotarised download produces, including the System Settings → Privacy &
   Security → Open Anyway sequence. They SHALL NOT instruct users to disable
   Gatekeeper system-wide.
8. Native modules SHALL be rebuilt against the Electron ABI as part of install.
9. THE build SHALL target both Apple Silicon and Intel.
10. Platform-specific code SHALL be isolated so that a future Windows target
    does not require restructuring.

### Requirement 13: Testing baseline

**User story:** As a maintainer, I want the foundation covered by tests so that
later phases can change it safely.

#### Acceptance criteria

1. THE project SHALL run unit tests with Vitest and end-to-end tests with
   Playwright's Electron support.
2. Unit tests SHALL cover trip and folder creation, renaming, duplication,
   moving, deletion, cycle rejection, migration application, IPC schema
   validation and settings persistence.
3. End-to-end tests SHALL cover application launch, map render, the trip
   create-rename-delete cycle, and persistence across a restart.
4. Tests SHALL run against a temporary database, SHALL NOT touch the real
   application support directory, and SHALL NOT use real user GPS data.
5. THE type check `tsc --noEmit` and `oxlint` SHALL pass with no errors.

### Requirement 14: Licence compliance and attribution

**User story:** As a user of free software, I want to know what the application
is made of and how to get its source; as a maintainer, I need the GPL-3.0
obligations met from the first release rather than retrofitted.

#### Acceptance criteria

1. THE repository SHALL contain the full GPL-3.0 licence text at `LICENSE`,
   unmodified.
2. THE Help menu About window SHALL state the application licence, and SHALL
   list third-party components with their versions and licences, including
   Electron's and Chromium's notices.
3. THE About window SHALL present the written offer of source, with a link to
   the public repository opened via the validated external-link path.
4. Source files SHALL carry a copyright and licence header.
5. THE third-party register at `docs/licences/third-party-register.md` SHALL be
   regenerated whenever dependencies change, and the regeneration SHALL be part
   of the same change.
6. THE build SHALL NOT include a Mac App Store target, which is incompatible
   with GPL-3.0.
7. THE application SHALL NOT require an account, display advertising, gate any
   feature behind payment, or depend on a network service for core
   functionality.
