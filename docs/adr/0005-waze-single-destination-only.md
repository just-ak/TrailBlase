# ADR 0005: Waze hand-off is single-destination only

Status: accepted
Date: 2026-11-05

## Context

Section 4 of the project specification asks for an optional action to "open a
selected destination or route in Waze using supported external navigation
links".

The destination half is straightforward. The route half is not supported by the
platform. Waze deep links take a single target via
`https://waze.com/ul?ll=<lat>,<lon>&navigate=yes`, and Google's navigation
hand-off documentation states that passing multiple waypoints in the URL makes
Waze display an error, recommending separate trips instead
([Launch Google Maps or Waze](https://developers.google.com/maps/documentation/navigation/connect/launch-navigation-app),
[Waze deep links](https://developers.google.com/waze/deeplinks)).
Content rephrased for compliance with licensing restrictions.

There is no public Waze API for submitting a multi-point route or a GPX file.

## Decision

Implement a single-destination hand-off only:

- On a waypoint: "Navigate with Waze" opens that coordinate.
- On a route or track: the action resolves to the **end point**, and the menu
  label says so explicitly — "Navigate to end point with Waze".

No attempt is made to synthesise a multi-stop Waze link. The UI does not offer
"open route in Waze", because that would be a control that cannot do what its
label claims.

URLs are opened with `shell.openExternal` after coordinate validation, never in
an in-app browser window.

## Consequences

The specification's stated intent is partially unmet, and that is a platform
limitation rather than an implementation gap. Documented here and surfaced in
the Phase 4 spec rather than papered over.

Turn-by-turn navigation along a planned multi-point route is out of scope for
any external hand-off. If it is ever needed it requires a real routing provider
plus in-app guidance, which is a different feature entirely.
