# Phase 1: Application Foundation — Tasks

Execute in order. Tasks 1–3 de-risk the toolchain before any feature work, by
design: a broken native build or a blocked lifecycle script discovered at task
12 would invalidate everything above it.

Update `docs/progress-mindmap.svg` as each task changes status.

- [x] 1. Scaffold the project and prove the toolchain installs
  - Initialise `package.json` with the verified version matrix from
    `.kiro/steering/toolchain.md`, `engines.node >= 26`, and `"type": "module"`
  - Approve lifecycle scripts for `electron` and `better-sqlite3` explicitly;
    confirm `node_modules/electron/dist` and a compiled `better_sqlite3.node`
    both exist after a clean install
  - Add `electron.vite.config.ts` with main, preload and renderer builds
  - Add `tsconfig.json` with `strict`, `noUncheckedIndexedAccess`,
    `exactOptionalPropertyTypes`, and path aliases for `@main`, `@shared`,
    `@renderer`
  - Add `.oxlintrc.json` including `no-restricted-imports` rules enforcing the
    module boundaries from `.kiro/steering/architecture.md`
  - Add `vitest.config.ts`, `.gitignore`, `.nvmrc`
  - _Requirements: 12.1, 12.8, 13.5_

- [x] 2. Verify the native module against the Electron ABI
  - Wire `@electron/rebuild` into a postinstall script
  - Open a SQLite database from the main process and read `sqlite_version()`,
    confirming the module loads under Electron and not merely under host Node
  - _Requirements: 6.1, 12.8_

- [x] 3. Minimal secure Electron shell
  - `src/main/index.ts`: app lifecycle, single-instance lock, macOS activate
    handling
  - `src/main/window.ts`: `BrowserWindow` with `contextIsolation: true`,
    `nodeIntegration: false`, `sandbox: true`; show on `ready-to-show`
  - `src/main/security/csp.ts`: CSP via `onHeadersReceived`, tile hosts derived
    from the provider registry
  - `src/main/security/navigation.ts`: deny all window opens, cancel external
    navigation, allowlist-validated `shell.openExternal`
  - Render a placeholder React root to confirm the shell boots
  - _Requirements: 1.1, 1.3, 1.4, 1.5, 2.1, 2.5, 2.6, 2.7_

- [x] 4. Shared contracts
  - `shared/domain/`: `Trip`, `Folder`, `Settings`, `TreeNode`, `ObjectRef`
  - `shared/ipc/result.ts`: `Result<T>` union and `ErrorCode`
  - `shared/ipc/channels.ts`: namespaced channel constants
  - `shared/ipc/schemas.ts`: zod request schemas for every Phase 1 channel,
    including coordinate and name constraints
  - `shared/geo/`: haversine distance, bbox, unit formatting — pure, no imports
  - Unit tests for geo maths and schema rejection of malformed payloads
  - _Requirements: 2.3, 6.7, 11.4_

- [x] 5. Database layer
  - `main/db/client.ts`: better-sqlite3 + drizzle, `journal_mode = WAL`,
    `foreign_keys = ON`, `synchronous = NORMAL`, database in app support dir
  - `main/db/schema.ts`: all tables from the design document
  - `drizzle.config.ts` and generated migration `0001_initial`
  - `main/db/migrate.ts`: apply pending migrations at startup, fail loudly with
    an actionable message
  - Unit tests: migration applies to an empty temp database, is idempotent on
    second run, foreign keys are enforced, nullable elevation stays NULL
  - _Requirements: 6.1, 6.3, 6.4, 6.5, 6.8_

- [x] 6. Repositories and services for folders and trips
  - `main/db/repositories/`: folders, trips, settings, importHistory
  - `main/services/folderService.ts`: create, rename, move with ancestry cycle
    rejection, delete with child counting
  - `main/services/tripService.ts`: create, rename, update, duplicate (deep
    copy), move, archive, delete; transactional; each mutation returns the
    canonical object and the information needed to invert it
  - `main/services/settingsService.ts`: typed get/set with zod-validated values
  - Unit tests for every service method including cycle rejection and cascade
    behaviour on delete
  - _Requirements: 5.1–5.9, 6.6, 7.1, 11.3_

- [x] 7. IPC and preload bridge
  - `main/ipc/handler.ts`: the single `ipcMain.handle` wrapper, validate →
    delegate → `Result`
  - Namespace modules for trips, folders, library tree, settings, backup,
    window state, shell
  - `preload/index.ts`: `contextBridge` surface with named methods per
    namespace and no generic passthrough
  - Typed renderer client wrapping the bridge and unwrapping `Result`
  - Unit tests: invalid payloads are rejected, thrown service errors become
    `{ ok: false }`
  - _Requirements: 2.2, 2.3, 2.4, 2.8_

- [x] 8. Three-panel layout
  - Tailwind 4 setup via `@tailwindcss/vite` with `@theme` tokens for light and
    dark
  - `Layout.tsx`: resizable split panes with minimum widths
  - `uiStore`: panel sizes, visibility, theme; persisted through settings
  - Theme application including follow-system via `nativeTheme`
  - _Requirements: 3.1, 3.2, 3.3, 3.5, 7.2, 11.2_

- [x] 9. Trip library panel
  - Tree component: My Collection root, Folders hierarchy, Trips branch, and
    the Routes / Tracks / Waypoints / Imported Data / Recently Used view
    branches showing a "arrives in a later phase" state
  - Expansion state persistence, name and date sorting, search filtering
  - Context menus: new trip, new folder, rename, duplicate, archive, delete
  - Inline rename, drag-and-drop move with cycle rejection surfaced to the user
  - Destructive-action confirmation dialog stating child counts
  - _Requirements: 4.1–4.6, 5.4, 5.5, 5.6, 5.8, 7.2_

- [x] 10. Map panel
  - `shared/map/MapProvider.ts` interface and the OSM provider registry entry
  - `MapView`: single Leaflet instance held in a ref, strict-mode safe,
    `ResizeObserver` driving `invalidateSize()`
  - Attribution control, always visible
  - Descriptive User-Agent on tile requests; no prefetch, no area download
  - Controls: zoom in, zoom out, layer selector
  - Map position and zoom persisted and restored
  - Non-blocking offline indicator when tiles fail
  - _Requirements: 8.1–8.9, 3.4, 7.2_

- [x] 11. Properties panel
  - Inspector driven by `selectionStore`
  - Trip and folder property editing: name, description, notes; writes through
    the service layer
  - Empty and multi-selection states
  - _Requirements: 3.1, 4.4, 5.2_

- [x] 12. Application menus
  - Native menu bar: app, File, Edit, View, Trip, Help per source spec §16
  - Phase 1 functional items: New Trip, Save a Copy…, Backup, Restore, Quit,
    panel toggles, Map Layers, Zoom In/Out, Settings
  - Later-phase items present and disabled: Open, Import, Export, Undo, Redo,
    New Route, New Track, New Waypoint, Fit Trip to Screen
  - macOS standard shortcuts: ⌘N, ⌘W, ⌘Q, ⌘,
  - Menu-to-renderer action dispatch
  - _Requirements: 10.1–10.6_

- [x] 13. Settings surface
  - Settings panel or window: theme, map provider, units, backup frequency
  - Immediate persistence, live application, no restart
  - _Requirements: 11.1–11.4_

- [x] 14. Backup and restore
  - `backupService` using better-sqlite3 `db.backup()`, not file copy
  - Rolling automatic backups on a timer and at clean shutdown, bounded
    generations
  - Manual backup to a chosen location; restore with validation, pre-restore
    snapshot, confirmation, and state reload
  - Unit tests: snapshot restores to an equivalent database; a non-TrailRT
    file is refused and leaves the current database untouched
  - _Requirements: 9.1–9.4, 7.3_

- [x] 15. End-to-end tests
  - Playwright Electron harness pointed at a temporary app support directory
  - Launch and window visible
  - Map renders with tiles and visible attribution
  - Create, rename, delete a trip
  - Restart and confirm trip plus UI state persistence
  - _Requirements: 13.1, 13.3, 13.4, 1.2, 7.1, 7.2_

- [x] 16. Licence compliance surface
  - About window: application licence, written offer of source, repository link
    through the validated external-link path
  - Third-party component list with versions and licences, including Electron
    and Chromium notices, generated from the register rather than hand-maintained
  - Copyright and licence headers on source files
  - A script that regenerates `docs/licences/third-party-register.md`, so it
    stays in step with the lockfile
  - _Requirements: 14.1–14.5_

- [x] 17. Build, packaging and ad-hoc signing
  - `electron-builder.yml`: macOS target, DMG, arm64 and x64; no Mac App Store
    target, which GPL-3.0 precludes
  - Application icon, version, bundle identifier `com.trailrt.app`
  - `mac.identity: "-"` for ad-hoc signing with `hardenedRuntime: true`
  - `build/entitlements.mac.plist` with
    `com.apple.security.cs.disable-library-validation` and
    `com.apple.security.cs.allow-jit`; without these an ad-hoc signed Electron
    app will not launch
  - Notarisation configured but disabled, with the switch documented, so a
    Developer ID can be dropped in later without restructuring
  - Verify by doing: the bundle launches on Apple Silicon,
    `codesign --verify --deep --strict` passes, the DMG mounts, and a
    deliberately quarantined copy reproduces the expected Gatekeeper block so
    the documented workaround is tested rather than assumed
  - Document the System Settings → Privacy & Security → Open Anyway sequence in
    the README; do not tell users to disable Gatekeeper
  - _Requirements: 12.2–12.7, 12.9, 12.10, 14.6_

- [x] 18. Phase 1 verification pass
  - `tsc --noEmit`, `oxlint`, Vitest and Playwright all green
  - Walk the four source-spec acceptance criteria against the packaged build:
    launches on macOS, map renders, trip create/rename/delete works, trips
    persist across restart
  - Update the mindmap to show Phase 1 complete
  - Record any discovered limitation in `docs/adr/` rather than leaving a
    placeholder in the UI
  - _Requirements: all_
