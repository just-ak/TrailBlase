# ADR 0011: Speed data has two sources, and they are never merged

Status: accepted

Date: 2026-11-06

## Context

Phase 4 gained three related requirements: snap a route to the road network,
show a profile along a route or track, and show what percentage of a route is at
each speed.

The last one looks like a single feature and is not. "The speed along this
route" can mean two completely different things:

- the **posted legal limit** of the roads the route follows, which is an
  attribute of the road network and has nothing to do with the user
- the **speed actually travelled**, which only exists for a recorded track with
  timestamps, and is a property of that recording

A planned route has no recorded speed, because nobody has driven it. A track
through an unmapped field has no posted limit, because there is no road. Many
objects have neither.

Two further facts shape the decision.

**Posted limits require map matching to a road network.** Of the open-source
routing engines, Valhalla's map-matching `trace_attributes` action returns
per-segment attributes including `speed_limit` and `road_class`, and its own
documentation is explicit that the posted limit is returned only "if available"
([Valhalla map matching](https://valhalla.github.io/valhalla/api/map-matching/),
[Valhalla speed information](https://valhalla.github.io/valhalla/concepts/speeds/)).
Valhalla is MIT licensed, which is compatible with GPL-3.0
([Valhalla README](https://github.com/valhalla/valhalla/blob/master/README.md)).
OSRM has a `match` service but exposes speeds computed from its own routing
profile rather than posted limits, which is a different quantity again and not
one a user would recognise as a speed limit.

**Coverage of the underlying tag is partial.** OpenStreetMap's `maxspeed` is
crowd-sourced and uneven: coverage is high on motorways and low on minor roads,
and varies by country. One national community's own audit put overall coverage
around 39%, above 99% for motorways and about 22% for unclassified roads
([OpenStreetMap community forum](https://community.openstreetmap.org/t/maximumsnelheden/74231)).
So "no limit in the data" is the common case on exactly the roads a trip
planner cares about, not an edge case.

Content on this page was rephrased for compliance with licensing restrictions.

## Decision

### 1. Two named sources, never one series

Speed is modelled as two distinct, separately labelled series:

| Source | Meaning | Available for | Origin |
| --- | --- | --- | --- |
| Posted limit | Legal maximum for the matched road | Routes and tracks | Road data, via a provider |
| Recorded | Distance over time between samples | Tracks with timestamps | The recording itself |

They are never averaged together, never fall back to one another, and the UI
always says which is on screen. A chart that silently substituted one for the
other would be unfalsifiable from the user's side.

### 2. Unknown is a band, sized honestly

Given the coverage reality above, a distribution that hides unmatched distance
would be wrong most of the time. Distance with no determinable speed goes into
an explicit **Unknown** band and is never redistributed across the known bands,
inferred from road class, or filled from a country default. A route that is 60%
Unknown says 60% Unknown.

### 3. Distribution is by distance, not by point count

Percentages are of route distance. Sample spacing is not uniform — a recorded
track clusters samples where the recorder moved slowly — so a point-count
percentage would systematically over-weight exactly the slow sections it is
meant to measure.

### 4. Snapping moves routes, never tracks

Snap-to-road replaces a route's geometry with road geometry, because a route is
an intention and the user is asking for it to follow the road. A track is a
measurement; moving its points onto a road would be fabricating data and is
forbidden by the import-fidelity rule. Map matching a track to *read* road
attributes is fine and leaves the track untouched.

A route keeps the control points the user placed alongside the snapped shape, so
editing one control point re-snaps only the affected legs rather than discarding
the user's intent.

### 5. A leg that cannot be matched stays straight and says so

Partial matching is normal. An unmatched leg stays as the straight line the user
drew, marked as unmatched, rather than the provider's best guess at a detour or
the whole operation failing.

### 6. No provider by default, and explicit opt-in to use one

Routing and speed lookup are network services, and sending a route to one
transmits the user's planned locations to a third party. Against the no-cloud
policy in `.kiro/steering/licensing.md`:

- core functionality never depends on a provider
- no provider is configured out of the box
- a user-supplied endpoint is supported, so a self-hosted Valhalla is a
  first-class option rather than an afterthought
- the first use states what will be sent and to whom, by name

### 7. Fetched attributes are a cache

Matched speeds and road classes are stored as a cache attributed to the provider
and the fetch date, invalidated when the geometry changes, and recomputable from
the geometry. They never become the only copy of anything.

### 8. A posted limit is not a travel-time estimate

Route duration stays the explicit planning-speed estimate from Phase 2, labelled
as an estimate. Speed limits are not quietly folded into it: a limit is a legal
ceiling, not a prediction, and presenting the combination as a duration would
dress an assumption as a calculation.

### 9. No infringement framing, no reporting

Where recorded speed is shown against the posted limit, it is presented as two
independently sourced measurements side by side. The app does not characterise
the difference as speeding, and no such comparison leaves the user's machine.
This is a trip planner, not a telematics product.

## Consequences

- The speed distribution will often be dominated by Unknown. That is the honest
  answer, and the UI has to make it readable rather than embarrassing.
- Routes need a second geometry layer (control points plus snapped shape), which
  is a schema change to design against the existing route storage.
- Valhalla is the provider the interface is designed against, but nothing
  concrete is referenced from trip management, so a second provider stays a
  registry entry.
- Users who want snapping and speed data must either accept a third-party
  service or run their own. Said plainly rather than hidden behind a toggle.

## Alternatives rejected

**One merged speed series with a fallback.** Simplest UI, and wrong: the user
could not tell whether a number came from a road database or from their own GPS.

**Infer limits from road class where the tag is absent.** Would fill the
Unknown band with plausible fiction. Rejected under the same rule that keeps
absent elevation as `null` rather than `0`.

**Bundle offline road data for local speed lookup.** Removes the network
dependency, but a routable extract is gigabytes and the licensing and update
story for shipping OSM-derived data is a project of its own. Revisit if offline
routing is ever scoped.

**OSRM instead of Valhalla.** Permissively licensed and widely hosted, but it
reports profile-derived speeds rather than posted limits, which is not the
quantity the requirement asks for.
