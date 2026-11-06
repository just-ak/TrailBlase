# Phase 5: Intelligent Windy Roads Routing — Requirements

Status: not started. **Blocked on Phase 4.** See
[`investigation.md`](investigation.md) for why that dependency is hard rather
than a sequencing preference.

## Introduction

Generate motorcycle-friendly routes between two points that actively favour
winding, interesting roads rather than the shortest or fastest line.

### What the investigation changed about this phase

The feature brief describes an enhancement to "the existing routing,
OpenStreetMap data, snap-to-road functionality and GPX export capabilities". The
mandatory codebase investigation found that **of those four, only GPX export
exists**:

- there is no routing engine, no routing API client, and no HTTP client at all
- OpenStreetMap is consumed as raster tile imagery only; `connect-src 'self'`
  in `src/main/security/csp.ts` blocks every outbound request today
- snap-to-road is Phase 4 requirement text, unimplemented
- there is no bearing, turn-angle or curvature maths anywhere in the project

So this phase does not enhance a routing architecture. It is the phase that
makes Phase 4's routing architecture *curvature-aware*, and it cannot begin
before Phase 4 exists. The brief's instruction — "do not introduce a second
routing engine without establishing why the existing implementation cannot
support the feature" — resolves as: there is no first engine, Phase 4 chooses
one, and this phase's job is to establish whether that choice can carry custom
curvature weighting rather than to displace an incumbent.

### The constraint that will shape the design most

`src/shared/ipc/schemas.ts` caps route geometry at **10,000 points**, because
`routeService.setGeometry`'s undo inverse carries the entire previous point
array. A deliberately twisty 200 km route at OSM digitisation density is
plausibly 20,000–50,000 points. Requirement 8 exists to resolve that; it is an
architecture question, not a tuning one.

### Two distinctions carried in from earlier phases

1. **Calculating a route is not map matching a track.** Map matching takes an
   existing recorded trace and finds the roads it followed. Routing takes two
   points and finds a path. They share a provider and nothing else, and ADR
   0011 §4 already forbids snapping tracks because a recording is measured data.
2. **Unknown is a value.** A road whose curvature cannot be determined is not a
   straight road, exactly as absent elevation is `null` and never `0`.

## User stories

1. As a motorcyclist planning a weekend ride, I want to enter a start and
   destination and get a route that favours bends, so that I do not have to
   hand-draw every interesting road I already know.
2. As the same rider, I want to control *how* twisty, because "as twisty as
   possible" and "a pleasant route that still gets me there" are different
   requests on different days.
3. As someone with a destination to reach, I want to cap how much extra distance
   the route may add, so that a scenic route does not become an impractical one.
4. As a rider on a road bike, I want unsuitable surfaces and inaccessible roads
   excluded, so that the route does not send me down a rutted farm track.
5. As an existing user who does not want any of this, I want normal routing to
   behave exactly as it did, so that a new feature does not change my workflow.
6. As a privacy-conscious user, I want to know before my planned route leaves my
   machine, and to be able to run the whole thing locally.
7. As a rider exporting to a device, I want the generated route to export as GPX
   that my device accepts.

## Requirements

### Requirement 1: Routing engine capability assessment

The deliverable is a documented finding, not a feature. It gates Requirement 5.

#### Acceptance criteria

1. THE phase SHALL begin by assessing whether the routing provider selected in
   Phase 4 can express a caller-supplied, per-edge curvature cost, and SHALL
   record the finding with evidence.
2. THE assessment SHALL re-verify, against the then-current release, whether
   GraphHopper's custom models can use a curvature value as a term in an
   expression rather than only as a constant multiplier, because a project
   forum answer from 2022 states the latter and that limitation would materially
   change the design.
3. THE assessment SHALL state explicitly that a hosted routing API cannot accept
   caller-supplied per-edge weights, and SHALL therefore NOT propose one as a
   way to satisfy Requirement 5.3.
4. WHERE a second routing engine is proposed THE assessment SHALL compare
   integration effort, hosting requirements, data requirements, licence,
   performance and maintenance against extending the Phase 4 provider, and SHALL
   justify the addition rather than assert it.
5. THE assessment SHALL prefer the option that adds the least new
   infrastructure and operational complexity, and SHALL say plainly what each
   option costs the user in download size, runtime dependencies and setup.
6. Any engine adopted SHALL have a licence compatible with GPL-3.0, verified
   per `.kiro/steering/licensing.md` before adoption, and recorded in the
   third-party register.

### Requirement 2: Routing modes and preferences

#### Acceptance criteria

1. THE system SHALL provide a routing mode selector offering, at minimum:
   **Normal**, **Slightly Winding**, **Winding** and **Very Winding**.
2. **Normal SHALL preserve existing behaviour exactly.** No change to geometry,
   statistics, storage, undo behaviour or export for a user who does not opt in.
   This is a regression requirement and SHALL be covered by tests that would
   fail if normal routing changed.
3. THE winding modes SHALL differ in the strength with which curvature is
   favoured, not in which roads are permitted, so that the suitability rules in
   Requirement 4 apply identically across all of them.
4. THE selected mode SHALL be recorded with the route, so the geometry's origin
   is auditable, consistent with Phase 4 Requirement 2.4.
5. THE system SHALL function fully with no routing provider configured; the
   winding modes are then unavailable with an explanation, not silently
   degraded to straight lines under a label that promises bends.
6. THE mode SHALL be re-applicable to an existing A-to-B route without
   redrawing it, and SHALL be undoable.

### Requirement 3: Road curvature and twistiness scoring

A pure, dependency-free scoring function in `src/shared/geo/`, built from
scratch — the investigation confirmed there is no bearing or angle maths in the
project to build on.

#### Acceptance criteria

1. THE system SHALL compute a twistiness score for a road segment from its
   geometry, normalised so that segments of different lengths are comparable.
2. THE score SHALL be derived from, at minimum: heading change between
   consecutive geometry points, meaningful bends per kilometre, bend angle and
   an estimate of curve radius.
3. THE algorithm SHALL distinguish, and SHALL be tested to distinguish:
   straight roads, gentle sweeping curves, regular winding roads, tight bends
   and hairpins.
4. THE algorithm SHALL apply filtering and smoothing so that digitisation
   irregularity is not counted as a genuine bend, and the thresholds SHALL be
   documented with the reasoning for their values.
5. THE algorithm SHALL account for the fact that **OSM geometry point density
   varies with mapping quality, not only with road shape** — a densely
   digitised motorway curve and a sparsely digitised lane are not comparable
   without normalisation. This is a documented limitation of the approach, not a
   defect to be hidden.
6. WHERE a segment has too few geometry points to score meaningfully THE system
   SHALL return **unknown** rather than a low score, because sparse geometry is
   not evidence of a straight road.
7. THE scoring function SHALL be pure, SHALL live in `src/shared/geo/`, and
   SHALL NOT import `electron`, `node:*` or any driver, per
   `.kiro/steering/architecture.md`.
8. THE algorithm and its limitations SHALL be documented, including what it
   cannot know: camber, sight lines, surface quality in practice, traffic, and
   whether a road is actually enjoyable to ride.

### Requirement 4: Road suitability and restrictions

#### Acceptance criteria

1. WHERE the underlying data supports it THE system SHALL offer preferences to:
   avoid motorways, avoid major dual carriageways, prefer secondary and tertiary
   roads, prefer suitable unclassified roads, and avoid unsuitable surfaces.
2. THE system SHALL respect access restrictions, one-way restrictions, and roads
   inaccessible to the selected vehicle type, and SHALL NOT produce a route that
   violates them.
3. THE system SHALL NOT assume that an unclassified road is a suitable
   motorcycle road.
4. THE system SHALL NOT include private roads, access-restricted roads or
   unsuitable tracks in a generated route unless the user has explicitly
   enabled them, and SHALL state what enabling them means.
5. WHERE suitability cannot be determined from the data THE system SHALL treat
   the road as **unknown suitability** and SHALL NOT silently treat unknown as
   suitable.
6. Any hardcoded road classification or suitability assumption SHALL be
   documented in one place with its reasoning, rather than scattered through
   the costing code.

### Requirement 5: Custom routing cost model

#### Acceptance criteria

1. THE cost for a road segment SHALL combine distance, expected travel time,
   twistiness score, road classification, road suitability and user
   preferences.
2. THE weighting SHALL be expressed as a named model rather than scattered
   constants, so that a mode is a set of parameters and not a code path.
3. **Twistiness SHALL influence route selection during the search, and SHALL
   NOT be computed after a conventional route has been produced.** A design that
   generates alternatives and re-ranks them does not satisfy this requirement
   and SHALL be rejected.
4. THE routing SHALL return a viable route when no sufficiently winding roads
   are available, rather than failing, and SHALL state that it could not find a
   winding route.
5. THE cost model SHALL be independently testable without a live routing
   service.
6. THE system SHALL NOT present a curvature-weighted route's duration as a
   measurement; duration remains the labelled estimate described in ADR 0011
   §8.

### Requirement 6: Detour management

#### Acceptance criteria

1. THE system SHALL offer a configurable maximum detour relative to the normal
   route, with at least the options **10%**, **20%**, **30%**, **50%** and **no
   strict limit**.
2. **THE detour limit SHALL be enforced during route selection, not reported
   after the fact.** A route that exceeds the budget SHALL NOT be returned as
   the chosen route.
3. THE system SHALL avoid routing loops, unnecessary backtracking and repeated
   traversal of the same segment in the same direction.
4. WHERE the budget cannot be met THE system SHALL return the best route within
   it, SHALL say that the twistiness preference was limited by the detour
   budget, and SHALL NOT silently exceed the budget.
5. THE system SHALL report the chosen route's distance and estimated time
   against the normal route's, so the trade-off accepted is visible.

### Requirement 7: Snap-to-road integration and geometry integrity

Builds directly on Phase 4 Requirement 3 and must not duplicate it.

#### Acceptance criteria

1. Generated route geometry SHALL follow actual connected roads, SHALL preserve
   valid connectivity, and SHALL respect direction restrictions.
2. THE system SHALL NOT produce shortcuts across fields, water or inaccessible
   areas.
3. THE system SHALL reuse the Phase 4 snap-to-road implementation and SHALL NOT
   introduce a parallel one.
4. THE system SHALL NOT map-match an existing track as a way of generating a
   route, and SHALL NOT modify any track's stored geometry.
5. THE generated geometry SHALL avoid redundant points. Because
   `src/main/io/gpx/write.ts` performs **no rounding, re-sampling or decimation
   on export** by deliberate policy, density SHALL be controlled at generation
   time or by an explicit, previewed simplification using the existing
   `shared/geo/simplify.ts`, following the Phase 3 precedent of showing the
   resulting point count before applying.
6. THE resulting route SHALL remain usable for display at interactive frame
   rates and for export.

### Requirement 8: Geometry volume and undo

Exists because of a specific, measured constraint rather than a general concern.

#### Acceptance criteria

1. THE design SHALL resolve the interaction between snapped geometry volume, the
   **10,000-point cap** in `routePointsSchema`, and `route:setGeometry` undo
   entries that carry the entire previous point array.
2. THE resolution SHALL NOT be to remove the cap without replacing the bound it
   provides on a single undo entry.
3. WHERE routes gain a second geometry layer — placed control points plus
   snapped shape, per Phase 4 Requirement 3.3 — the schema change SHALL be
   designed against the existing `routes` / `route_points` tables, and SHALL
   state whether it follows the tracks `render_geometry` cache pattern or adds
   new storage.
4. Undoing a snap SHALL restore the previous geometry exactly, or SHALL declare
   itself non-undoable and say why, following the honesty precedent in
   `trackService.restoreOriginal`.
5. Route statistics SHALL remain correct and recomputed from the stored
   geometry, never carried over from a provider response.

### Requirement 9: User interface

#### Acceptance criteria

1. THE feature SHALL integrate into the existing routing interface and SHALL NOT
   redesign unrelated functionality.
2. THE system SHALL provide controls for routing mode, twistiness preference,
   maximum detour and road avoidance options.
3. THE system SHALL indicate clearly when winding-road routing is active,
   including on the map, so a generated route is never mistaken for a
   hand-drawn one.
4. THE controls SHALL use existing components, styling and patterns from
   `src/renderer/components/` and SHALL be usable at both desktop and narrow
   window widths.
5. THE system SHALL show progress for a long calculation and SHALL allow it to
   be cancelled.
6. THE system SHALL report the achieved twistiness of the generated route, so
   the user can see whether the preference had any effect.

### Requirement 10: GPX compatibility

#### Acceptance criteria

1. Generated routes SHALL export through the existing GPX writer with no new
   format and no new metadata conventions.
2. Export SHALL preserve coordinate ordering, route continuity and full
   coordinate precision, per the existing no-rounding policy.
3. A generated route SHALL survive an export-then-reimport round trip with
   identical geometry, tested the same way Phase 3 tests GPX round trips.
4. Curvature scores, mode and provider SHALL be recorded as route metadata where
   they are preserved, SHALL be reported as unmapped on export to formats that
   cannot carry them, and SHALL NOT be written into geometry fields.

### Requirement 11: Performance, caching and reliability

#### Acceptance criteria

1. Curvature scores SHALL be cached, keyed to the geometry they were computed
   from, SHALL be invalidated when that geometry changes, and SHALL be
   recomputable — the same contract as every other derived value in the project
   (`.kiro/steering/architecture.md`).
2. THE system SHALL NOT recompute curvature for unchanged road geometry.
3. THE system SHALL handle a routing failure gracefully and SHALL fall back to
   normal routing with an explanation, never silently.
4. WHERE a routing provider is unreachable THE system SHALL say so and SHALL
   leave existing routes untouched.
5. THE system SHALL respect any applicable API rate limits and SHALL NOT retry
   in a way that would breach a provider's usage policy.
6. Calculation SHALL NOT block the user interface. The investigation found no
   worker or background process in the application today, so introducing one is
   an explicit design decision to be recorded, not an implementation detail.
7. Memory use SHALL be bounded for a continental-scale road network, and the
   design SHALL state what bound it relies on.

### Requirement 12: Security, privacy and licensing

#### Acceptance criteria

1. THE system SHALL require explicit opt-in before route geometry is sent to any
   external service, SHALL name the service, and SHALL state what is
   transmitted — inheriting ADR 0011 §6.
2. Any new network host SHALL be declared by its provider and added to the CSP
   allowlist deliberately. `connect-src 'self'` SHALL NOT be widened to a
   wildcard.
3. THE system SHALL NOT bulk-download or area-download road data from
   OpenStreetMap's own infrastructure, per the tile usage policy recorded in
   `src/shared/map/MapProvider.ts`.
4. WHERE OSM-derived road data is bundled or cached locally THE system SHALL
   honour ODbL attribution and share-alike obligations, and the licence
   implications SHALL be assessed before adoption.
5. THE application SHALL remain fully functional for all existing features with
   no network connection.
6. Route and location data SHALL NOT be transmitted anywhere other than the
   routing provider the user explicitly configured.

### Requirement 13: Testing

#### Acceptance criteria

1. Unit tests SHALL cover: straight roads scoring low, winding roads scoring
   higher, hairpins being identified, sparse geometry returning unknown rather
   than low, and digitisation noise not producing artificial bends.
2. Tests SHALL cover the cost model and the detour budget independently of any
   live routing service.
3. Tests SHALL assert that **normal routing is unchanged**, in a form that would
   fail if it regressed.
4. Tests SHALL cover motorway avoidance, one-way restrictions, access
   restrictions and the no-route case.
5. Tests SHALL cover snap-to-road compatibility and GPX export round-trip
   fidelity.
6. End-to-end tests SHALL cover the UI at desktop and narrow widths.
7. Fixtures SHALL follow the existing rule in `test-data/README.md`: no real
   user GPS data. Real OSM road extracts are ODbL-licensed map data rather than
   user traces and are therefore permitted, but their size and attribution
   consequences SHALL be settled at design time rather than by committing a
   large extract.

## Non-functional requirements

1. **No regression.** Every existing test continues to pass; `npm run verify`
   stays green.
2. **Module boundaries hold.** Scoring is pure and lives in `shared/geo/`;
   routing integration lives in `main/`; the renderer reaches it only through
   the preload bridge.
3. **No new dependency without a licence check** recorded in the register.
4. **Errors cross IPC as results, never exceptions**, per
   `src/main/ipc/handler.ts`.
5. **Documented assumptions.** Every road-classification assumption and every
   scoring threshold is written down with its reasoning.

## Assumptions

1. The brief names the application "Trail GPX"; this repository is **TrailRT**.
   Assumed to be the same product under an earlier working name. Worth a
   one-line confirmation.
2. "Motorcycle-friendly" is assumed to mean a road-legal motorcycle on sealed
   roads by default, not adventure or off-road riding. Surface preferences are
   offered, but the default excludes unsealed tracks.
3. Phase 4 is assumed to deliver a routing provider whose transport modes
   include a motorcycle-equivalent, or a car profile close enough to serve.
4. The user is assumed to accept either a third-party routing service or the
   setup cost of running one locally. Requirement 1.5 exists to make that cost
   explicit rather than discovered.

## Unresolved questions for the design stage

1. **Which engine, and where does it run?** The three shapes are: extend the
   Phase 4 provider if it can express custom per-edge costs; adopt a second
   self-hosted engine; or implement an in-house graph search over a bounded,
   user-supplied OSM extract. Each has a different answer to "what does the user
   have to install", and that is the deciding question for a desktop app that
   currently ships as a single DMG with no server.
2. **Where does road geometry come from?** Scoring curvature requires road
   geometry, not just a routing result. A bounded local extract, a provider that
   returns geometry with attributes, or a per-request fetch are different
   designs with different offline behaviour.
3. **Can twistiness genuinely influence the search** with the chosen engine, or
   only bias it coarsely? If only coarsely, Requirement 5.3 forces the in-house
   option, and that needs to be known before committing.
4. **The 10,000-point question.** Raise the cap with a different bound on undo
   entries, store the snapped shape as a cache keyed to control points, or
   simplify at generation time. Requirement 8 must be answered before any
   storage is written.
5. **Default planning speed.** `planningSpeedKmh` defaults to 4.5 km/h — walking
   pace. A motorcycle feature needs mode-aware defaults, which is a settings
   change beyond this feature's surface.
6. **Does the user want the twistiness breakdown** to reuse the Phase 4 speed
   distribution component? "% of route at each twistiness band" is the same
   shape of answer as "% of route at each speed", and sharing it would be
   cheaper than building a second one.
