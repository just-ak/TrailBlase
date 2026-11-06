# Phase 5: Windy Roads Routing — Initial Investigation

Status: complete. This is the section 1 deliverable of the feature
specification, and it is deliberately the first document in the phase because
the feature brief rests on three assumptions about the codebase that are **not
true today**.

Every claim below cites a file. Nothing here is inferred from the project
description.

## Headline finding

> The brief describes this as "an enhancement to the existing routing
> architecture", integrating with "the existing routing, OpenStreetMap data,
> snap-to-road functionality and GPX export capabilities".
>
> **Of those four, only GPX export exists.** There is no routing engine, no
> road-network data, and no snap-to-road anywhere in `src/`.

This is not a blocker, but it changes what the phase is. Windy-roads routing
cannot enhance a routing architecture that has not been built. It has a hard
dependency on Phase 4 delivering the `RoutingProvider` interface and
snap-to-road first, and this phase is sequenced after it for that reason.

Saying so now is cheaper than discovering it during design.

## 1. Architecture, frameworks and languages

| Concern  | Finding                                                                        |
| -------- | ------------------------------------------------------------------------------ |
| Shell    | Electron 45.2.3, three processes: `src/main/`, `src/preload/`, `src/renderer/` |
| Language | TypeScript 7.0.2, strict, `exactOptionalPropertyTypes` on                      |
| UI       | React 19.3.1, Tailwind 4, Leaflet 1.9.4 used directly (ADR 0008)               |
| Store    | SQLite via `better-sqlite3` 13 + `drizzle-orm`, WAL mode                       |
| Build    | `electron-vite` 6, `oxlint`, `vitest`, Playwright                              |

Module boundaries are enforced by lint rules in `.oxlintrc.json`:
`src/shared/` may not import `electron`, `node:*`, `react` or any driver;
`src/renderer/` may not import `electron`, `node:*` or a driver and reaches the
system only through the preload bridge.

## 2. How routes are calculated between two coordinates

**They are not.** Route creation is manual point placement, and the code says so
in as many words.

- `src/renderer/features/map/useDrawMode.ts` binds a Leaflet `click` handler
  that appends exactly one vertex per click. No interpolation happens between
  vertices. The preview polyline is drawn with `dashArray: '8 6'` and the
  comment at lines 105–120 states: _"Dashed: these are straight lines, not
  road-snapped geometry"_.
- `src/renderer/features/map/MapView.tsx:484` renders a visible hint bar reading
  **"Straight lines — not snapped to paths"**.
- `src/renderer/lib/actions.ts:60` `createRouteFromPoints()` passes the clicked
  points straight to `routes:create`. Every later gesture funnels through the
  private `setGeometry()` at line 81, which sends the **whole** array.
- `src/main/services/routeService.ts:85` `create` and `:142` `setGeometry`
  replace the point array and recompute the statistics cache in one
  transaction. Geometry is stored exactly as supplied. Nothing is computed,
  snapped, interpolated or re-sampled.

`src/shared/geo/routeEdit.ts` is pure array transforms: `appendPoint`,
`movePoint`, `deletePoint`, `insertPointAt`, `reversePoints`, `reorderPoint`,
`closestSegment`, `closestVertex`. `closestSegment` is the only projection code
in the app and it projects a click onto **the user's own polyline** for
click-to-insert — not onto a road.

## 3. Which routing engine or API is in use

**None.** `package.json` runtime dependencies are exactly:

```
better-sqlite3  drizzle-orm  fast-xml-parser  fit-file-parser  jszip
```

There is no OSRM, Valhalla, GraphHopper or BRouter client, and **no HTTP client
of any kind**. A grep across `src/**/*.{ts,tsx}` for
`snap|overpass|osrm|valhalla|graphhopper|brouter|routing|bearing|curvature` returns
zero implementation hits — every match is either the word "snapshot" or a
comment stating that snapping does not happen.

The abstraction was deliberately left undeclared. `src/shared/map/MapProvider.ts`
lines 8–11:

> `RoutingProvider` and `GarminMapProvider` are deliberately _not_ declared
> here. An interface with no implementation and no caller is a placeholder, and
> the steering rules forbid those.

So there is no existing implementation to extend, and the brief's instruction —
"do not introduce a second routing engine without establishing why the existing
implementation cannot support the feature" — resolves trivially: there is no
first engine. Phase 4 introduces one. The question for this phase is whether
**Phase 4's choice** can carry custom curvature weighting, not whether to
displace an incumbent.

## 4. How OpenStreetMap data is obtained and consumed

**Raster tile imagery only, and the CSP structurally prevents anything else.**

`src/shared/map/MapProvider.ts` registers exactly one provider:
`https://tile.openstreetmap.org/{z}/{x}/{y}.png`, `kind: 'raster-tiles'`,
maxZoom 19. There is no vector data, no road network, no Overpass, no OSM API
and no Nominatim.

`src/main/security/csp.ts` is the hard constraint:

- `img-src 'self' data: blob: <tileHosts>` — tile hosts are allowlisted **for
  images only**
- `connect-src 'self'` in production; development adds only
  `ws://localhost:*` and `http://localhost:*`

**A `fetch` to any routing or Overpass endpoint is blocked today.** Any network
road-data design has to come with a declared host and a deliberate CSP widening,
which is the behaviour the policy was built to force.

`MapProvider.ts:40–46` also records the OSM tile usage policy obligations the
project has accepted: a descriptive User-Agent, **no prefetching, no bulk or
area downloads**, and caching limited to tiles fetched for user-initiated
viewing. That constrains any proposal to bulk-fetch road geometry from OSM
infrastructure.

## 5. Client-side or server-side

**Entirely in-process, with no worker and no server.** A grep for
`worker_threads|child_process|new Worker|fork\(|spawn\(` across `src/` returns
no matches. `src/main/index.ts` has no `createServer` or `listen`; the only
background activity is `scheduleAutomaticBackups()` on a `setInterval`.

All computation — statistics, simplification, packing, parsing — runs
synchronously in the main process inside better-sqlite3 transactions.

This matters for curvature scoring: there is nowhere to offload CPU work to
today. The CSP already permits `worker-src 'self' blob:` even though nothing
uses it, so a worker is available if the design needs one, but introducing the
first one is a decision rather than a detail.

## 6. How snap-to-road currently works

**It does not exist.** It is specified in
`.kiro/specs/phase-4-advanced-mapping/requirements.md` Requirement 3, with eight
acceptance criteria, and is unimplemented. The relevant Phase 4 commitments this
phase inherits:

- control points the user placed are retained alongside the snapped shape, so a
  later edit re-snaps only the affected legs (3.3)
- a point-count preview before applying a snap (3.4), and undoability (3.5)
- an unmatched leg stays straight and is marked as such (3.6)
- **tracks are never snapped** (3.7) — a recording is measured data
- transport mode is explicit and recorded (3.8)
- explicit opt-in before route geometry is sent to any service (3.9)

`src/renderer/features/map/useDrawMode.ts:14–16` notes that "nothing has been
snapped to a road, which no provider does until Phase 4".

## 7. Internal route geometry representation

`src/shared/domain/types.ts`:

```ts
export interface RoutePoint {
  lat: number;
  lon: number;
  ele: number | null; // metres; null when unknown, never 0
  name: string | null;
  symbol: string | null;
  notes: string | null;
}
```

`src/main/db/schema.ts`:

- `routes` — `id, trip_id, name, colour, source`, the stats cache
  (`point_count, distance_m, elev_gain_m, elev_loss_m`), and
  **`metadata TEXT`** (JSON, the only extensibility point on the table)
- `route_points` — `id, route_id, seq, lat, lon, ele_m, name, symbol, notes`
  with `unique('uq_route_points_seq').on(routeId, seq)`. Source of truth.

**Constraints this creates for the feature:**

1. **There is no per-point or per-leg attribute slot.** No bearing, no road
   class, no curvature, no speed, no matched/unmatched flag, no provider field.
   `routes.metadata` is JSON on the route, not the leg.
2. `source` is `'user' | 'import'` only, enforced by a CHECK constraint. It is
   provenance of the _geometry_, not of a routing provider. Phase 4 Requirement
   2.4 asks for provider recording and **no column exists for it**.
3. Routes have **no `render_geometry` cache**. That pattern exists on `tracks`
   only (`render_geometry` blob + `render_tolerance_m`), because routes were
   small enough to ship whole.

## 8. The hard ceiling nobody will expect

`src/shared/ipc/schemas.ts`:

```ts
export const routePointsSchema = z.array(routePointSchema).max(10_000);
```

The comment explains it: _"a human-placed route is tens to low hundreds, and the
cap keeps a single undo entry bounded."_ And it is load-bearing, because
`routeService.setGeometry`'s inverse carries the **entire previous point array**
(`routeService.ts:155–160`) — that is what makes every editing gesture undoable
through one command.

**A snapped winding route will breach this.** Road geometry at OSM digitisation
density runs to thousands of points for a few tens of kilometres; a deliberately
twisty 200 km motorcycle route is plausibly 20,000–50,000 points. So the feature
cannot ship without resolving the interaction between:

- the 10,000-point validation cap,
- undo entries that carry whole point arrays, and
- Phase 4's commitment to store control points separately from the snapped
  shape.

This is the single most consequential constraint found, and it is an
architecture question, not a tuning one.

## 9. Geometry maths available

`src/shared/geo/` — four modules, all pure, all unit-tested without Electron:

| Module         | Exports                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `distance.ts`  | `haversineDistance` (IUGG radius 6 371 008.8 m), `pathDistance`, `elevationStats`, `boundingBox`, `isValidLat/Lon` |
| `simplify.ts`  | `simplifyIndices`, `simplify<T>`, `toleranceForZoom`; iterative Douglas-Peucker with an explicit stack             |
| `packed.ts`    | `packPolyline`, `unpackPolyline`, `packedPointCount`; little-endian Float64, 16 bytes per point                    |
| `routeEdit.ts` | array transforms, `closestSegment`, `closestVertex`                                                                |
| `units.ts`     | formatters, `estimateDurationSeconds`, `ABSENT = '—'`                                                              |

**Explicitly absent: bearing, heading, initial/final course, turn angle,
curvature, radius of curvature, sinuosity, azimuth.** There is no
angle-returning function anywhere in the project. The only trigonometry is
inside Haversine, the planar `cos(lat)` scaling, and perpendicular distance.

A twistiness score is therefore built from zero. On the positive side,
`shared/geo/` is exactly the right home for it: pure, dependency-free and
testable without Electron, per `.kiro/steering/architecture.md`.

## 10. GPX generation and import

`src/main/io/gpx/write.ts` — hand-written GPX 1.1, not an XML builder, for one
stated reason: **numeric precision**. `numberText(value) = String(value)`,
because `String` round-trips every double exactly and `toFixed` would "quietly
drop or invent digits". Routes emit `<rte><name>` then per point
`<rtept lat lon>` with `<ele>`, `<name>`, `<cmt>`, `<sym>`; `element()` omits a
tag entirely when the value is `null`.

**Point-density policy: no rounding, no re-sampling, no decimation on write.**
So the brief's requirement to "avoid unnecessary route-point proliferation"
(section 6) cannot be met by thinning on export. It has to be met by not
generating redundant points, or by an explicit, user-visible simplification —
`shared/geo/simplify.ts` already exists for that and Phase 3 established the
pattern of previewing the resulting point count before applying.

`read.ts` uses `RTE_KNOWN = ['name','rtept','extensions']` to drive an
unknown-key sweep: anything outside that list is captured into `metadata` and
**reported as unmapped** rather than dropped.

## 11. Existing routing preferences and configuration

`AppSettings` (`src/shared/domain/types.ts:129`) has exactly one
routing-adjacent field:

```ts
/** Used for route duration estimates. Nothing is estimated without it. */
planningSpeedKmh: number; // default 4.5 — walking pace
```

Consumed by `estimateDurationSeconds()`, which returns `null` rather than
inventing a duration. `.kiro/specs/spec-review.md:46–50` records why it exists:
duration needs either recorded timestamps (routes have none) or a routing
provider (Phase 4).

**No transport mode, no routing provider id, no endpoint, no snap tolerance, no
avoid/prefer preferences.** Settings are one JSON-encoded row per key in the
`settings` table, validated against a zod schema on write.

Note the default is 4.5 km/h — this app currently assumes a _walker_. A
motorcycle-oriented feature will want a mode-aware default, which is a settings
change, not just a new preference.

## 12. Caching, error handling and IPC conventions

**Caching** — two established patterns, both documented as "rebuildable, never
the only copy" (`.kiro/steering/architecture.md`):

1. _Stats cache_ on `routes`/`tracks`, recomputed in the same transaction as the
   geometry write.
2. _Render-geometry cache_ on `tracks` only: `render_geometry` blob +
   `render_tolerance_m`, built by `trackService.rebuildRenderCache`, invalidated
   on edit. This is the precedent a curvature-score cache should follow.

**Errors** — `src/main/services/errors.ts`: services throw
`ServiceError(code, message, detail?)`; `toErrorShape` translates raw SQLite
text so internal column names never reach the user.

**IPC** — `src/main/ipc/handler.ts` is "the only place `ipcMain.handle` is
called". `handle(channel, schema, fn)` zod-validates **before** any service
runs and wraps the outcome in a discriminated
`{ ok: true, data } | { ok: false, error }`. Nothing throws across the boundary.
`register.ts:92` `commit<T>(mutation)` records the inverse, notifies the library
and republishes undo state.

**Undo** — `Mutation<T> { result, inverse: { kind, payload } }`. Stacks live in
the main process, `MAX_DEPTH = 50`. `commands.ts` maps kind → service call, so
the inverse of the inverse comes free. Documented limits: entries hold command
descriptors, not snapshots, "so the stack cannot grow unboundedly with the size
of the data" — except `route:setGeometry`, which is precisely why the 10,000
cap exists.

## 13. Tests and conventions

- Unit tests co-located as `*.test.ts`, run by `vitest`. Pure logic in
  `shared/` is tested with no Electron in the loop. 556 tests currently pass.
- `test-data/README.md`: **"Every file here is synthetic. No real user GPS data
  is used in automated tests."** Fixtures are invented coordinates in the
  Swiss/Italian Alps. Binary and bulk fixtures are generated by
  `npm run fixtures`, not committed.
- Playwright e2e in `tests/e2e/` drives the real packaged app, each test with an
  isolated user-data directory. 49 tests pass, including against the DMG.
- Full gate: `npm run verify` = lint → typecheck (node + web + e2e) → unit
  tests → build → e2e.

The synthetic-fixture rule interacts with the brief's section 10 request for
"realistic test scenarios using OpenStreetMap road geometry". Real OSM extracts
are ODbL-licensed data, not user GPS traces, so they are not excluded by the
no-real-user-data rule — but committing them has size and attribution
consequences that the design stage must settle.

## 14. Routing engine capability — preliminary evidence

Not a decision. Evidence gathered so that the design stage starts from facts.

The feature's central requirement is that twistiness **influences the search**
rather than being computed after a conventional route exists (brief section 4).
That rules out the cheapest implementation and drives everything else, because
it means custom edge weighting, which in turn means graph access.

| Candidate                             | Licence      | Custom curvature weighting                                                      | Cost of adoption                                                                                         |
| ------------------------------------- | ------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Valhalla                              | MIT          | Rich dynamic costing options, but no arbitrary per-edge user weights            | C++ service + OSM tile build; already the Phase 4 candidate for map matching and speed limits (ADR 0011) |
| GraphHopper                           | Apache-2.0   | Has a `motorcycle` vehicle and a `curvature` weighting, plus JSON custom models | JVM + an OSM import step; a second runtime for a desktop app                                             |
| OSRM                                  | BSD-2-Clause | Weights are baked at preprocessing time via Lua profiles, not per request       | Requires re-preprocessing to change weighting                                                            |
| In-house graph over a bounded extract | n/a          | Total control                                                                   | We implement routing; real work, no new runtime                                                          |

Two caveats that matter more than the table:

1. **GraphHopper's off-the-shelf curvature support is narrower than it looks.**
   A maintainer answer on the project forum states that with custom weighting
   you can only multiply priority by a _constant_ factor based on the curvature
   value, and that the curvature value cannot be used on the right-hand side of
   an expression
   ([GraphHopper forum, 2022](https://discuss.graphhopper.com/t/use-weighting-curvature-and-custom/7134)).
   Whether that is still true needs re-verifying against the current release
   before it is relied on.
2. **A hosted routing API cannot do this at all.** Public endpoints do not accept
   caller-supplied per-edge weights. So "use a hosted service" and "twistiness
   influences the search" are mutually exclusive, and the brief chose the latter.

GraphHopper is Apache-2.0 and Valhalla is MIT, both GPL-3.0 compatible, so
licence is not the deciding factor here — operational weight is. Any
self-hosted engine means shipping or requiring a second runtime and a
multi-gigabyte OSM extract, against a project whose current install is one
134 MB DMG with no server.

_Content from external sources on this page was rephrased for compliance with
licensing restrictions._

## 15. Architectural constraints this phase inherits

Carried forward into the requirements as hard constraints:

1. **Phase 4 must land first.** No routing provider, no snap-to-road, no
   transport mode exists to build on.
2. **`connect-src 'self'`** blocks every outbound request today. Road data needs
   a declared host and a deliberate CSP change.
3. **OSM tile policy forbids bulk and area downloads**, so road geometry cannot
   be scraped from OSM's own infrastructure.
4. **The 10,000-point route cap** and whole-array undo entries must be resolved
   before snapped geometry can be stored.
5. **No per-leg attribute storage** exists; curvature scores and road class need
   somewhere to live that is explicitly a cache.
6. **No bearing or angle maths** exists; it is built from scratch in
   `shared/geo/`.
7. **No worker or server** exists; CPU-heavy scoring has nowhere to go unless one
   is introduced deliberately.
8. **`shared/` must stay dependency-free** — no `node:*`, no driver, no
   `electron`. The scoring algorithm belongs there and must respect that.
9. **Nulls are load-bearing throughout.** Unknown is never 0. A road with no
   determinable curvature is not a straight road.
10. **No cloud dependency for core functionality**, and no transmission of user
    location data to third parties without explicit, named opt-in
    (`.kiro/steering/licensing.md`, ADR 0011).
