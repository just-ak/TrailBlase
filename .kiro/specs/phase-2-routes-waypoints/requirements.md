# Phase 2: Routes and Waypoints — Requirements

Status: not started. Blocked on Phase 1 verification.

Design and tasks for this phase are written after Phase 1 is built and tested,
per section 20 of the source specification. These requirements exist now so
Phase 1 can be shaped correctly, not so Phase 2 can start early.

## Introduction

Phase 2 makes the application useful for planning. Users draw and edit routes
on the map, place and edit waypoints, see route statistics, and get an undo
history over those edits. All objects belong to a trip per ADR 0004.

## Requirements

### Requirement 1: Route creation

**User story:** As a trip planner, I want to draw a route on the map, so that I
can plan where I intend to travel.

#### Acceptance criteria

1. WHEN the user activates route drawing THEN the system SHALL enter a mode
   where map clicks append route points, with the mode visibly indicated.
2. WHEN the user appends a point THEN the system SHALL draw the polyline
   segment and SHALL update the running distance.
3. WHEN the user finishes drawing THEN the system SHALL persist the route to
   the selected trip with a default name the user can change.
4. WHEN the user presses Escape during drawing THEN the system SHALL cancel
   without persisting a partial route.
5. THE system SHALL connect route points with straight segments in Phase 2, and
   SHALL NOT imply road-snapping that no routing provider yet performs.

### Requirement 2: Route editing

**User story:** As a trip planner, I want to adjust a route after drawing it.

#### Acceptance criteria

1. WHEN a route is selected THEN the system SHALL display draggable handles at
   its points.
2. WHEN the user drags a point THEN the system SHALL persist the new position
   on release and SHALL recompute statistics.
3. THE system SHALL support inserting an intermediate point by clicking a
   segment, deleting a point, and reordering points.
4. THE system SHALL support reversing, duplicating, renaming and deleting a
   route.
5. WHEN a route has fewer than two points after a deletion THEN the system
   SHALL keep it valid as a degenerate route rather than silently deleting it.
6. WHEN the user edits an imported route THEN the system SHALL apply the change
   only on explicit action, per the data integrity rule that imports are never
   modified implicitly.

### Requirement 3: Waypoint management

**User story:** As a trip planner, I want to mark and annotate places.

#### Acceptance criteria

1. THE system SHALL support creating a waypoint by map click and by manual
   coordinate entry.
2. THE system SHALL validate entered coordinates and SHALL reject values
   outside valid latitude and longitude ranges with a clear message.
3. WHEN the user drags a waypoint marker THEN the system SHALL persist the new
   coordinates.
4. THE properties panel SHALL allow editing name, coordinates, elevation,
   description, symbol and notes.
5. THE system SHALL support a symbol set rendered as map markers, with symbol
   names chosen to map onto Garmin's symbol vocabulary for later export
   fidelity.
6. THE system SHALL support grouping waypoints, searching waypoints by name,
   and deleting waypoints with confirmation.
7. WHERE elevation is unknown THE system SHALL store and display it as absent,
   not as zero.

### Requirement 4: Route and waypoint statistics

#### Acceptance criteria

1. THE properties panel SHALL show route total distance, point count, start
   coordinates and end coordinates.
2. WHERE route points carry elevation THE system SHALL show elevation gain and
   loss; WHERE they do not, it SHALL show that elevation data is unavailable
   rather than showing zero.
3. WHERE the user has configured a planning speed THE system SHALL show an
   estimated duration labelled as an estimate with that speed visible; it SHALL
   NOT present a bare duration implying measurement.
4. Statistics SHALL be computed from the stored points via `shared/geo`, and
   SHALL be unit tested against known fixtures.

### Requirement 5: Undo and redo

**User story:** As a user, I want to undo a mistaken edit, because there is no
save point to revert to.

#### Acceptance criteria

1. THE system SHALL maintain a bounded undo history of user mutations.
2. THE Edit menu Undo and Redo items SHALL become enabled and SHALL reflect the
   next action's description.
3. WHEN an operation is undone THEN the database, map and properties panel
   SHALL all return to the prior state.
4. THE history SHALL cover route and waypoint edits and library organisation;
   destructive trip deletion SHALL remain confirmation-gated rather than relying
   on undo.

### Requirement 6: Map selection and interaction

#### Acceptance criteria

1. THE system SHALL support selecting a route or waypoint on the map and in the
   library, with selection synchronised between them.
2. THE map SHALL provide context menus on objects and on empty map space with
   contextually valid actions only.
3. THE system SHALL support fit-to-screen for a selected route and
   return-to-selection, wired to the View menu items enabled in this phase.
4. WHEN a trip is selected THEN the map SHALL display all of that trip's
   objects.

### Requirement 7: Trip organisation completion

#### Acceptance criteria

1. THE library SHALL populate the cross-trip Routes and Waypoints views.
2. THE system SHALL support moving a route or waypoint between trips as a
   reparent, with the UI stating that it is a move and not a copy.
