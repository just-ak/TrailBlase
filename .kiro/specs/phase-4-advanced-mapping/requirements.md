# Phase 4: Advanced Mapping — Requirements

Status: not started. Phase 3 is complete, so this phase is unblocked.

## Introduction

Phase 4 widens the mapping and routing architecture that Phase 1 established as
an interface, and adds profiling as a first-class feature. The `MapProvider`
interface already exists; this phase proves it by adding a second real provider
and a routing abstraction.

Three capabilities were added to this phase after Phase 3:

- **Snap to road.** Promoted from a sub-criterion of the routing abstraction to
  a requirement of its own (Requirement 3), because it is the feature most of
  the routing work exists to deliver.
- **Route profile.** One profile view over distance carrying elevation, speed
  and road class, rather than an elevation chart alone (Requirement 5).
- **Speed identification and distribution.** Per-segment speed with a
  percentage-of-route breakdown (Requirement 6).

Two distinctions run through all three and are not negotiable, because
conflating them would make the app state things that are not true:

1. **A posted speed limit is not a recorded speed.** A planned route can carry
   the legal limit of the roads it follows, read from road data. A recorded
   track can carry the speed actually travelled, derived from its timestamps.
   These are different facts with different sources and different reliability,
   and the UI must never present one as the other. See ADR 0011.
2. **Unknown is a value.** Road data coverage for speed limits is partial and
   varies by road class and country, so "no limit recorded in the data" is a
   normal outcome and gets its own band in every breakdown. It is never
   defaulted to a national limit, inferred from road class, or rolled into 0.

## Requirements

### Requirement 1: Multiple map providers

#### Acceptance criteria

1. THE system SHALL add at least one appropriately licensed terrain or
   topographic provider alongside OpenStreetMap.
2. Adding a provider SHALL require only a registry entry and a CSP allowlist
   entry, with no change to map components or trip management. This is the test
   of whether the Phase 1 abstraction held.
3. THE layer selector SHALL list available providers and SHALL persist the
   choice.
4. WHERE a provider requires an API key THE system SHALL store it in settings,
   SHALL NOT embed it in the repository, and SHALL disable the provider with an
   explanatory message when no key is present.
5. THE system SHALL display each provider's required attribution and SHALL
   respect each provider's usage policy.
6. THE system SHALL support overlay layers independently of the base layer.
7. Google Maps SHALL be added only if its licensing terms for this use are
   confirmed to permit it; absent that confirmation it SHALL NOT be shipped.

### Requirement 2: Routing provider abstraction

#### Acceptance criteria

1. THE system SHALL define a `RoutingProvider` interface in `shared/`, separate
   from map rendering.
2. THE interface SHALL be designed so that a provider failure degrades to
   straight-line routing rather than blocking route editing.
3. THE system SHALL NOT assume tile providers offer route calculation.
4. WHEN a route is created or edited with routing assistance THEN the system
   SHALL record which provider produced the geometry, so its origin is
   auditable.
5. THE default configuration SHALL remain straight-line, requiring no external
   service for the application to function.
6. THE interface SHALL accept a user-supplied endpoint, so a self-hosted
   routing service can be used instead of a public one.
7. THE system SHALL declare a routing provider's hosts in the same way map
   providers declare tile hosts, so a provider cannot reach a host it has not
   declared.

### Requirement 3: Snap to road

A route drawn by clicking the map is a straight-line polyline, which is honest
but not what a user wants when the route follows a road. Snapping asks a routing
provider for the road geometry between the points the user placed.

#### Acceptance criteria

1. THE system SHALL offer snap-to-road as an explicit mode when drawing a
   route, visually and textually distinguished from straight-line drawing.
2. THE system SHALL offer snapping an existing route as a separate,
   user-initiated action, and SHALL NOT snap any route implicitly.
3. WHEN snapping is applied THEN the points the user placed SHALL be retained
   as the route's control points, and the road geometry between them SHALL be
   stored as the route's shape, so a later edit of a control point can re-snap
   only the affected legs.
4. THE system SHALL show the resulting point count before applying a snap to an
   existing route, because snapping replaces geometry.
5. Snapping an existing route SHALL be undoable.
6. WHERE a routing provider cannot match a leg to a road THE system SHALL keep
   that leg straight, SHALL mark it as unmatched, and SHALL say so, rather than
   silently inventing a detour or failing the whole operation.
7. THE system SHALL NOT snap tracks. A recorded track is measured data; moving
   its points onto a road would be fabrication. Map matching a track for the
   purpose of _reading_ road attributes is permitted under Requirement 6 and
   SHALL NOT modify the track's stored geometry.
8. THE selected transport mode (such as driving, cycling or walking) SHALL be
   explicit and recorded with the route, because the same points snap to
   different roads under different modes.
9. THE system SHALL require explicit opt-in before any route geometry is sent
   to a routing service, SHALL state plainly that this transmits the user's
   planned locations to that service, and SHALL name the service.

### Requirement 4: Improved map controls

#### Acceptance criteria

1. THE system SHALL provide fit route to screen, fit track to screen, fit trip
   to screen and return to selection.
2. THE system SHALL provide toggles for waypoint, route and track visibility.
3. THE system SHALL display a scale bar and the cursor's coordinates, in the
   configured units.
4. THE system SHALL support keyboard navigation of the map.
5. THE system SHALL support measuring distance between arbitrary map points
   without creating a route.

### Requirement 5: Route and track profile

Replaces the elevation-only chart. One profile component over distance, with
elevation, speed and road class as separate bands, so the same hover position
reads across all of them.

#### Acceptance criteria

1. THE system SHALL display a profile for a selected route or track plotted
   against distance along it.
2. THE profile SHALL support an elevation band showing minimum elevation,
   maximum elevation, total ascent and total descent.
3. THE profile SHALL support a speed band, sourced per Requirement 6.
4. THE profile SHALL support a road-class band where road attribution is
   available.
5. WHEN the user hovers the profile THEN the corresponding map position SHALL be
   indicated, and hovering the map SHALL indicate the corresponding profile
   position.
6. WHERE a band has no data for the selected object THE system SHALL omit that
   band and SHALL state why, and SHALL NOT render an empty or flat band that
   implies a measurement.
7. THE profile SHALL be rendered from the simplified render geometry for a large
   track, so a 200,000-point track does not block the UI, and SHALL state that
   the view is simplified when it is.
8. THE system SHALL NOT synthesise elevation values.
9. WHERE an external elevation service is configured THE system SHALL be able
   to request elevation for a geometry as an explicit user action, SHALL mark
   the result as externally sourced and distinguishable from recorded data, and
   SHALL NOT overwrite recorded elevation.
10. THE profile SHALL be exportable as an image for a route or track.

### Requirement 6: Speed identification and distribution

The feature the user asked for: see what proportion of a route is at each speed.
Its correctness depends entirely on being honest about where each number came
from.

#### Acceptance criteria

1. THE system SHALL distinguish two speed sources, SHALL label which is in use,
   and SHALL NOT mix them in one series:
   - **Posted limit** — the legal maximum for the road, read from road data via
     a provider. Available for routes and for tracks.
   - **Recorded** — speed derived from a track's own timestamps and distances.
     Available only where the track carries timestamps.
2. THE system SHALL obtain posted limits by map matching the geometry to the
   road network through a provider interface, and SHALL store the result as a
   **cache** attributed to the provider and the date it was fetched.
3. THE speed cache SHALL be invalidated when the geometry changes, and SHALL be
   recomputable from the geometry, per the derived-data rule in
   `.kiro/steering/architecture.md`.
4. THE system SHALL present the distribution as a percentage of **route
   distance** in each speed band, not as a percentage of points, because sample
   spacing is not uniform and a point-based percentage would be misleading.
5. THE distribution SHALL include an explicit **Unknown** band for distance
   whose speed could not be determined, SHALL size it honestly, and SHALL NOT
   omit, hide or redistribute it.
6. THE system SHALL NOT infer a speed limit from road class, country defaults
   or any other proxy. Where the data has no limit, the answer is Unknown.
7. THE bands SHALL be presented in the user's configured units, and the
   underlying values SHALL be stored in SI.
8. WHERE a track has timestamps THE system SHALL additionally be able to show
   recorded speed, with minimum, maximum, mean and moving mean, and SHALL state
   which it is showing.
9. WHEN recorded speed is shown THEN the system SHALL note that GPS-derived
   speed is noisy, and any smoothing applied SHALL be stated and SHALL NOT
   replace the stored values.
10. THE system SHALL NOT present a posted limit as a prediction of travel time.
    Route duration remains the explicit planning-speed estimate from Phase 2,
    and the two SHALL NOT be silently combined.
11. WHERE a comparison of recorded speed against posted limit is offered THE
    system SHALL present it as a comparison of two independently sourced
    measurements, SHALL NOT characterise it as an infringement, and SHALL NOT
    report it anywhere outside the user's own machine.
12. THE system SHALL function fully with no speed provider configured; the
    speed band and distribution are then absent with an explanation, not empty.

### Requirement 7: Waze hand-off

#### Acceptance criteria

1. THE system SHALL offer a single-destination Waze hand-off for a waypoint,
   and for a route or track resolving to its end point, per ADR 0005.
2. THE menu label SHALL state that it navigates to the end point, so it does
   not imply multi-stop routing that the platform does not support.
3. THE system SHALL NOT present an "open route in Waze" action, because Waze
   rejects multi-waypoint URLs.
4. THE system SHALL open the link via `shell.openExternal` after coordinate
   validation, never in an in-app window.

### Requirement 8: Offline map groundwork

#### Acceptance criteria

1. THE system SHALL support a user-supplied local tile source as a provider
   implementation, requiring no change to the trip database.
2. THE system SHALL NOT implement tile prefetching, area download or any bulk
   retrieval from public tile servers.
3. WHEN no network is available THEN locally stored trip data SHALL remain
   fully usable and the map SHALL degrade gracefully.
4. WHERE a routing or speed provider is unreachable THE system SHALL continue to
   display any cached profile and speed data it already holds, marked with the
   date it was fetched.

## Open questions for the design stage

1. **Which provider.** Valhalla is the only open-source engine known to return
   posted speed limits and road class from map matching, and it is MIT licensed,
   which is compatible. Whether to default to a public instance, require a
   self-hosted endpoint, or ship with no default at all is a decision with
   privacy and usage-policy consequences, recorded in ADR 0011.
2. **Speed band boundaries.** Fixed bands, data-derived bands, or
   units-dependent bands (50/80/100/120 km/h against 30/50/60/70 mph). A
   mapping between the two that silently rounds would misreport the
   distribution.
3. **Control points versus shape.** Requirement 3.3 implies routes gain a
   second geometry layer — placed control points plus snapped shape — which is
   a schema change. Whether that reuses the track `render_geometry` pattern or
   adds a column needs designing against the existing route storage.
