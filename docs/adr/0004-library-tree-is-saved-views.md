# ADR 0004: Library tree top-level nodes are views, not containers

Status: accepted
Date: 2026-11-05

## Context

Section 3 lists the library tree as My Collection → Trips, Folders, Routes,
Tracks, Waypoints, Imported Data, Recently Used. Section 5 also states that a
trip contains routes, tracks and waypoints.

Read literally these conflict. If a route is a child of a trip, what is the
top-level Routes node? Either routes exist independently of trips, making trips
optional groupings, or Routes is something other than a container.

The ambiguity is load-bearing because it determines whether `routes.trip_id` is
nullable, and that is painful to change later.

## Decision

Ownership is strict and singular: every route, track and waypoint belongs to
exactly one trip. `trip_id` is `NOT NULL` with `ON DELETE CASCADE`.

The top-level Routes, Tracks, Waypoints, Imported Data and Recently Used nodes
are **saved views** — cross-trip queries, not storage locations. They are
read-only aggregations rendered by the same tree component with a different
data source.

Folders contain trips and other folders. They do not contain routes, tracks or
waypoints directly.

Imports that carry no trip context get an auto-created trip named after the
source file, so the invariant holds without the user being forced through a
dialog for every drag-and-drop.

## Consequences

Dragging a route from the Routes view onto a different trip is a reparent, not
a copy, and the UI says so.

Deleting a trip deletes its contents. This is a destructive operation and gets
a confirmation dialog that states the child counts.

A "loose" waypoint is impossible by construction, which removes a whole class
of orphan-cleanup logic.
