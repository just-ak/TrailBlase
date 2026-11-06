# ADR 0012: Windy-roads routing depends on Phase 4, and twistiness must steer the search

Status: accepted, with the engine choice explicitly deferred

Date: 2026-11-06

## Context

A feature brief arrived asking for motorcycle-friendly routing that favours
winding roads, described as "an enhancement to the existing routing
architecture", integrating with "the existing routing, OpenStreetMap data,
snap-to-road functionality and GPX export capabilities". It mandated a codebase
investigation before any architectural decision.

That investigation ([`phase-5-windy-roads-routing/investigation.md`](../../.kiro/specs/phase-5-windy-roads-routing/investigation.md))
found that three of those four things do not exist:

- **No routing engine, and no HTTP client at all.** Runtime dependencies are
  `better-sqlite3`, `drizzle-orm`, `fast-xml-parser`, `fit-file-parser`,
  `jszip`. Route creation is manual click-to-place; `useDrawMode.ts` appends one
  vertex per click and `MapView.tsx` renders a visible hint reading "Straight
  lines — not snapped to paths".
- **No road-network data.** OpenStreetMap is consumed as raster tile imagery
  only, and `src/main/security/csp.ts` sets `connect-src 'self'`, which blocks
  every outbound request today.
- **No snap-to-road.** It is Phase 4 requirement text, unimplemented.
- **No bearing, turn-angle or curvature maths** anywhere in `src/shared/geo/`.

The brief also instructed: do not introduce a second routing engine without
establishing why the existing implementation cannot support the feature.

## Decision

### 1. This is Phase 5, inserted before Garmin compatibility

Garmin compatibility moves from Phase 5 to Phase 6. Windy-roads routing is
sequenced immediately after Phase 4 because it consumes Phase 4's output
directly, whereas the Garmin work consumes the Phase 3 import/export layer that
is already built and is mostly investigation.

### 2. The phase is blocked on Phase 4, as a hard dependency

Not a sequencing preference. There is no routing provider, no snap-to-road and
no transport mode to extend. Attempting this phase first would mean designing a
routing abstraction twice and throwing one away.

### 3. The "second engine" question resolves differently than the brief assumed

There is no first engine, so there is no incumbent to justify displacing. Phase
4 selects one. This phase's question is narrower and sharper: **can Phase 4's
provider express a caller-supplied, per-edge curvature cost?** If it can, the
feature is a cost model. If it cannot, the feature needs a different engine, and
that is where the comparison the brief asked for applies.

### 4. Twistiness steers the search; post-hoc re-ranking is rejected outright

The brief is explicit that twistiness must influence route selection rather than
being calculated after a conventional route exists, and that is adopted as a
hard requirement rather than a preference.

The consequence is load-bearing and worth stating plainly: **a hosted routing
API cannot satisfy this.** Public endpoints do not accept caller-supplied
per-edge weights. So "call a hosted service and re-rank its alternatives" is
cheap, easy, and does not implement the feature. It is rejected now so that it
does not reappear during design as a pragmatic compromise.

Equally, the detour budget is enforced during selection, not reported
afterwards. A route that breaches the budget is not the chosen route.

### 5. Unknown curvature is not low curvature

A road segment with too few geometry points to score returns **unknown**, not a
low score. OpenStreetMap geometry density reflects mapping effort as much as
road shape: a densely digitised motorway curve and a sparsely digitised lane are
not comparable without normalisation, and a lane mapped as three points is not
evidence of a straight road.

This is the same rule that keeps absent elevation as `null` rather than `0`, and
it is why the scoring function returns a nullable score.

### 6. Scoring is pure and lives in `shared/geo/`

The curvature algorithm is a pure function of geometry with no `electron`, no
`node:*` and no driver, consistent with the architecture steering and with
`distance.ts`, `simplify.ts` and `routeEdit.ts`. It is therefore unit-testable
with no Electron in the loop, which is the only way thresholds for "what counts
as a bend" can be argued about with evidence.

### 7. Curvature scores are a cache, like every other derived value

Keyed to the geometry they were computed from, invalidated when it changes,
recomputable, never the only copy. The `tracks.render_geometry` /
`render_tolerance_m` pair is the existing precedent.

### 8. Normal routing is a regression surface, not just a default

Existing behaviour for a user who does not opt in must be byte-identical:
geometry, statistics, storage, undo and export. This is covered by tests written
to fail if it changes, because "we did not mean to change it" is not a guarantee.

### 9. The engine choice is deferred, with the deciding criterion named

Three shapes remain open:

| Option | Twistiness steers search | What the user must install |
| --- | --- | --- |
| Extend the Phase 4 provider | Only if it accepts custom per-edge costs | Nothing new |
| Adopt a self-hosted second engine | Yes | A second runtime plus a multi-gigabyte OSM extract |
| In-house graph over a bounded extract | Yes | An extract; we implement the search |

Licence does not decide this — GraphHopper is Apache-2.0 and Valhalla is MIT,
both GPL-3.0 compatible. **Operational weight decides it.** The application
currently ships as one DMG with no server, no worker and no background process,
and the honest comparison is in what the user has to set up, not in what is
elegant.

One caveat to re-verify rather than inherit: a GraphHopper project forum answer
from 2022 states that a custom model can only multiply priority by a constant
factor derived from the curvature value, and cannot use that value as a term in
an expression
([GraphHopper forum](https://discuss.graphhopper.com/t/use-weighting-curvature-and-custom/7134)).
If still true, it narrows the first option considerably. Requirement 1.2 exists
to check it against the current release rather than trusting a four-year-old
post.

*Content from external sources was rephrased for compliance with licensing
restrictions.*

## Consequences

- Phase 5 cannot start until Phase 4 ships. Said up front rather than discovered.
- The 10,000-point cap in `routePointsSchema`, which exists because
  `route:setGeometry` undo entries carry whole point arrays, now blocks snapped
  geometry storage. A twisty 200 km route plausibly needs 20,000–50,000 points.
  Phase 5 Requirement 8 owns resolving this, and it is a schema decision.
- Rejecting post-hoc re-ranking removes the cheap implementation. The feature is
  genuinely more work as a result, and that is the correct trade.
- CPU-heavy scoring has nowhere to run today — there is no worker or background
  process in the application. Introducing the first one becomes an explicit
  decision in the Phase 5 design.
- `connect-src 'self'` must be widened deliberately, per declared provider host,
  for any network routing. The policy forced this to be visible, which is what
  it is for.
- The twistiness distribution ("% of route at each band") is the same shape of
  answer as Phase 4's speed distribution. Sharing that component is cheaper than
  building a second one, and is flagged as an open question.

## Alternatives rejected

**Treat it as an enhancement to existing routing, as the brief describes.**
There is nothing to enhance. Proceeding on the brief's premise would have
produced a design referencing interfaces that do not exist, which is exactly
what the mandatory investigation was there to prevent.

**Insert it as Phase 4.5, or fold it into Phase 4.** Phase 4 is already broad —
providers, routing abstraction, snapping, profiles, speed distribution. Folding
curvature routing in would make a large phase unshippable and blur which
capability failed when something did.

**Keep Garmin as Phase 5 and append this as Phase 6.** Possible, but it puts the
phase that depends most directly on Phase 4 furthest from it, and leaves the
routing abstraction sitting unexercised for a whole phase.

**Ship a simple "prefer small roads" heuristic instead.** Cheaper, and it is a
different feature. Preferring tertiary roads correlates with twistiness only
loosely, and labelling it "Find Windy Roads" would promise something the
implementation does not do.
