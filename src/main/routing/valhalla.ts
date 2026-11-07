import { haversineDistance, type LatLon } from '@shared/geo/distance';
import {
  isRoadClass,
  isSurfaceKind,
  type MatchedEdge,
  type RouteLeg,
  type RoutingProvider,
  type TransportMode,
} from '@shared/routing/RoutingProvider';
import { ServiceError } from '../services/errors';
import { postJson } from './client';
import { decodeValhallaShape, encodePolyline, VALHALLA_PRECISION } from './polyline';

/**
 * The Valhalla adapter — the only file in the project that knows Valhalla's
 * wire format.
 *
 * Chosen first because it is MIT licensed and, per ADR 0011, the only
 * open-source engine that returns posted speed limits and road class from map
 * matching. A second provider is a new file like this one, not a refactor.
 *
 * ## Two unit conversions that must happen here
 *
 * Valhalla reports `length` in kilometres and `speed_limit` in km/h by default.
 * The request pins `units: 'kilometers'` explicitly rather than relying on that
 * default, and both are converted to SI at this boundary, because everything
 * inside the application stores metres and metres per second. A missed
 * conversion here would be a 3.6× error that looks plausible on a speed and
 * catastrophic on a distance.
 *
 * ## Verification status
 *
 * Tested three ways. `valhalla.test.ts` drives a loopback `node:http` server
 * for the error paths — timeout, 500, malformed JSON — that a real service will
 * not produce on demand. `polyline.test.ts` reproduces the documented
 * polyline vector. And `valhalla.live.test.ts` runs the real thing against a
 * real instance, confirming that `length` arrives in kilometres, `speed_limit`
 * in km/h, the shape is polyline6, and the road classes and surfaces survive
 * the guards:
 *
 *   npm run verify:valhalla
 *
 * The live test is opt-in so the default suite needs no network. It is what
 * retired the earlier caveat in this comment, which said the adapter had never
 * met a real deployment.
 *
 * One thing that caveat would not have caught, and which cost real time: the
 * public instance's API host is `valhalla1.openstreetmap.de`. Drop the `1` and
 * you reach the demo *website*, whose nginx answers POST with 405 — a correct
 * client looks broken and the error points nowhere useful.
 */

const KM_TO_M = 1000;
const KMH_TO_MPS = 1000 / 3600;

/**
 * Attributes requested from `trace_attributes`.
 *
 * An explicit include list, not the default. The documentation notes that with
 * no filter every attribute is returned, and for a long trace that payload is
 * very large and almost entirely unused. Asking for five fields instead of
 * sixty is the difference between a usable call and a wasteful one.
 */
const MATCH_ATTRIBUTES = [
  'edge.length',
  'edge.speed_limit',
  'edge.road_class',
  'edge.surface',
  'edge.begin_shape_index',
  'edge.end_shape_index',
  'shape',
  'matched.type',
] as const;

// --------------------------------------------------------------- wire types

interface ValhallaRouteResponse {
  trip?: {
    legs?: { shape?: string; summary?: { length?: number; time?: number } }[];
  };
}

interface ValhallaEdge {
  length?: number;
  speed_limit?: number;
  road_class?: string;
  surface?: string;
  begin_shape_index?: number;
  end_shape_index?: number;
}

interface ValhallaTraceAttributesResponse {
  edges?: ValhallaEdge[];
  shape?: string;
  matched_points?: { type?: string }[];
}

// ----------------------------------------------------------------- helpers

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Translates a mode to a Valhalla costing model.
 *
 * `motorcycle` is a real Valhalla costing option, which is why the mode set in
 * `shared/` includes it. A provider that lacks it would map it to `auto` in its
 * own adapter rather than the domain losing the distinction.
 */
function costingFor(mode: TransportMode): string {
  switch (mode) {
    case 'motorcycle':
      return 'motorcycle';
    case 'bicycle':
      return 'bicycle';
    case 'pedestrian':
      return 'pedestrian';
    case 'auto':
      return 'auto';
  }
}

/** Straight line between two control points, for an unmatched leg. */
function straightLeg(
  from: LatLon,
  to: LatLon,
  fromIndex: number,
): RouteLeg {
  return {
    matched: false,
    fromControlIndex: fromIndex,
    toControlIndex: fromIndex + 1,
    shape: [from, to],
    distanceM: haversineDistance(from, to),
    durationS: null,
  };
}

export interface ValhallaOptions {
  endpoint: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export const VALHALLA_PROVIDER_ID = 'valhalla';

export function createValhallaProvider(
  options: ValhallaOptions,
): RoutingProvider {
  const origins = [options.endpoint];

  const call = async <T>(path: string, body: unknown): Promise<T> =>
    postJson<T>({
      endpoint: options.endpoint,
      path,
      body,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });

  return {
    id: VALHALLA_PROVIDER_ID,
    name: 'Valhalla',
    origins,
    attribution: 'Routing by Valhalla · Road data © OpenStreetMap contributors',

    async snap(controlPoints, mode) {
      if (controlPoints.length < 2) {
        throw new ServiceError(
          'INVALID_REQUEST',
          'Snapping needs at least two points.',
        );
      }

      /*
       * One `/route` call per leg rather than one call for the whole sequence.
       *
       * A single multi-location call is cheaper, but it fails as a unit: if one
       * leg has no road path the whole request errors and the user gets
       * nothing. Per-leg means a single unroutable stretch stays a straight
       * line and the rest of the route still snaps — which is what Requirement
       * 3.6 asks for, and what a user actually wants when one of their points
       * landed in a field.
       */
      const legs: RouteLeg[] = [];
      const unmatchedLegs: [number, number][] = [];

      for (let i = 0; i < controlPoints.length - 1; i += 1) {
        const from = controlPoints[i];
        const to = controlPoints[i + 1];
        if (from === undefined || to === undefined) continue;

        try {
          // eslint-disable-next-line no-await-in-loop
          const response = await call<ValhallaRouteResponse>('/route', {
            locations: [
              { lat: from.lat, lon: from.lon },
              { lat: to.lat, lon: to.lon },
            ],
            costing: costingFor(mode),
            directions_options: { units: 'kilometers' },
          });

          const leg = response.trip?.legs?.[0];
          const shape =
            leg?.shape === undefined ? [] : decodeValhallaShape(leg.shape);

          if (shape.length < 2) {
            legs.push(straightLeg(from, to, i));
            unmatchedLegs.push([i, i + 1]);
            continue;
          }

          legs.push({
            matched: true,
            fromControlIndex: i,
            toControlIndex: i + 1,
            shape,
            // km → m. The request pinned kilometres, so this is the only
            // interpretation.
            distanceM:
              finite(leg?.summary?.length) === null
                ? null
                : (finite(leg?.summary?.length) as number) * KM_TO_M,
            durationS: finite(leg?.summary?.time),
          });
        } catch (cause) {
          /*
           * Only a *routing* failure becomes a straight line.
           *
           * The distinction matters more than it looks. "No road path between
           * these two points" is a local fact about one stretch, and falling
           * back to a straight line is what Requirement 3.6 asks for. "The
           * service is unreachable" is not a fact about the road at all, and
           * swallowing it would report every leg of a twenty-point route as
           * unmatched — twenty straight lines and no hint that the server was
           * down. The user would go looking for a gap in the map data.
           *
           * So transport-level failures propagate: unreachable, timed out,
           * rate-limited, cancelled. Each of those will affect the next leg
           * identically, which is the test for whether continuing makes sense.
           */
          if (cause instanceof ServiceError && cause.code !== 'PROVIDER_ERROR') {
            throw cause;
          }
          legs.push(straightLeg(from, to, i));
          unmatchedLegs.push([i, i + 1]);
        }
      }

      return { provider: VALHALLA_PROVIDER_ID, mode, legs, unmatchedLegs };
    },

    async match(shape, mode) {
      if (shape.length < 2) {
        throw new ServiceError(
          'INVALID_REQUEST',
          'Matching needs at least two points.',
        );
      }

      const response = await call<ValhallaTraceAttributesResponse>(
        '/trace_attributes',
        {
          // Encoded rather than an array of objects: the documentation notes
          // shape input can be large, and a 200,000-point track as JSON objects
          // is tens of megabytes of request body.
          encoded_polyline: encodePolyline(shape, VALHALLA_PRECISION),
          costing: costingFor(mode),
          // `map_snap` rather than the default `walk_or_snap`: our input is a
          // drawn route or a GPS track, never a shape that came from a prior
          // Valhalla route, so edge walking would always fail first and the
          // fallback would just cost a round of wasted work.
          shape_match: 'map_snap',
          directions_options: { units: 'kilometers' },
          filters: { attributes: [...MATCH_ATTRIBUTES], action: 'include' },
        },
      );

      const matchedShape =
        response.shape === undefined ? [] : decodeValhallaShape(response.shape);

      const edges: MatchedEdge[] = [];
      for (const edge of response.edges ?? []) {
        const startIndex = finite(edge.begin_shape_index);
        const endIndex = finite(edge.end_shape_index);
        if (startIndex === null || endIndex === null) continue;

        const lengthKm = finite(edge.length);
        const speedKmh = finite(edge.speed_limit);

        edges.push({
          startIndex,
          endIndex,
          lengthM: lengthKm === null ? null : lengthKm * KM_TO_M,
          /*
           * Absent stays null, never 0.
           *
           * Valhalla's documentation is explicit that the posted limit is
           * returned only when available, and OSM coverage is partial. A zero
           * here would read as "this road has a 0 km/h limit", and would land
           * in the lowest speed band instead of the Unknown one — turning a
           * data gap into a false measurement. ADR 0011.
           */
          speedLimitMps: speedKmh === null ? null : speedKmh * KMH_TO_MPS,
          roadClass: isRoadClass(edge.road_class) ? edge.road_class : null,
          surface: isSurfaceKind(edge.surface) ? edge.surface : null,
        });
      }

      const unmatchedPointCount = (response.matched_points ?? []).filter(
        (point) => point.type === 'unmatched',
      ).length;

      return {
        provider: VALHALLA_PROVIDER_ID,
        mode,
        shape: matchedShape,
        edges,
        unmatchedPointCount,
      };
    },
  };
}
