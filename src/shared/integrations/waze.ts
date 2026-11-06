import type { LatLon } from '../geo/distance';

/**
 * Waze hand-off — Requirement 7.
 *
 * ## Waze takes one destination, and that is the whole feature
 *
 * The documented deep link accepts a single `ll` pair. There is no public
 * parameter for intermediate stops, so a multi-waypoint hand-off cannot be
 * built, and the honesty rule in `.kiro/steering/architecture.md` says to state
 * that rather than ship a control that silently drops most of the route.
 *
 * Consequently:
 *
 * - A waypoint hands off its own position.
 * - A route or track hands off its **end point**, and every label says so. Not
 *   its start: the user is planning to travel the route, so the useful
 *   destination is where it finishes.
 * - There is no "send whole route to Waze" action anywhere, because there is no
 *   way to implement one.
 *
 * `navigate=yes` asks Waze to begin navigating rather than only dropping a pin,
 * which is what a user pressing this expects.
 */

export const WAZE_LIMITATION =
  'Waze accepts a single destination, so only one point can be sent. There is no way to hand over a whole route.';

export interface WazeTarget {
  /** Shown on the button and in the confirmation. */
  label: string;
  point: LatLon;
}

/**
 * Builds the deep link.
 *
 * Coordinates are rounded to six decimals — about 11 cm, far finer than any
 * road — because a full double prints seventeen digits of noise into a URL that
 * ends up in a log.
 */
export function wazeNavigateUrl(point: LatLon): string {
  const lat = point.lat.toFixed(6);
  const lon = point.lon.toFixed(6);
  return `https://www.waze.com/ul?ll=${lat}%2C${lon}&navigate=yes`;
}

/**
 * Resolves what a selection hands off, or null when it cannot.
 *
 * Returns the reason in `label` rather than throwing: the caller is a button
 * that needs to be disabled with an explanation, not an error path.
 */
export function wazeTargetFor(
  selection:
    | { kind: 'waypoint'; name: string; point: LatLon }
    | { kind: 'route' | 'track'; name: string; points: readonly LatLon[] },
): WazeTarget | null {
  if (selection.kind === 'waypoint') {
    return { label: selection.name, point: selection.point };
  }

  const end = selection.points.at(-1);
  if (end === undefined) return null;

  return {
    // "end point" appears in the label itself, so the user cannot mistake this
    // for sending the whole route.
    label: `${selection.name} — end point`,
    point: { lat: end.lat, lon: end.lon },
  };
}
