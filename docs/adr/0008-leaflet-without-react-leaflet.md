# ADR 0008: Use Leaflet directly, drop react-leaflet

Status: accepted
Date: 2026-11-05

## Context

The source specification names Leaflet as the mapping library. The obvious React
binding is `react-leaflet`, and it was in the verified version matrix at 5.0.0.

The GPL-3.0 dependency audit (ADR 0007) found that `react-leaflet` and its
`@react-leaflet/core` package are licensed **Hippocratic-2.1**, and have been
since at least 4.2.1. That licence conditions use on human rights compliance
and requires the licensee to indemnify the licensor. Both are additional
restrictions that GPL-3.0 section 7 forbids, and the field-of-use condition
means it is not OSI-approved open source either. It fails the project policy on
two counts: incompatible with the chosen licence, and not open source.

Leaflet itself is **BSD-2-Clause** and entirely unaffected.

Options considered:

1. Change the application licence to something permissive. Rejected: the owner
   set GPL-3.0 as policy, and Hippocratic would still not be open source.
2. Replace Leaflet with MapLibre GL JS (BSD-3-Clause). A larger change than the
   problem warrants, and it moves away from the specified library.
3. Use Leaflet directly and write the thin React integration in-house.

## Decision

Option 3. `leaflet@1.9.4` with no React binding package.

This costs very little, because the Phase 1 design was already going to bypass
react-leaflet's declarative model. The design holds a single imperative Leaflet
instance in a ref, creates it once, never recreates it on re-render, and drives
resize through a `ResizeObserver` calling `invalidateSize()`. That is the
imperative escape hatch, not the declarative API. What is needed is roughly:

- a `useLeafletMap` hook owning instance creation, teardown and resize
- a tile-layer effect reading the active `MapProvider`
- per-object-type layer effects, added in Phases 2 and 3 as routes, waypoints
  and tracks arrive

The source specification also asks to avoid unnecessary dependencies and keep
the application modular. Removing a binding layer in favour of ~150 lines of
hooks that we control is consistent with that.

## Consequences

More code owned in-house, and no community-maintained binding to inherit fixes
from. Mitigated by the surface being small and well covered by the Phase 1 map
tests.

A benefit falls out of it: Leaflet plugin integration, which Phase 4 needs for
additional providers and controls, is simpler without working around a binding
layer's component lifecycle.

`react-leaflet` is removed from the version matrix in
`.kiro/steering/toolchain.md`. It must not be reintroduced. Any future React
binding for a map library has to pass the licence check in
`.kiro/steering/licensing.md` first.
