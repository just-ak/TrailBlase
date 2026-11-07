import type { LatLon } from '@shared/geo/distance';
import type { RoutePoint } from '@shared/domain/types';
import {
  MAX_SNAPPED_POINTS,
  MAX_UNDOABLE_POINTS,
  type RoutingProvider,
  type TransportMode,
} from '@shared/routing/RoutingProvider';
import type {
  PreviewedLeg,
  RouteProvenance,
  SnapOutcome,
} from '@shared/routing/results';
import type { Route } from '@shared/domain/types';
import type { Db } from '../db/client';
import * as controlRepo from '../db/repositories/routeControlPoints';
import * as repo from '../db/repositories/routes';
import { decodeMetadata, encodeMetadata } from '../db/metadata';
import { ServiceError } from './errors';
import type { Mutation } from './folderService';
import * as routeService from './routeService';

/**
 * Snapping a route to the road network.
 *
 * Separate from `routeService` on purpose. Everything here depends on an
 * external provider and can fail for reasons that have nothing to do with the
 * database; keeping it apart means `routeService` stays a pure local-storage
 * module that cannot be broken by a network change.
 *
 * ## The order of operations matters
 *
 * The provider is called **before** the transaction opens. A snap that fails
 * must leave the route exactly as it was, and holding a write transaction open
 * across a 20-second network call would block every other write for the
 * duration.
 *
 * ## Control points versus shape
 *
 * `route_control_points` stores what the user placed; `route_points` stores the
 * shape that is drawn and exported. A route with no control points was
 * hand-drawn, which is how every pre-Phase-4 route keeps behaving exactly as it
 * did without a feature flag anywhere.
 */

export type { RouteProvenance, SnapOutcome } from '@shared/routing/results';

/**
 * Flattens routed legs into one point array.
 *
 * Successive legs share a vertex — leg *n* ends where leg *n+1* begins — so the
 * duplicate is dropped. Keeping it would put a zero-length segment at every
 * control point, which inflates the point count and shows up as a stationary
 * sample in any speed calculation.
 *
 * Takes the legs rather than a whole `SnapResult` so the interactive tool,
 * which accumulates legs one at a time and never builds a `SnapResult`, joins
 * them by exactly the same rule as a whole-route snap.
 */
export function flattenLegs(
  legs: readonly { shape: readonly LatLon[] }[],
): LatLon[] {
  const points: LatLon[] = [];

  for (const leg of legs) {
    for (const [index, point] of leg.shape.entries()) {
      if (index === 0 && points.length > 0) {
        const last = points.at(-1);
        // Six decimals is about 11 cm; anything closer is the same vertex
        // reported twice rather than two distinct points.
        if (
          last !== undefined &&
          Math.abs(last.lat - point.lat) < 1e-6 &&
          Math.abs(last.lon - point.lon) < 1e-6
        ) {
          continue;
        }
      }
      points.push({ lat: point.lat, lon: point.lon });
    }
  }

  return points;
}

/**
 * Snapped geometry carries no per-point attributes.
 *
 * Elevation is `null` rather than copied from a nearby control point: the road
 * shape is a different set of positions, and carrying over a height measured
 * somewhere else would be inventing data. Name, symbol and notes belong to
 * points the user placed, not to road vertices.
 */
function toRoutePoints(points: readonly LatLon[]): RoutePoint[] {
  return points.map((point) => ({
    lat: point.lat,
    lon: point.lon,
    ele: null,
    name: null,
    symbol: null,
    notes: null,
  }));
}

function assertWithinCap(count: number): void {
  if (count <= MAX_SNAPPED_POINTS) return;
  throw new ServiceError(
    'INVALID_REQUEST',
    `Snapping this route would produce ${count.toLocaleString()} points, more than the ${MAX_SNAPPED_POINTS.toLocaleString()} TrailRT can store. Split the route into shorter sections.`,
  );
}

export interface SnapRouteInput {
  routeId: string;
  provider: RoutingProvider;
  mode: TransportMode;
  /**
   * Points to snap between. Defaults to the route's existing control points,
   * or its current geometry when it has never been snapped.
   */
  controlPoints?: readonly LatLon[] | undefined;
}

/**
 * Snaps an existing route.
 *
 * The returned mutation's inverse restores the previous geometry **and** the
 * previous control-point state, so undoing a snap returns a hand-drawn route to
 * being hand-drawn rather than leaving orphaned control points behind.
 */
export async function snapRoute(
  db: Db,
  input: SnapRouteInput,
): Promise<Mutation<SnapOutcome>> {
  const existing = routeService.get(db, input.routeId);

  const control =
    input.controlPoints ??
    (controlRepo.hasControlPoints(db, input.routeId)
      ? controlRepo.listControlPoints(db, input.routeId)
      : existing.points.map((p) => ({ lat: p.lat, lon: p.lon })));

  if (control.length < 2) {
    throw new ServiceError(
      'INVALID_REQUEST',
      'A route needs at least two points before it can be snapped to roads.',
    );
  }

  // Outside the transaction: a network call must not hold a write lock, and a
  // failure here must leave the route untouched.
  const snapped = await input.provider.snap(control, input.mode);
  const shape = flattenLegs(snapped.legs);

  if (shape.length < 2) {
    throw new ServiceError(
      'PROVIDER_ERROR',
      'The routing service returned no usable road geometry for this route.',
    );
  }

  assertWithinCap(shape.length);

  const previousPoints = existing.points;
  const previousControl = controlRepo.hasControlPoints(db, input.routeId)
    ? controlRepo.listControlPoints(db, input.routeId)
    : null;
  const previousMeta = repo.readMetadata(db, input.routeId);

  /*
   * Undo is offered only when the previous geometry is small enough to carry.
   *
   * The inverse of a geometry change is the whole previous array, and the undo
   * stack holds up to 50 entries. A multi-megabyte entry would be a memory
   * problem disguised as a convenience. Above the bound the operation declares
   * itself non-undoable and the UI says so — the same honesty
   * `trackService.restoreOriginal` applies.
   */
  const undoable = previousPoints.length <= MAX_UNDOABLE_POINTS;

  db.transaction(() => {
    const now = Date.now();
    controlRepo.replaceControlPoints(db, input.routeId, control);
    repo.replacePoints(db, input.routeId, toRoutePoints(shape));
    repo.writeStats(
      db,
      input.routeId,
      routeService.computeStats(toRoutePoints(shape)),
      now,
    );
    repo.writeRoutingProvenance(db, input.routeId, {
      routingProvider: snapped.provider,
      transportMode: snapped.mode,
      snappedAt: now,
    });
    // Unmatched legs live in metadata rather than a column: they are a list
    // whose length varies, only ever read back whole, and already the kind of
    // thing `metadata` exists for.
    repo.writeMetadata(db, input.routeId, {
      ...previousMeta,
      unmatchedLegs: snapped.unmatchedLegs,
    });
  });

  const outcome: SnapOutcome = {
    routeId: input.routeId,
    provider: snapped.provider,
    mode: snapped.mode,
    pointCount: shape.length,
    unmatchedLegs: snapped.unmatchedLegs,
    undoable,
  };

  return {
    result: outcome,
    inverse: undoable
      ? {
          kind: 'route:restoreSnap',
          payload: {
            id: input.routeId,
            points: previousPoints,
            controlPoints: previousControl,
            metadata: previousMeta,
          },
        }
      : // Declared rather than faked. A snap of a very large route is not
        // reversible from the stack, and saying so beats an inverse that would
        // not fit.
        { kind: 'none', payload: {} },
  };
}

/**
 * Restores a route's pre-snap state. Only reached through undo.
 *
 * Restores the control points too, including their absence: a route that was
 * hand-drawn before the snap must be hand-drawn again afterwards, not a snapped
 * route that happens to have the old geometry.
 */
export function restoreSnap(
  db: Db,
  input: {
    id: string;
    points: readonly RoutePoint[];
    controlPoints: readonly LatLon[] | null;
    metadata: Record<string, unknown>;
  },
): Mutation<SnapOutcome> {
  const existing = routeService.get(db, input.id);
  const currentControl = controlRepo.hasControlPoints(db, input.id)
    ? controlRepo.listControlPoints(db, input.id)
    : null;
  const currentMeta = repo.readMetadata(db, input.id);

  db.transaction(() => {
    const now = Date.now();
    repo.replacePoints(db, input.id, input.points);
    repo.writeStats(
      db,
      input.id,
      routeService.computeStats(input.points),
      now,
    );

    if (input.controlPoints === null) {
      controlRepo.clearControlPoints(db, input.id);
      repo.writeRoutingProvenance(db, input.id, {
        routingProvider: null,
        transportMode: null,
        snappedAt: null,
      });
    } else {
      controlRepo.replaceControlPoints(db, input.id, input.controlPoints);
    }

    repo.writeMetadata(db, input.id, input.metadata);
  });

  return {
    result: {
      routeId: input.id,
      provider: 'none',
      mode: 'auto',
      pointCount: input.points.length,
      unmatchedLegs: [],
      undoable: true,
    },
    inverse: {
      kind: 'route:restoreSnap',
      payload: {
        id: input.id,
        points: existing.points,
        controlPoints: currentControl,
        metadata: currentMeta,
      },
    },
  };
}

export function provenance(db: Db, routeId: string): RouteProvenance {
  const row = repo.readRoutingProvenance(db, routeId);
  const metadata = decodeMetadata(encodeMetadata(repo.readMetadata(db, routeId)));
  const unmatched = metadata.unmatchedLegs;
  const controlPoints = controlRepo.listControlPoints(db, routeId);

  return {
    routingProvider: row?.routingProvider ?? null,
    transportMode: (row?.transportMode as TransportMode | null) ?? null,
    snappedAt: row?.snappedAt ?? null,
    controlPointCount: controlPoints.length,
    controlPoints: controlPoints.map((p) => ({ lat: p.lat, lon: p.lon })),
    unmatchedLegs: Array.isArray(unmatched)
      ? (unmatched as [number, number][])
      : [],
  };
}

// ------------------------------------------- the interactive snap routing tool

/**
 * Routes a single leg, touching no database.
 *
 * This is what makes the tool interactive: a click routes the one new leg
 * instead of re-routing the whole line, so the cost of the tenth click is the
 * same as the cost of the first. Re-snapping the whole route on every click
 * would be quadratic in provider calls and would make a ten-point route
 * fifty-five requests instead of ten.
 *
 * Expressed through the existing `RoutingProvider.snap` rather than a new
 * `routeLeg` method on the interface. A two-point snap is already exactly one
 * `/route` call in the Valhalla adapter, so the interface gains no obligation
 * and a second provider has nothing extra to implement.
 */
export async function routeLeg(
  provider: RoutingProvider,
  from: LatLon,
  to: LatLon,
  mode: TransportMode,
): Promise<PreviewedLeg> {
  const result = await provider.snap([from, to], mode);
  const leg = result.legs[0];

  // An adapter that returns no leg at all is treated as an unmatched leg, not
  // an error. The user gets a straight line and is told, which is the same
  // outcome Requirement 3.6 specifies for a leg with no road path.
  if (leg === undefined || leg.shape.length < 2) {
    return {
      matched: false,
      shape: [
        { lat: from.lat, lon: from.lon },
        { lat: to.lat, lon: to.lon },
      ],
      distanceM: null,
    };
  }

  return {
    matched: leg.matched,
    shape: leg.shape.map((p) => ({ lat: p.lat, lon: p.lon })),
    distanceM: leg.distanceM,
  };
}

export interface CreateSnappedInput {
  tripId: string;
  name: string;
  colour: string | null;
  /** The points the user clicked. */
  controlPoints: readonly LatLon[];
  /** The previewed legs, one fewer than the control points. */
  legs: readonly PreviewedLeg[];
  mode: TransportMode;
  provider: string;
}

/**
 * Saves a route built with the interactive tool.
 *
 * Writes the **previewed** geometry rather than re-routing, for the reason
 * given on `PreviewedLeg`: the user accepted a specific line and must get it.
 *
 * The inverse is a plain route deletion, exactly as for any other route
 * creation, which is why this is undoable where a whole-route snap of a large
 * existing route is not — there is no previous geometry to carry, only a row to
 * remove.
 */
export function createSnappedRoute(
  db: Db,
  input: CreateSnappedInput,
): Mutation<Route> {
  if (input.controlPoints.length < 2) {
    throw new ServiceError(
      'INVALID_REQUEST',
      'A snapped route needs at least two points.',
    );
  }

  if (input.legs.length !== input.controlPoints.length - 1) {
    /*
     * A mismatch means the renderer's preview and its control points had drifted
     * apart, so neither is trustworthy. Refusing is the only safe answer:
     * writing the legs anyway would store a route whose control points do not
     * describe it, and a later re-snap would silently produce a different line.
     */
    throw new ServiceError(
      'INVALID_REQUEST',
      'That route could not be saved because its legs and points did not match. Nothing was written.',
      `${input.legs.length} legs for ${input.controlPoints.length} control points`,
    );
  }

  const shape = flattenLegs(input.legs);

  if (shape.length < 2) {
    throw new ServiceError(
      'INVALID_REQUEST',
      'That route has no usable geometry to save.',
    );
  }

  /*
   * Bounded by the undo limit, not the higher snapped-route limit.
   *
   * A route built click by click is undoable by construction, and keeping it
   * under `MAX_UNDOABLE_POINTS` means it also satisfies `routePointsSchema`, so
   * every later edit through `route:setGeometry` keeps working. Letting the tool
   * produce 25,000 points would create routes this application can store but
   * not subsequently edit, which is a worse outcome than refusing the last leg.
   */
  if (shape.length > MAX_UNDOABLE_POINTS) {
    throw new ServiceError(
      'INVALID_REQUEST',
      `This route has reached ${shape.length.toLocaleString()} points, past the ${MAX_UNDOABLE_POINTS.toLocaleString()} TrailRT can keep editable. Finish it here and start another route, or remove the last leg.`,
    );
  }

  const unmatchedLegs: [number, number][] = [];
  for (const [index, leg] of input.legs.entries()) {
    if (!leg.matched) unmatchedLegs.push([index, index + 1]);
  }

  const created = db.transaction((): Route => {
    const now = Date.now();
    const mutation = routeService.create(db, {
      tripId: input.tripId,
      name: input.name,
      colour: input.colour,
      points: toRoutePoints(shape),
    });

    controlRepo.replaceControlPoints(
      db,
      mutation.result.id,
      input.controlPoints,
    );
    repo.writeRoutingProvenance(db, mutation.result.id, {
      routingProvider: input.provider,
      transportMode: input.mode,
      snappedAt: now,
    });
    repo.writeMetadata(db, mutation.result.id, { unmatchedLegs });

    return mutation.result;
  });

  return {
    result: created,
    // Deleting the route takes its control points and provenance with it: both
    // tables cascade on `route_id`, so there is nothing left behind to clean up
    // and no second inverse to get wrong.
    inverse: { kind: 'route:delete', payload: { id: created.id } },
  };
}
