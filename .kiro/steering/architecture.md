# Architecture rules

## Module boundaries

Keep map rendering, routing, trip management, file conversion and database
access in separate modules. These boundaries are load-bearing, not cosmetic:
Garmin map support and alternative routing providers are planned, and they must
drop in without touching trip management.

```
src/
  main/        Electron main process. Owns filesystem, database, dialogs, menus.
    db/        drizzle client, migrations, repositories
    services/  use-case layer called by IPC handlers
    ipc/       one module per namespace; validates then delegates
    io/        import/export (Phase 3+), io/garmin/ (Phase 6)
    security/  CSP, navigation and permission guards
    menu/      application menu definition
  preload/     contextBridge surface only. No logic.
  shared/      contracts imported by BOTH processes
    domain/    entity types
    ipc/       channel names + zod request/response schemas
    geo/       pure geometry maths (distance, bbox, simplify)
  renderer/    React. No filesystem, no database, no node builtins.
    features/  library/ map/ properties/ settings/
    stores/    zustand
    components/
```

Rules that follow from this:

- `shared/` must not import `electron`, `node:*`, `react`, or any driver. It is
  plain TypeScript so both sides and unit tests can use it freely.
- `renderer/` reaches the system only through the preload bridge. Never add
  `nodeIntegration`, and never pass a path to the renderer expecting it to read
  it.
- Geometry maths lives in `shared/geo/` as pure functions. Distance, ascent and
  bbox calculations are used by import, statistics and the map alike, and they
  must be unit-testable without Electron.
- A provider interface (`MapProvider`, `RoutingProvider`, `GarminMapProvider`)
  is defined in `shared/` and implemented elsewhere. Trip management code must
  never reference a concrete provider.

## Electron security (non-negotiable)

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Preload exposes a narrow, explicitly enumerated API. No generic
  `invoke(channel, args)` passthrough, which would defeat the whole exercise.
- Every IPC handler validates its payload with a zod schema before use, and
  returns a discriminated `{ ok: true, data } | { ok: false, error }` result
  rather than throwing across the boundary.
- A strict CSP is set on responses. Tile hosts are allowlisted in `img-src`
  only; `script-src` stays `'self'`.
- `setWindowOpenHandler` denies all window opens; external links go through
  `shell.openExternal` after the URL is validated against an allowlist of
  schemes and hosts.
- Imported file content is untrusted. Never render imported HTML or SVG, and
  treat GPX/KML description fields as plain text.

## Data integrity

- Imported geometry is preserved byte-faithfully in its original form. Never
  re-sample, simplify or round an import on the way in. Simplification is an
  explicit, user-initiated, non-destructive action.
- Missing data stays missing. Absent elevation is `null`, never `0`, and
  elevation gain over a route with no elevation data is `null`, never `0`. Do
  not synthesise values to make a UI field look populated.
- Derived values (distance, ascent, simplified render geometry) are caches.
  Mark them as such, recompute from the source of truth, and never let a cache
  become the only copy of something.

## Honesty about limitations

If a feature cannot be implemented reliably, say so in the spec and in the UI.
Do not ship a control that looks functional but does nothing, and do not claim
support for a proprietary format that has not been tested against real sample
files. A documented gap is worth more than a misleading placeholder.

## Testing

Unit tests sit alongside the code they cover (`*.test.ts`). Pure logic —
geometry, parsers, statistics, validation — is tested directly with no Electron
in the loop. Playwright drives the packaged app for launch, persistence and
restart flows. Test fixtures live in `test-data/` and are synthetic; never use
real user GPS data in automated tests.
