# Phase 4: Advanced Mapping — Design

## Scope

Eight requirements, delivered as sixteen independently testable tasks. The
phase proves three abstractions that Phase 1 declared but never exercised:
a second map provider, a routing provider, and derived road attribution.

## The shape of the problem

Phases 1–3 built a local-first application with **no network calls except tile
images**. `src/main/security/csp.ts` sets `connect-src 'self'`, so the routing
work is the first time the app talks to a service at all. That is the organising
constraint of this design: every network capability is opt-in, declares its
host, and the application remains completely functional without it.

```
                      ┌─ no provider configured (default) ─ straight lines, as today
RoutingProvider ──────┤
                      └─ user-supplied endpoint ─ snap-to-road, speed limits, road class
```

## Decisions

### 1. Map providers: OpenTopoMap, plus a user-supplied source

`MAP_PROVIDERS` gains two entries and an overlay concept.

| Provider | Kind | Key | Hosts |
| --- | --- | --- | --- |
| `osm` | raster | no | `tile.openstreetmap.org` |
| `opentopomap` | raster | no | `a/b/c.tile.opentopomap.org` |
| `custom` | offline / user-supplied | no | declared by the user |

OpenTopoMap is the terrain provider required by Requirement 1.1. Its tiles are
CC-BY-SA 2.0 over OpenStreetMap data under ODbL, so the attribution string
names both the data and the rendering, and it is rendered verbatim by the
existing attribution control.

**Overlays are a separate registry with the same host-declaration contract.**
Requirement 1.6 asks for overlays independent of the base layer; the mechanism
is implemented and proven by the user-supplied overlay, which is also what
satisfies Requirement 8.1's local tile source. **No third-party overlay server
is adopted**, because doing so means accepting another operator's usage policy,
and the licensing steering requires that check before adoption rather than
after. A documented gap beats an unvetted dependency.

The `custom` provider doubles as the offline groundwork: a `file://` or
`http://localhost` template with a declared host needs no new code path.

### 2. `RoutingProvider` lives in `shared/`, its wire format does not

```
shared/routing/RoutingProvider.ts   interface + domain types, no HTTP
main/routing/valhalla.ts            the only file that knows Valhalla's JSON
main/routing/client.ts              fetch with timeout, abort, error mapping
main/routing/polyline.ts            polyline6 decode
```

The interface speaks domain terms — `RouteLeg`, `MatchedEdge`, `SnapResult` —
and never Valhalla's. That is what makes a second provider a new adapter rather
than a refactor, and it means a wire-format mistake is contained in one file.

**Valhalla is the first adapter** because it is MIT licensed and, per ADR 0011,
the only open-source engine that returns posted speed limits and road class from
map matching. Two wire details that are easy to get wrong and are therefore
isolated and tested:

- **Shape is polyline6**, not polyline5. Decoding at precision 5 yields
  coordinates in the wrong place entirely rather than failing loudly.
- **`length` and `speed_limit` default to kilometres and km/h.** The adapter
  requests `directions_options: { units: 'kilometers' }` explicitly and converts
  to SI metres and m/s at the boundary, because the rest of the app stores SI.

`trace_attributes` is requested with an explicit `filters.attributes` include
list rather than the default "everything", because the default response for a
long trace is very large and most of it is unused.

**No default endpoint ships.** `routingEndpoint` defaults to `''`. There is no
public instance baked in, so the app cannot send a user's route anywhere until
they configure a host and accept the consent notice.

### 3. Snapping: control points are the user's intent, the shape is derived

Requirement 3.3 asks that placed points be retained so an edit re-snaps only
the affected legs. That needs a second geometry layer.

```
route_control_points   what the user placed       (new table, Phase 4)
route_points           the shape that is drawn    (existing, source of truth
                                                   for display and export)
```

A route with no control points is a hand-drawn route, exactly as today —
which is how Requirement 2.5's "normal behaviour is unchanged" stays true
without a feature flag.

`routes` gains `routing_provider`, `transport_mode` and `snapped_at` so the
geometry's origin is auditable (Requirement 2.4).

#### The point-count problem, and what this phase does about it

`routePointsSchema` caps geometry at 10,000 points because
`route:setGeometry`'s undo inverse carries the entire previous array. Snapped
road geometry is denser than hand-placed geometry by one to two orders of
magnitude.

The resolution here is deliberately narrow, because the general answer belongs
to Phase 5:

- The IPC cap stays at 10,000. It bounds a **renderer-supplied** payload, and
  snapped geometry is generated in the main process and never arrives that way.
- Snapped geometry is capped at `MAX_SNAPPED_POINTS = 25_000`, enforced in the
  service. Beyond that the snap is refused with the count, rather than stored
  and silently unexportable.
- **Undo carries the previous array only when it is under 10,000 points.**
  Above that the snap reports `inverse: { kind: 'none' }` and the UI says the
  operation cannot be undone, following the precedent set by
  `trackService.restoreOriginal` — an honest refusal beats an inverse that would
  be a multi-megabyte snapshot.

#### Unmatched legs

A leg the provider cannot match stays as the straight line the user drew and is
recorded in `routes.metadata.unmatchedLegs` as control-point index pairs. The
map draws those legs dashed, the same visual language already used for the
unsaved drawing preview. Partial success is normal and is reported, not failed.

### 4. Road attributes are a cache keyed by a geometry hash

Map-matched speed limits and road classes go in one new table:

```sql
road_attributes(owner_type, owner_id, provider, geometry_hash,
                fetched_at, payload JSON)
```

`geometry_hash` is a SHA-256 over the rounded coordinate sequence. On read, the
hash is recomputed and a mismatch means the cache is stale — which is how
Requirement 6.3's invalidation-on-edit is enforced without a trigger. Same
contract as every other derived value: rebuildable, never the only copy.

`payload` holds per-edge records (`startIndex`, `endIndex`, `speedLimitMps`,
`roadClass`, `surface`) plus the provider and fetch date, so Requirement 8.4 can
display stale cached data with its age when the provider is unreachable.

### 5. Profiles are computed in the main process, drawn as hand-written SVG

`shared/geo/profile.ts` turns geometry into bands over cumulative distance.
`shared/geo/speedBands.ts` turns per-edge attributes into a distance-weighted
distribution.

Both are pure, in `shared/`, and tested without Electron. Two properties that
tests pin down because they are the easy things to get wrong:

- **Distribution is weighted by distance, not point count.** Sample spacing is
  not uniform, so counting points over-weights slow sections — ADR 0011 §3.
- **Unknown is a band.** Distance with no determinable speed is reported, never
  redistributed. Given that OSM `maxspeed` coverage is partial, this band is
  often the largest one, and that is the correct answer.

The chart is hand-written SVG. No charting library, which keeps the licence
register unchanged and avoids a dependency for something that is a `<path>` and
a `<rect>` per band. A 200,000-point track is profiled from the existing render
cache, and the panel says when the view is simplified.

### 6. Measuring, scale and coordinates

`L.control.scale` is built into Leaflet and honours the configured unit system.
Cursor coordinates reuse `formatCoordinates` from `shared/geo/units.ts`.

The measure tool is a distinct editor mode alongside `drawRoute` and
`placeWaypoint`, reusing `useDrawMode`'s pending-points pattern and
`pathDistance`. It creates nothing — Requirement 4.5 is explicit that measuring
must not create a route — so it has no service, no IPC and no undo entry.

### 7. Waze stays as ADR 0005 specified it

Single destination, resolving a route or track to its **end point**, with the
menu label saying so. `shell.openExternal` after coordinate validation through
the existing `security/navigation.ts` allowlist. No "open route in Waze",
because Waze rejects multi-waypoint URLs.

## Data model changes

Migration `0002_routing_and_attributes`:

```
routes          + routing_provider TEXT      (null for hand-drawn)
                + transport_mode    TEXT
                + snapped_at        INTEGER

route_control_points  (new)  id, route_id, seq, lat, lon
                             unique(route_id, seq)

road_attributes       (new)  id, owner_type, owner_id, provider,
                             geometry_hash, fetched_at, payload
                             unique(owner_type, owner_id)
```

`AppSettings` gains:

| Key | Default | Purpose |
| --- | --- | --- |
| `routingEndpoint` | `''` | Base URL. Empty means no provider. |
| `routingConsentAccepted` | `false` | Gates every outbound routing call. |
| `transportMode` | `'auto'` | `auto` / `motorcycle` / `bicycle` / `pedestrian` |
| `mapOverlayId` | `''` | Overlay independent of the base layer |
| `customTileUrl` | `''` | The `custom` provider's template |
| `showScaleBar` | `true` | |
| `layerVisibility` | all true | Routes / tracks / waypoints toggles |

### CSP becomes a function of settings

`buildCsp()` currently takes tile hosts. It gains the configured routing origin
in `connect-src`. The origin is parsed and validated — scheme must be `https:`,
or `http:` only for a loopback host, so a self-hosted instance works without
opening the door to plaintext anywhere else.

`connect-src` is never widened to a wildcard. A provider reaches exactly the
origin the user named.

## Error handling and fallback

| Failure | Behaviour |
| --- | --- |
| No endpoint configured | Snap and speed features unavailable, with an explanation. Drawing works. |
| Consent not accepted | Same, plus the consent prompt naming the host. |
| Timeout / network error | `ServiceError('PROVIDER_UNAVAILABLE')`, geometry untouched, cached attributes still shown with their age. |
| Provider returns no match | Legs kept straight and marked unmatched; the snap still succeeds partially. |
| Snap exceeds the point cap | Refused with the count, before anything is written. |

A failed snap never leaves a route half-modified: the write happens in one
transaction after the provider has responded.

## Testing strategy

The provider-dependent code is tested without a live Valhalla instance, because
a test that needs a service is a test that does not run.

1. **Adapter unit tests against canned responses.** Synthetic Valhalla JSON
   fixtures in `test-data/routing/`, authored by hand from the published API
   reference. These catch the polyline-precision and unit-conversion mistakes.
2. **A loopback HTTP server in the test** for the client: timeout, abort,
   non-200, malformed JSON. This exercises the real `fetch` path.
3. **Pure maths tested directly** — bearing, turn angle, profile resampling,
   distance-weighted banding, the Unknown band.
4. **E2E with the dialog stubbed in the main process**, as Phase 3 does for file
   dialogs, plus a loopback routing endpoint for the snap path.

The honest limitation, recorded here and in the README: **the adapter is
verified against the published API reference and synthetic fixtures, not against
a live Valhalla deployment.** Until it is exercised against a real instance, the
wire-format mapping is evidence-based but unproven. That is stated in the UI as
well as here, rather than implied to be tested.

## Out of scope, deliberately

- Curvature-aware routing — Phase 5, which this phase unblocks.
- Tile prefetching or area download — forbidden by Requirement 8.2 and the OSM
  tile usage policy.
- Bundling an OSM extract or a routing engine binary.
- A second routing adapter. One proves the interface; a second without a user
  asking for it is speculation.
