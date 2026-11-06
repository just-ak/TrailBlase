# TrailRT specs

The source specification was authored outside this repository. It has been
reviewed, and broken into one spec per development phase.

Start with the review — it records where the source specification is internally
inconsistent or technically unachievable as written, and what was decided
instead.

| Document                                                         | Purpose                                                                      |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [`spec-review.md`](spec-review.md)                               | Findings against the source specification, plus open questions for the owner |
| [`phase-1-foundation/`](phase-1-foundation/)                     | Requirements, design and tasks. **Complete.**                      |
| [`phase-2-routes-waypoints/`](phase-2-routes-waypoints/)         | Requirements, design and tasks. **Complete.**                                       |
| [`phase-3-tracks-import-export/`](phase-3-tracks-import-export/) | Requirements, design and tasks. **Complete.**                                |
| [`phase-4-advanced-mapping/`](phase-4-advanced-mapping/)         | Requirements only. Unblocked; re-scoped with snap-to-road and speed profiling |
| [`phase-5-windy-roads-routing/`](phase-5-windy-roads-routing/)   | Investigation complete; requirements written. Blocked on Phase 4.            |
| [`phase-6-garmin-compatibility/`](phase-6-garmin-compatibility/) | Requirements only. Mostly investigation deliverables.                        |

Only the built phases have a design and task breakdown. That is deliberate:
section 20 of the source specification requires that later phases are not
designed or implemented until the previous one is built and tested. Designing
Phase 3's import subsystem before Phase 2 existed would have meant guessing at
interfaces that had not yet settled.

Phase 4's requirements were revised after Phase 3 shipped, adding snap-to-road,
a combined route profile, and speed identification with a percentage-of-route
breakdown. The reasoning behind the awkward parts — why a posted speed limit and
a recorded speed are never the same series, and why "unknown" has to be a
visible band — is in ADR 0011.

Phase 5 (windy-roads routing) was then inserted ahead of the Garmin work, which
moved to Phase 6. That phase carries an extra document,
[`investigation.md`](phase-5-windy-roads-routing/investigation.md), because its
brief required a codebase assessment before any architectural decision — and
that assessment found the feature's three stated prerequisites do not exist yet.
ADR 0012 records what the finding settles and what it defers.

## Supporting documents

- [`../../docs/adr/`](../../docs/adr/) — architectural decisions, including the
  ones that resolve contradictions in the source specification
- [`../../docs/progress-mindmap.svg`](../../docs/progress-mindmap.svg) —
  implementation status across all phases
- [`../../docs/licences/third-party-register.md`](../../docs/licences/third-party-register.md)
  — dependency licence register, required by the GPL-3.0 policy
- [`../steering/`](../steering/) — always-applied rules: toolchain, architecture
  boundaries, licensing, progress tracking

## Decision index

| ADR  | Decision                                                 |
| ---- | -------------------------------------------------------- |
| 0001 | Local-first autosave; no bare "Save" menu item           |
| 0002 | TypeScript 7 with oxlint, not typescript-eslint          |
| 0003 | Track points normalised, with a rebuildable render cache |
| 0004 | Library tree top-level nodes are views, not containers   |
| 0005 | Waze hand-off is single-destination only                 |
| 0006 | Garmin proprietary format scope — amended by 0007        |
| 0007 | GPL-3.0-or-later licence, free distribution, dep audit   |
| 0008 | Leaflet used directly; react-leaflet dropped on licence  |
| 0009 | Ad-hoc signing until a Developer ID is available         |
| 0010 | Native module ABI and Electron binary delivery findings  |
| 0011 | Posted limit and recorded speed are separate; snapping   |
| 0012 | Windy-roads routing needs Phase 4; twistiness steers     |
