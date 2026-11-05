# Phase 4: Advanced Mapping — Requirements

Status: not started. Blocked on Phase 3.

## Introduction

Phase 4 widens the mapping and routing architecture that Phase 1 established as
an interface, and adds elevation profiling as a first-class feature. The
`MapProvider` interface already exists; this phase proves it by adding a second
real provider and a routing abstraction.

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
4. WHERE a routing provider is configured THE system SHALL offer snap-to-path
   route creation as an explicit opt-in mode, clearly distinguished from
   straight-line drawing.
5. WHEN a route is created with routing assistance THEN the system SHALL record
   which provider produced it, so the geometry's origin is auditable.
6. THE default configuration SHALL remain straight-line, requiring no external
   service for the application to function.

### Requirement 3: Elevation profiles

#### Acceptance criteria

1. THE system SHALL display an elevation chart for a selected route or track
   against distance.
2. THE chart SHALL show minimum elevation, maximum elevation, total ascent and
   total descent.
3. WHEN the user hovers the chart THEN the corresponding map position SHALL be
   indicated, and vice versa.
4. WHERE no elevation data exists THE system SHALL state that clearly and SHALL
   NOT render a chart implying flat terrain.
5. THE system SHALL NOT synthesise elevation values.
6. WHERE an external elevation service is configured THE system SHALL be able
   to request elevation for a geometry as an explicit user action, SHALL mark
   the result as externally sourced and distinguishable from recorded data, and
   SHALL NOT overwrite recorded elevation.

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

### Requirement 5: Waze hand-off

#### Acceptance criteria

1. THE system SHALL offer a single-destination Waze hand-off for a waypoint,
   and for a route or track resolving to its end point, per ADR 0005.
2. THE menu label SHALL state that it navigates to the end point, so it does
   not imply multi-stop routing that the platform does not support.
3. THE system SHALL NOT present an "open route in Waze" action, because Waze
   rejects multi-waypoint URLs.
4. THE system SHALL open the link via `shell.openExternal` after coordinate
   validation, never in an in-app window.

### Requirement 6: Offline map groundwork

#### Acceptance criteria

1. THE system SHALL support a user-supplied local tile source as a provider
   implementation, requiring no change to the trip database.
2. THE system SHALL NOT implement tile prefetching, area download or any bulk
   retrieval from public tile servers.
3. WHEN no network is available THEN locally stored trip data SHALL remain
   fully usable and the map SHALL degrade gracefully.
