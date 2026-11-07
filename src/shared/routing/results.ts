import type { ProfileSpan } from '../geo/profile';
import type { RoadClass, SurfaceKind, TransportMode } from './RoutingProvider';

/**
 * Response contracts for the routing and road-attribute channels.
 *
 * These live in `shared/` because both processes compile against them: the
 * services build them, the preload bridge marshals them and the renderer reads
 * them. Keeping them next to `RoutingProvider` rather than in a service file is
 * what stops the renderer needing a type from `main/`, which it must never
 * import.
 *
 * Everything here is plain data. No closures, no class instances — it all has
 * to survive structured cloning across the context bridge.
 */

/** Which geometry an attribute or profile request refers to. */
export type AttributeOwnerType = 'route' | 'track';

export type RoutingUnavailableReason =
  | 'not-configured'
  | 'invalid-endpoint'
  | 'consent-required';

/** Whether routing is usable, and if not, which of three things to do about it. */
export interface RoutingStatus {
  available: boolean;
  providerId: string | null;
  /** Scheme + host + port the app would contact. Null when unresolvable. */
  origin: string | null;
  reason: 'available' | RoutingUnavailableReason;
  message: string | null;
  attribution: string | null;
  mode: TransportMode;
  /**
   * Whether **this endpoint** has answered a test route in this session.
   *
   * Replaced a field that claimed the *adapter* had never met a live Valhalla.
   * That was true when it was written and is no longer: the adapter is now
   * verified against a real instance by `valhalla.live.test.ts`. The useful
   * remaining question is about the user's own host, which no amount of
   * adapter testing can answer — hence the Test connection button, which is
   * what sets this.
   */
  endpointTested: boolean;
}

/** What the consent prompt says, built around the host actually configured. */
export interface ConsentNotice {
  origin: string;
  transmits: string[];
  withholds: string[];
}

/** What a snap did, so the UI can describe it rather than guess. */
export interface SnapOutcome {
  routeId: string;
  provider: string;
  mode: TransportMode;
  pointCount: number;
  /** Control-point index pairs that stayed straight lines. */
  unmatchedLegs: [number, number][];
  /** False when the previous geometry was too large to carry as an inverse. */
  undoable: boolean;
}

/** Snap provenance for the properties panel. Null provider means hand-drawn. */
export interface RouteProvenance {
  routingProvider: string | null;
  transportMode: TransportMode | null;
  snappedAt: number | null;
  controlPointCount: number;
  unmatchedLegs: [number, number][];
  /**
   * The points the user placed, as opposed to the road shape.
   *
   * Included so the map can draw the unmatched legs. An unmatched leg *is* the
   * straight line between two control points, so the pair in `unmatchedLegs`
   * plus these coordinates is everything needed — the alternative would be
   * hunting for the straight sections inside the snapped point array, which is
   * guesswork.
   *
   * Empty for a hand-drawn route, which is how a pre-Phase-4 route keeps
   * behaving exactly as it did.
   */
  controlPoints: { lat: number; lon: number }[];
}

/**
 * One routed leg, as previewed by the interactive snap routing tool.
 *
 * A trimmed `RouteLeg`: the control indices are implied by position in the
 * array, and `durationS` is dropped because nothing displays it and sending a
 * provider's travel-time estimate to the renderer invites someone treating it
 * as a measurement.
 *
 * These cross back to the main process on finish, so that what is saved is
 * exactly the geometry the user watched appear. Re-routing on save would be a
 * second set of provider calls that could legitimately return something else —
 * traffic-free vs not, a graph updated in between — and the route would quietly
 * differ from the one they accepted.
 */
export interface PreviewedLeg {
  /** False when the provider found no road path; `shape` is then the straight line. */
  matched: boolean;
  shape: { lat: number; lon: number }[];
  /** Metres, as reported by the provider. Null when it did not say. */
  distanceM: number | null;
}

/**
 * The result of testing a routing endpoint.
 *
 * `pointCount` is the interesting field: a service can answer 200 and still
 * not be a routing service, so the test is only passed if real road geometry
 * came back. "It responded" is not the question.
 */
export interface ConnectionTest {
  ok: boolean;
  origin: string | null;
  /** Round trip in milliseconds, including any politeness delay. */
  elapsedMs: number | null;
  /** Road vertices returned for the sample leg. Null on failure. */
  pointCount: number | null;
  message: string;
}

export interface AttributeStatus {
  provider: string;
  fetchedAt: number;
  /** True when the geometry has changed since these were fetched. */
  stale: boolean;
  edgeCount: number;
  unmatchedPointCount: number;
}

export interface ProfileSample {
  /** Cumulative metres from the start. */
  distanceM: number;
  lat: number;
  lon: number;
  /** Metres. Null where the source carried none — never 0. */
  eleM: number | null;
  /**
   * Metres per second over the segment **ending** at this sample, from the
   * recording's own timestamps. Null at the first sample and wherever the
   * recording is untimed.
   */
  recordedSpeedMps: number | null;
}

export interface ElevationSummary {
  minM: number | null;
  maxM: number | null;
  gainM: number | null;
  lossM: number | null;
}

/**
 * The profile panel's data.
 *
 * Every band is either present or absent **with a reason**. Requirement 5.6
 * forbids drawing a band with no data, and the reason is what lets the UI say
 * why — a recording with no barometer is a different situation from roads
 * never having been matched, and only the second is something the user can act
 * on. An empty array would make those indistinguishable.
 */
export interface Profile {
  ownerType: AttributeOwnerType;
  ownerId: string;
  totalDistanceM: number;
  /** Points in the source geometry, before thinning. */
  sourcePointCount: number;
  /** True when samples were thinned for display. The UI must say so. */
  simplified: boolean;
  samples: ProfileSample[];

  elevation: ElevationSummary | null;
  elevationAbsentBecause: string | null;

  /** Posted limits in metres per second, as distance spans. */
  postedSpeedSpans: ProfileSpan<number>[] | null;
  postedSpeedAbsentBecause: string | null;

  roadClassSpans: ProfileSpan<RoadClass>[] | null;
  roadClassAbsentBecause: string | null;

  surfaceSpans: ProfileSpan<SurfaceKind>[] | null;
  surfaceAbsentBecause: string | null;

  recordedSpeedAbsentBecause: string | null;

  /** Provenance for the road bands. Null when nothing has been matched. */
  attributes: AttributeStatus | null;
}
