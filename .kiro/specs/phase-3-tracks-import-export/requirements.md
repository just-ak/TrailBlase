# Phase 3: Tracks and Import/Export — Requirements

Status: not started. Blocked on Phase 2.

## Introduction

Phase 3 is the phase that makes TrailRT a viable BaseCamp replacement, because
it is the phase that reads existing data. Format support, track handling and an
honest import report are the core deliverables.

Format tiering and licensing constraints are set by ADR 0006. Track storage is
set by ADR 0003.

## Requirements

### Requirement 1: GPX import

**User story:** As a BaseCamp user, I want to import my existing GPX files.

#### Acceptance criteria

1. THE system SHALL parse GPX 1.0 and 1.1, extracting waypoints (`wpt`), routes
   (`rte`) and tracks (`trk`) with multi-segment support.
2. THE system SHALL preserve coordinates, elevations, timestamps, names,
   descriptions, symbols and comments exactly as present in the source.
3. THE system SHALL NOT re-sample, simplify or round geometry on import.
4. THE system SHALL retain the original file bytes per ADR 0003, so that
   "original data preserved" is literally true.
5. WHERE a GPX extension namespace is present but unsupported THE system SHALL
   record it in the import report as unmapped metadata rather than discarding it
   silently.
6. IF the file is malformed THEN the system SHALL fail with a message naming the
   problem and its location, and SHALL import nothing from that file.
7. THE system SHALL treat all text content as untrusted plain text and SHALL
   NOT render it as markup.

### Requirement 2: Additional format support

#### Acceptance criteria

1. THE system SHALL import and export KML, and SHALL import KMZ by extracting
   its contained KML.
2. THE system SHALL import TCX, mapping activity trackpoints to tracks, and
   SHALL retain heart rate and cadence as unmapped metadata where present.
3. THE system SHALL import FIT using the MIT-licensed `fit-file-parser`. Garmin's
   own `@garmin/fitsdk` SHALL NOT be used: its licence is a proprietary bilateral
   agreement incompatible with the project's GPL-3.0 licence. The gate that ADR
   0006 opened is now closed, and the answer is recorded in ADR 0007.
4. THE system SHALL import and export CSV for waypoints, with a documented
   column format and a header-mapping step for unrecognised layouts.
5. THE system SHALL export and import a native JSON backup covering the whole
   collection, suitable for migration between installations.
6. THE system SHALL list GDB as not yet supported with a brief explanation,
   rather than accepting the file and failing opaquely. GDB is Phase 6 work; it
   became viable once the project licence was set to GPL-3.0, which permits
   GPSBabel.

### Requirement 3: Import workflow

#### Acceptance criteria

1. THE system SHALL support importing via file dialog, multi-file selection,
   and drag-and-drop onto the window.
2. WHEN files are chosen THEN the system SHALL show a preview listing the
   routes, tracks and waypoints found, with counts, before anything is written.
3. THE preview SHALL allow choosing the destination trip, or creating a new one;
   WHERE no destination is chosen THE system SHALL create a trip named after the
   source file, per ADR 0004.
4. THE preview SHALL allow deselecting individual objects.
5. WHEN importing THEN the system SHALL show progress, and SHALL remain
   responsive for a file containing at least 200,000 track points.
6. WHEN an import completes THEN the system SHALL show a report listing
   successfully imported objects, unsupported objects, invalid records, warnings
   and any metadata that could not be mapped.
7. THE system SHALL NOT silently discard any input data.
8. THE system SHALL record every import in `import_history` and SHALL surface it
   in the Imported Data library view.
9. IF an import fails partway THEN the system SHALL roll back that file's
   objects as a unit rather than leaving a partial trip.

### Requirement 4: Export

#### Acceptance criteria

1. THE system SHALL export an individual route, track or waypoint, a complete
   trip, and a multi-trip selection.
2. THE system SHALL preserve coordinates, timestamps, elevations and metadata
   wherever the target format supports them.
3. WHERE the target format cannot represent some data THE system SHALL warn
   before writing, naming what will be lost.
4. A GPX export followed by a re-import SHALL produce geometrically identical
   objects, verified by a round-trip test.
5. Exported files SHALL be valid against the format's schema where one exists.

### Requirement 5: Track display and statistics

#### Acceptance criteria

1. THE system SHALL display tracks on the map with configurable colour and
   thickness, persisted per track.
2. THE system SHALL optionally display individual track points.
3. THE system SHALL show start and finish markers.
4. THE system SHALL show distance, point count, duration where timestamps
   exist, and elevation gain and loss where elevation exists.
5. THE system SHALL show an elevation profile where elevation data exists, and
   SHALL state its absence otherwise rather than drawing a flat line.
6. THE map SHALL render large tracks via the simplified geometry cache below a
   zoom threshold and real points above it, per ADR 0003, at interactive frame
   rates for a 200,000-point track.

### Requirement 6: Track editing, non-destructive

#### Acceptance criteria

1. THE system SHALL support removing points, splitting, joining, reversing,
   simplifying and renaming tracks.
2. Simplification SHALL be explicit and user-initiated, SHALL show the
   resulting point count before applying, and SHALL be undoable.
3. THE original imported data SHALL remain recoverable after any edit, via the
   retained source bytes.
4. WHEN a track is edited THEN the system SHALL invalidate and rebuild the
   render geometry cache.

### Requirement 7: Library completion

#### Acceptance criteria

1. THE library SHALL populate the cross-trip Tracks and Imported Data views.
2. THE library SHALL support sort by distance, deferred from Phase 1 because no
   distance-bearing objects existed then.

### Requirement 8: Test fixtures

#### Acceptance criteria

1. `test-data/` SHALL contain synthetic GPX, KML, KMZ, TCX and FIT fixtures,
   including edge cases: no elevation, no timestamps, multi-segment tracks,
   empty files, malformed XML, and a large track for performance testing.
2. Fixtures SHALL be synthetic. Real user GPS data SHALL NOT be used.
3. Round-trip tests SHALL cover every implemented export format.
