# ADR 0003: Track point storage and render cache

Status: accepted
Date: 2026-11-05

## Context

Section 12 requires a track points table. Real recorded tracks are large: a
multi-day GPS log at 1 Hz is 100k–500k points. A naive row-per-point table
rendered directly to Leaflet will stall the UI, and SQLite will spend most of
its time on row overhead for data that is only ever read as a contiguous run.

Section 7 also requires non-destructive editing and preservation of the
original imported data, which rules out simplifying on import.

## Decision

Three layers, with one source of truth.

1. `track_points` — normalised rows, the single source of truth. Columns for
   lat, lon, elevation, time, plus `(track_id, segment_index, seq)` as the
   ordering key. Elevation and time are nullable.
2. `tracks.render_geometry` — a derived BLOB holding a Douglas-Peucker
   simplified polyline for map display, with the tolerance recorded alongside
   it. Rebuildable from `track_points` at any time, and invalidated on edit.
   Marked in the schema comment as a cache.
3. `track_sources` — the original imported file bytes plus its hash and format,
   stored once per import. Guarantees that "preserve the original" is literally
   true and that an edit can always be rolled back to the import.

Map rendering reads `render_geometry` below a zoom threshold and real points
above it. Statistics are computed from `track_points`, never from the
simplified cache.

## Consequences

Import writes points in a single prepared-statement transaction, which keeps a
200k-point GPX in the low hundreds of milliseconds rather than minutes.

Storage cost is roughly double for imported tracks, since the original file is
retained. Acceptable for a desktop app on local disk, and it is what makes
non-destructive editing honest rather than aspirational.

The cache must never be the only copy. Any code path that writes
`render_geometry` without `track_points` already being correct is a bug.
