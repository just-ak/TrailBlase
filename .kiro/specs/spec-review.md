# Review of the source specification

Reviewed 2026-11-05 against the externally authored "Modern Garmin BaseCamp
Replacement" specification.

The specification is unusually good: it scopes phases sensibly, separates
providers from consumers, and is explicit about not faking support for
proprietary formats. The findings below are the places where it is internally
inconsistent, technically unachievable as written, or silent on something that
has to be decided before code is written.

Each finding records a resolution. Resolutions are reflected in the phase specs
and, where they are durable decisions, in `docs/adr/`.

## Blocking — resolved before implementation

**1. Project name did not match the repository.** The spec said _TrailBase_
while the directory said _TrailBlase_. This matters because the name lands in
the bundle identifier, the app name, the DMG and the window title.
**Resolution:** settled by the owner on 2026-11-05 — the product is **TrailRT**,
with `com.trailrt.app` as the bundle identifier and `TrailRT` as the display
name. Neither of the original spellings is used. The workspace directory is
still named `TrailBlase`; that is cosmetic and does not affect the build, since
`productName` and `appId` are set explicitly in `electron-builder.yml`.

**2. Library tree contradicts trip ownership.** Section 3 puts Routes, Tracks
and Waypoints at the top level of the tree; section 5 makes them children of a
trip. This decides whether `trip_id` is nullable, which is expensive to change
later. **Resolution:** ADR 0004 — strict single ownership, top-level nodes are
cross-trip saved views.

**3. "Save" has no meaning in a local-first app.** Section 12 mandates
immediate local persistence; section 16 puts Save in the File menu. With every
edit committed to SQLite there is no dirty buffer to flush.
**Resolution:** ADR 0001 — autosave, and the menu item becomes
`Save a Copy…` (export), which is an action that actually exists.

**4. Elevation fields conflict with "do not invent elevation".** Section 6
requires elevation gain and loss on routes; section 11 forbids inventing
elevation data. Most GPX `<rte>` elements carry no `<ele>`.
**Resolution:** elevation columns and derived gain/loss are nullable and render
as "not available", never as `0`. Encoded as a steering rule in
`architecture.md` under Data integrity.

**5. Route "estimated duration" has no basis in Phase 1–2.** Section 3 asks for
estimated duration, but duration needs either recorded timestamps (routes have
none) or a routing provider (Phase 4) or an assumed speed.
**Resolution:** duration is shown only when derivable. For planned routes it is
labelled as an estimate at a user-configured speed, with the speed visible in
the UI. It is not shown as a bare number implying measurement.

## Technical risk — scoped

**6. GDB has no JavaScript parser.** No GDB reader exists on npm. The only
mature implementation is GPSBabel. **Resolution:** initially investigation-only
under ADR 0006, on the assumption of a proprietary application licence. Revised
once the licence was set to GPL-3.0 (ADR 0007): GPSBabel is GPL-2.0-or-later and
therefore compatible, so GDB support is now viable. It remains Phase 5 work, and
still may not be advertised until tested against real sample files.

**7. FIT licence gate — resolved against the official SDK.** `@garmin/fitsdk` is
official and current, but its licence is the bilateral "FIT Protocol License
Agreement", a proprietary EULA. **Resolution:** incompatible with GPL-3.0, so it
is rejected. The MIT-licensed `fit-file-parser` is the implementation.

**8. Track point volume will not survive a naive schema.** Section 12 lists a
track points table; recorded tracks run to hundreds of thousands of points.
Row-per-point rendered straight to Leaflet will stall the UI.
**Resolution:** ADR 0003 — normalised points as source of truth, simplified
render cache, original file bytes retained.

**9. Tile caching and "no bulk download" need a precise line.** Section 13
permits cached tiles while section 4 forbids prefetching. The OSM Foundation
tile usage policy also requires an identifying User-Agent and prohibits bulk
downloading. **Resolution:** cache only tiles fetched for user-initiated
viewing, honour HTTP cache headers, set a descriptive User-Agent, implement no
prefetch or area-download feature whatsoever. Any offline map capability
arrives as a user-supplied local tile source, not as a downloader.

**10. Strict CSP versus remote tile images.** Electron hardening and remote
tiles pull against each other and the spec does not mention CSP.
**Resolution:** tile hosts allowlisted in `img-src` only; `script-src` stays
`'self'`. Adding a map provider therefore means editing the CSP allowlist, which
is a deliberate choke point.

**11. Undo/redo is architecturally expensive if deferred.** Section 15 asks for
it "where appropriate" and lists it in the Edit menu, but it is unscheduled in
the phase plan. Retrofitting it over components that write to the database
directly is a rewrite. **Resolution:** Phase 1 routes every mutation through a
service method with an explicit inverse. The history stack itself lands in
Phase 2, but the shape that makes it possible is Phase 1 work.

## Gaps — specification was silent

**12. Attachment storage was unspecified.** Photographs could be database blobs
or files on disk. **Resolution:** files in the app support directory, database
holds metadata, relative path and content hash. Keeps the database small enough
to back up cheaply.

**13. Phase 1 asks for library features that need later phases.** "Sort by
distance" and drag-and-drop organisation are listed under the Phase 1 trip
library, but distance requires routes and tracks, which arrive in Phases 2–3.
**Resolution:** Phase 1 ships sort by name and date. Sort by distance is
deferred to Phase 3, when there is a distance to sort by. Noted in the Phase 1
spec so the omission is intentional and visible.

**14. No application licence was stated.** This gated finding 6 entirely, since
whether GPL tooling can be used depends on it. **Resolution:** settled by the
owner on 2026-11-05 — **GPL-3.0-or-later**, free distribution, no accounts or
paywalls. A 369-package dependency audit was run as the stated precondition and
found zero incompatibilities after three exclusions. See ADR 0007, ADR 0008 and
`docs/licences/third-party-register.md`. One consequence reaches back into
Phase 1: `react-leaflet` is Hippocratic-2.1 licensed and had to be dropped in
favour of using Leaflet directly.

**15. Trip archiving needs a state field and a tree filter.** Section 5 lists
archiving among trip operations but the tree in section 3 has no archived view.
**Resolution:** `trips.status` with `active` / `archived`; archived trips are
hidden from the default tree and reachable through a filter.

**16. "Imported Data" overlaps with "choose destination trip".** Section 9 lets
the user pick a destination trip on import, while section 3 shows Imported Data
as a tree node. **Resolution:** Imported Data is a view over `import_history`,
not a container. Imports with no chosen destination auto-create a trip named
after the source file.

## Open questions for the owner

These need an answer and are not safe to assume.

1. **Distance and elevation units**: metric, imperial, or user preference with
   which default? Storage is SI regardless; this is a display question.

### Answered

- **Product name** — TrailRT, decided 2026-11-05. See finding 1.
- **Application licence** — GPL-3.0-or-later, free distribution, decided
  2026-11-05. See finding 14 and ADR 0007.
- **Code signing** — no Developer ID initially, decided 2026-11-05. Ad-hoc
  signing with hardened runtime retained; notarisation configured but disabled.
  See ADR 0009.
