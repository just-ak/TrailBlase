/**
 * The routing provider abstraction.
 *
 * Declared now because Phase 4 implements it. Phase 1 deliberately left it out
 * on the grounds that an interface with no caller is a placeholder; that is no
 * longer the case.
 *
 * The interface speaks domain terms and never a provider's wire format. A
 * Valhalla response is translated in `main/routing/valhalla.ts` and nowhere
 * else, which is what makes a second provider an adapter rather than a
 * refactor. Trip management must never reference a concrete provider — see
 * `.kiro/steering/architecture.md`.
 *
 * Everything here is plain TypeScript: no `electron`, no `node:*`, no HTTP, so
 * both processes and the unit tests can use it freely.
 */

import type { LatLon } from '../geo/distance';

/**
 * How the provider should treat the roads.
 *
 * Deliberately a small set that maps onto what every engine offers. `auto` is
 * the default because it is the mode with the widest road coverage, and the
 * one a user planning a driving or motorcycling trip wants.
 */
export const TRANSPORT_MODES = [
  'auto',
  'motorcycle',
  'bicycle',
  'pedestrian',
] as const;

export type TransportMode = (typeof TRANSPORT_MODES)[number];

export const DEFAULT_TRANSPORT_MODE: TransportMode = 'auto';

/**
 * Road classification, in descending order of significance.
 *
 * These are the values Valhalla normalises OpenStreetMap's `highway` tag into.
 * They are reused as the domain vocabulary rather than inventing a parallel
 * set, because a second provider will almost certainly also be expressing OSM
 * classifications and a translation layer would add a mapping to get wrong.
 */
export const ROAD_CLASSES = [
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'service_other',
] as const;

export type RoadClass = (typeof ROAD_CLASSES)[number];

/** Surface quality, coarse enough to be comparable across providers. */
export const SURFACE_KINDS = [
  'paved_smooth',
  'paved',
  'paved_rough',
  'compacted',
  'dirt',
  'gravel',
  'path',
  'impassable',
] as const;

export type SurfaceKind = (typeof SURFACE_KINDS)[number];

export function isRoadClass(value: unknown): value is RoadClass {
  return (ROAD_CLASSES as readonly unknown[]).includes(value);
}

export function isSurfaceKind(value: unknown): value is SurfaceKind {
  return (SURFACE_KINDS as readonly unknown[]).includes(value);
}

/**
 * One leg of a snapped route: the road geometry between two control points.
 *
 * `matched: false` means the provider could not find a road path for this leg,
 * and `shape` is then the straight line between the control points. Partial
 * matching is normal, not an error — Requirement 3.6.
 */
export interface RouteLeg {
  matched: boolean;
  /** Index of the control point this leg starts at. */
  fromControlIndex: number;
  toControlIndex: number;
  /** Road geometry, or the straight line when unmatched. */
  shape: LatLon[];
  /** Metres. Null when the provider did not report it. */
  distanceM: number | null;
  /** Seconds. Null when not reported. Never used as a measurement. */
  durationS: number | null;
}

export interface SnapResult {
  provider: string;
  mode: TransportMode;
  legs: RouteLeg[];
  /**
   * Control-point index pairs the provider could not match, so the UI can
   * explain which parts of the route are still straight lines.
   */
  unmatchedLegs: [number, number][];
}

/**
 * One road segment from a map match, with the attributes we have a use for.
 *
 * Indices refer to positions in the matched shape returned alongside, so a
 * caller can attribute a stretch of geometry without a second lookup.
 *
 * Every attribute is nullable, and that is the point: OpenStreetMap coverage
 * for speed limits is partial, so "no limit in the data" is the common case and
 * must be representable. Null is never 0. See ADR 0011.
 */
export interface MatchedEdge {
  startIndex: number;
  endIndex: number;
  /** Metres. */
  lengthM: number | null;
  /** Posted legal limit in metres per second. Null when the data has none. */
  speedLimitMps: number | null;
  roadClass: RoadClass | null;
  surface: SurfaceKind | null;
}

export interface MatchResult {
  provider: string;
  mode: TransportMode;
  /** The geometry the edges index into. */
  shape: LatLon[];
  edges: MatchedEdge[];
  /** Points the provider could not match to any road. */
  unmatchedPointCount: number;
}

export interface RoutingProvider {
  readonly id: string;
  readonly name: string;
  /**
   * Origins this provider connects to. The main process builds the CSP
   * `connect-src` allowlist from these, so a provider cannot reach a host it
   * has not declared — the same contract `MapProvider.tileHosts` has.
   */
  readonly origins: readonly string[];
  readonly attribution: string;

  /** Road geometry between successive control points. */
  snap(
    controlPoints: readonly LatLon[],
    mode: TransportMode,
  ): Promise<SnapResult>;

  /** Road attributes along an existing geometry. Never modifies it. */
  match(
    shape: readonly LatLon[],
    mode: TransportMode,
  ): Promise<MatchResult>;
}

/**
 * Hard ceiling on a snapped route's point count.
 *
 * `routePointsSchema` caps renderer-supplied geometry at 10,000 because a
 * `route:setGeometry` undo entry carries the whole previous array. Snapped
 * geometry is generated in the main process and does not arrive through that
 * path, so it gets its own, higher bound — but it still needs one, or a snap
 * across a continent would produce a route that cannot be drawn or exported.
 *
 * Beyond this the snap is refused with the count, before anything is written.
 */
export const MAX_SNAPPED_POINTS = 25_000;

/**
 * Above this, a snap is not undoable.
 *
 * The inverse would be a multi-megabyte array on a stack bounded at 50 entries.
 * Declaring it non-undoable and saying so is the honest option, and follows
 * `trackService.restoreOriginal`. Matches the IPC cap deliberately: the same
 * number bounds both paths.
 */
export const MAX_UNDOABLE_POINTS = 10_000;
