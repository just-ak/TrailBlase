# Phase 3: Tracks and Import/Export — Tasks

Execute in order. The parsers come before any UI so they can be developed
against fixtures as pure functions, and the fixtures come early because every
later task is verified against them.

GPX is built first and fully — read, write and round-trip — because it is the
format that matters most and the one whose shape the import pipeline is designed
around. The others follow the pattern it establishes.

Update `docs/progress-mindmap.svg` as each task changes status.

- [x] 1. Shared IO contracts and geometry helpers
  - `shared/io/types.ts`: `ParsedFile`, `ParsedTrack`, `ImportReport`,
    `SkippedItem`, `ImportSelection`
  - `shared/geo/simplify.ts`: Douglas-Peucker, pure
  - `shared/geo/packed.ts`: `Float64Array` polyline encode/decode for the
    render cache
  - Unit tests: simplification preserves endpoints, respects tolerance, is
    idempotent at the same tolerance; packed round-trips exactly
  - _Requirements: 5.6, 6.2_

- [x] 2. Synthetic test fixtures
  - `test-data/` with GPX 1.0 and 1.1, KML, KMZ, TCX, FIT and CSV
  - Edge cases, each as its own file: no elevation, no timestamps,
    multi-segment track, empty file, malformed XML, unknown symbol, unmapped
    extensions, and a large track for the performance assertion
  - A README stating that every fixture is synthetic
  - _Requirements: 8.1, 8.2_

- [x] 3. Track repository and service
  - `main/db/repositories/tracks.ts`: tracks, `track_points` with dense
    `(segment_index, seq)`, `track_sources`
  - Bulk point insert in one prepared-statement transaction
  - `main/services/trackService.ts`: create from parsed data, rename, recolour,
    set width, delete, restore, plus statistics from points
  - Render cache build and invalidation
  - Unit tests: 200,000 points insert within a time budget; cache rebuilds from
    points; cache invalidated on edit; original bytes retained
  - _Requirements: 1.4, 5.4, 6.3, 6.4_

- [x] 4. Format detection
  - `main/io/detect.ts`: extension plus content sniffing, so a mislabelled file
    is still identified
  - GDB recognised and reported as unsupported with an explanation, never
    accepted and failed opaquely
  - Unit tests per format, including a renamed file and an unrecognised one
  - _Requirements: 2.6_

- [x] 5. GPX read
  - `wpt`, `rte`, `trk` with multi-segment `trkseg`
  - Preserve coordinates, elevation, time, name, description, symbol, comment
    exactly; absent values become `null`
  - Unknown extension namespaces collected into `unmappedMetadata`, never
    dropped
  - Malformed XML fails with a message naming the problem, importing nothing
  - All text treated as untrusted plain text
  - Unit tests against every GPX fixture
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 1.7_

- [x] 6. GPX write and round-trip
  - Write waypoints, routes and tracks with full precision and no rounding
  - Garmin-compatible `<sym>` names via the symbol vocabulary
  - Preserved metadata written back where it belongs
  - Unit tests: export then re-import yields geometrically identical objects,
    including nulls; output validates against the GPX schema
  - _Requirements: 4.2, 4.4, 4.5_

- [x] 7. KML and KMZ
  - Read `Placemark` Point and LineString, `gx:Track` with timestamps, and
    `MultiGeometry`; `ExtendedData` into `unmappedMetadata`
  - KMZ via jszip, taking the contained KML document
  - Write both
  - Unit tests, including the `lon,lat,ele` coordinate order, which is the
    opposite convention to the rest of the app
  - _Requirements: 2.1, 4.1_

- [x] 8. TCX read
  - Activity trackpoints become tracks
  - Heart rate and cadence retained as unmapped metadata rather than discarded
  - Read-only: writing TCX would mean inventing lap and device data
  - _Requirements: 2.2_

- [x] 9. FIT read
  - `fit-file-parser` (MIT). Garmin's own SDK is not used — ADR 0006 and 0007
  - Semicircle coordinate conversion, which is FIT's native representation
  - Read-only, for the same reason as TCX
  - _Requirements: 2.3_

- [x] 10. CSV waypoints
  - Read and write with a documented column format
  - Header mapping for unrecognised layouts, rather than refusing the file
  - Unit tests: quoted fields, embedded commas and newlines, missing optional
    columns, absent elevation staying null
  - _Requirements: 2.4_

- [x] 11. JSON native backup
  - Full-collection export and import, suitable for moving between installs
  - Versioned envelope so a future format change is detectable
  - Unit tests: a whole collection round-trips, including trips, folders,
    routes, tracks and waypoints
  - _Requirements: 2.5_

- [x] 12. Import service
  - parse → preview → commit, with nothing written before the user confirms
  - One transaction per file; a failure rolls that file back as a unit
  - Destination trip chosen, or auto-created named after the source file
  - Progress reported per file and per 10,000 points
  - Every import recorded in `import_history`
  - Unit tests: partial failure leaves no partial trip; report counts match
    what was written; nothing is silently discarded
  - _Requirements: 3.2, 3.3, 3.5, 3.6, 3.7, 3.8, 3.9_

- [x] 13. Export service
  - Individual route, track or waypoint; a whole trip; a multi-trip selection
  - Warn before writing when the target format cannot represent something,
    naming what will be lost
  - TCX and FIT deliberately absent from the writable formats
  - _Requirements: 4.1, 4.2, 4.3_

- [x] 14. IPC and preload wiring
  - Channels for detect, parse, commit, export, track mutations and import
    history
  - File dialogs in the main process; the renderer never receives a path to
    read
  - Imported file content treated as untrusted throughout
  - _Requirements: 3.1_

- [x] 15. Track map layer
  - Packed render cache below a zoom threshold, real points above
  - Configurable colour and width, persisted per track
  - Start and finish markers; optional point display
  - Interactive frame rates on a 200,000-point track
  - _Requirements: 5.1, 5.2, 5.3, 5.6_

- [x] 16. Track properties and editing
  - Distance, point count, duration where timestamps exist, elevation gain and
    loss where elevation exists, and an explicit statement when it does not
  - Remove points, split, join, reverse, simplify, rename
  - Simplify shows the resulting point count before applying and is undoable
  - The original import stays recoverable from the retained source bytes
  - _Requirements: 5.4, 5.5, 6.1, 6.2, 6.3_

- [x] 17. Import dialog
  - File dialog, multi-file selection, and drag-and-drop onto the window
  - Preview with counts and per-object detail; individual objects deselectable
  - Destination trip chooser
  - Progress indicator for large files
  - Report listing imported, unsupported, invalid, warnings and unmapped
    metadata
  - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.6_

- [x] 18. Export dialog
  - Scope and format selection, with unsupported combinations explained rather
    than hidden
  - Loss warnings surfaced before writing
  - _Requirements: 4.1, 4.3_

- [x] 19. Library completion
  - Tracks and Imported Data views populated
  - Sort by distance, now that tracks and routes both have one
  - _Requirements: 7.1, 7.2_

- [x] 20. End-to-end tests
  - Import a GPX fixture and see its routes, tracks and waypoints on the map
  - Export GPX and re-import it, confirming identical geometry
  - Import warnings visible in the report
  - A malformed file is refused without partial import
  - Tracks persist across a restart
  - _Requirements: 1.6, 3.6, 4.4_

- [x] 21. Phase 3 verification pass
  - `npm run verify` green, and the e2e suite green against the packaged build
  - Walk the source-spec Phase 3 acceptance criteria: existing GPX files
    import, routes/tracks/waypoints display correctly, exported GPX reopens,
    import warnings are visible
  - Update the supported format list only for formats actually tested
  - Update the mindmap to show Phase 3 complete
  - _Requirements: all_
