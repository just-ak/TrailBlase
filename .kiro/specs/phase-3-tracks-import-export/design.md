# Phase 3: Tracks and Import/Export — Design

## Overview

Phase 3 is the phase that makes TrailRT a viable BaseCamp replacement, because
it is the first phase that reads data the user already has. Two subsystems:
recorded tracks, and a format conversion pipeline.

The hard constraints come from the steering rules and ADR 0003, not from the
feature list:

- **Imported data is never silently modified or discarded.** No re-sampling, no
  rounding, no quiet dropping of fields we have no column for.
- **Absent data stays absent.** No elevation means `null`, not `0`.
- **Tracks are large.** A multi-day recording at 1 Hz is 100k–500k points. Every
  design choice below that looks over-engineered is there because of that
  number.

## Track storage: three layers, one source of truth

Straight from ADR 0003, now implemented:

| Layer | Table | Role |
| --- | --- | --- |
| Source of truth | `track_points` | Normalised rows, ordered by `(segment_index, seq)` |
| Render cache | `tracks.render_geometry` | Simplified polyline, rebuildable, invalidated on edit |
| Original bytes | `track_sources` | The imported file verbatim, with its hash and format |

`render_geometry` is a packed binary blob, not JSON: a 200k-point track is
~3.2 MB as `Float64Array` pairs versus ~9 MB of JSON text, and it skips a parse
on every map render. The stored tolerance travels with it so a cache built at
the wrong tolerance can be detected and rebuilt rather than silently reused.

The cache must never be the only copy. Any path that writes `render_geometry`
without `track_points` already being correct is a bug, and the rebuild is a pure
function of the points.

### Why tracks do not reuse the route geometry command

Phase 2 made every route edit a whole-array replacement, because a human-placed
route is tens of points. Doing that for a 200k-point track would put megabytes
on the undo stack per edit.

Track edits therefore use **targeted commands** — delete a point range, split,
join, simplify — and their inverses store only what changed, or in the case of
simplify, the fact that the original is recoverable from `track_sources`. The
two models are deliberately not unified; ADR 0003 anticipated this.

## Import pipeline

Three stages, deliberately separated so nothing is written before the user has
seen what will be written.

```
          parse                      preview                    commit
file ──────────────▶ ParsedFile ───────────────▶ user choices ──────────▶ database
     (pure, no I/O                (rendered in                (one transaction
      beyond reading)              a dialog)                   per file)
```

**Parse** is pure: bytes in, a `ParsedFile` out, containing candidate routes,
tracks and waypoints plus a list of warnings and unmapped metadata. No database
access, so every parser is unit-testable against fixtures with no Electron and
no SQLite.

**Preview** shows counts, per-object detail, the destination trip, and anything
the parser could not map. The user can deselect individual objects.

**Commit** writes each file's objects in a single transaction. A failure
mid-file rolls that file back as a unit rather than leaving a half-imported trip
(Requirement 3.9). Multiple files are independent: one bad file does not lose
the others.

### The report is a first-class output, not logging

Requirement 3.6 and 3.7 are the ones most easily fudged. The parser returns:

```ts
interface ImportReport {
  imported: { routes: number; tracks: number; waypoints: number; points: number };
  skipped: SkippedItem[];      // present in the file, not imported, with why
  warnings: string[];          // imported, but something was odd
  unmappedMetadata: string[];  // fields with no column, preserved as JSON
}
```

`unmappedMetadata` is the honest half. GPX extensions, TCX heart rate and
cadence, KML `ExtendedData` — none of these have columns. They are preserved
verbatim in the `metadata` JSON column and listed in the report, so the user
knows they survived and Phase 5 can round-trip them. Dropping them silently
would breach the steering rule; pretending we understand them would be worse.

Every import, successful or not, is recorded in `import_history`, which is what
finally populates the Imported Data library view.

## Format support and what each one costs

One parsing approach for all three XML formats — `fast-xml-parser` — rather than
a GeoJSON intermediate. `@tmcw/togeojson` was considered and rejected: GeoJSON
flattens exactly the names, descriptions and extension data we are obliged to
preserve, and it needs an XML DOM implementation under Node.

| Format | Library | Reads | Writes | Notes |
| --- | --- | --- | --- | --- |
| GPX 1.0/1.1 | fast-xml-parser | ✓ | ✓ | `wpt`, `rte`, `trk` with multi-segment `trkseg` |
| KML | fast-xml-parser | ✓ | ✓ | `Placemark` Point/LineString, `gx:Track`, `MultiGeometry` |
| KMZ | jszip | ✓ | ✓ | A zip containing KML; the first `.kml` entry is the document |
| TCX | fast-xml-parser | ✓ | — | Activity trackpoints → tracks; HR/cadence become unmapped metadata |
| FIT | fit-file-parser | ✓ | — | MIT licensed. Garmin's own SDK is rejected — see ADR 0006/0007 |
| CSV | in-house | ✓ | ✓ | Waypoints only, with a header-mapping step |
| JSON | in-house | ✓ | ✓ | Native full-collection backup |

TCX and FIT are read-only by design. Writing them would mean inventing activity
metadata — lap structure, sport type, device ids — that a planning app does not
have. A route exported as TCX would be a fabrication, so the export dialog
simply does not offer them, rather than offering them and producing something
misleading.

GDB stays unsupported and is listed as such in the import dialog with a short
explanation (ADR 0006, as amended by 0007).

## Streaming and responsiveness

A 200k-point FIT or GPX file must not freeze the UI (Requirement 3.5).

- Parsing happens in the **main process**, never the renderer, so a slow parse
  cannot block painting.
- Point insertion uses one prepared statement inside one transaction. The
  measured difference against per-row autocommit is roughly two orders of
  magnitude, and it is the single thing that makes a large import feasible.
- Progress is reported back over IPC at coarse intervals — per file and per
  10,000 points — rather than per point, because the messaging would otherwise
  cost more than the work.

## Map rendering for large tracks

Below a zoom threshold the map draws `render_geometry`; above it, real points
within the current viewport. Requirement 5.6 asks for interactive frame rates on
a 200k-point track, and drawing 200k SVG vertices is not that.

Simplification is Douglas-Peucker in `shared/geo/simplify.ts` — pure, testable,
and shared between the render cache and the user-initiated simplify action.

## Module layout

Additions only.

```
src/
  shared/
    io/
      types.ts        ParsedFile, ImportReport, SkippedItem
    geo/
      simplify.ts     Douglas-Peucker, pure
      packed.ts       Float64 polyline encode/decode
  main/
    db/repositories/
      tracks.ts       tracks, track_points, track_sources
      importHistory.ts
    io/
      detect.ts       format from extension plus content sniffing
      gpx/{read,write}.ts
      kml/{read,write}.ts
      kmz/{read,write}.ts
      tcx/read.ts
      fit/read.ts
      csv/{read,write}.ts
      json/{read,write}.ts
      importService.ts   parse → preview → commit
      exportService.ts
      garmin/            GarminCompatibility: symbol and extension mapping
    services/
      trackService.ts
  renderer/
    features/
      import/         ImportDialog: preview, selection, report
      export/         ExportDialog
    features/map/
      useTrackLayers.ts
    features/properties/
      TrackProperties.tsx
```

`main/io/` is a leaf: it depends on `shared/` and the repositories, and nothing
depends on it except the IPC layer. That is what keeps Phase 5's Garmin work
from reaching into trip management.

## Technical risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| A 200k-point import freezes the app | Unusable on real data | Parse in main, single prepared-statement transaction, coarse progress reporting |
| Drawing 200k vertices on the map | Unusable map | Packed simplified render cache below a zoom threshold; viewport-limited real points above |
| Silent data loss on import | Breaks the core promise and a steering rule | `unmappedMetadata` and `skipped` are returned, surfaced in the report, and asserted in tests |
| Elevation or time rendered as 0 when absent | Misleading data | Parsers emit `null`; round-trip tests assert nulls survive |
| Coordinate precision lost on export | Round-trip corruption | No rounding anywhere in the write path; a round-trip test compares exact values |
| KML coordinate order | Silently swapped lat/lon | KML is `lon,lat,ele`, GPX is attributes — covered by a dedicated test per format |
| Partial import on malformed input | Half-imported trip | One transaction per file, rolled back as a unit |
| Simplify destroying the original | Irreversible data loss | Original bytes in `track_sources`; simplify is explicit, previewed, and undoable |

## Out of scope for Phase 3

Elevation profile charts and routing remain Phase 4. GDB, IMG and device
transfer remain Phase 5 investigations. TCX and FIT writing is not planned at
all, for the fabrication reason above.
