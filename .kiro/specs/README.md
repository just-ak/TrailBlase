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
| [`phase-3-tracks-import-export/`](phase-3-tracks-import-export/) | Requirements only. Ready to design.                                                           |
| [`phase-4-advanced-mapping/`](phase-4-advanced-mapping/)         | Requirements only. Blocked on Phase 3.                                       |
| [`phase-5-garmin-compatibility/`](phase-5-garmin-compatibility/) | Requirements only. Mostly investigation deliverables.                        |

Only the built phases have a design and task breakdown. That is deliberate:
section 20 of the source specification requires that later phases are not
designed or implemented until the previous one is built and tested. Designing
Phase 3's import subsystem before Phase 2 existed would have meant guessing at
interfaces that had not yet settled.

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
