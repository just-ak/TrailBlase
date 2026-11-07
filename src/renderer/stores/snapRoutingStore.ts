import { create } from 'zustand';
import type { LatLon } from '@shared/geo/distance';
import type { PreviewedLeg } from '@shared/routing/results';

/**
 * State for the interactive snap routing tool.
 *
 * Its own store rather than more fields on `editorStore`, because this is the
 * only editing state with a network call in the middle of it. The ordering and
 * staleness machinery below exists for that reason and does not belong next to
 * the straight-line draw state, which cannot fail or arrive late.
 *
 * ## The invariant
 *
 * `legs.length <= controlPoints.length - 1`, and `legs[i]` is always the leg
 * from `controlPoints[i]` to `controlPoints[i + 1]`. Everything here exists to
 * keep that true while legs arrive asynchronously:
 *
 * - Legs are appended **in order, one request at a time**. A user clicking
 *   quickly would otherwise have leg 3 resolve before leg 2 and the arrays
 *   would silently misalign — the saved route would then join the wrong points
 *   and nothing would look obviously wrong on screen.
 * - `generation` is bumped whenever the shape changes out from under an
 *   in-flight request (backspace, cancel, restart). A reply tagged with a stale
 *   generation is dropped rather than appended to a line it no longer describes.
 */

interface SnapRoutingState {
  /** The points the user clicked. */
  controlPoints: LatLon[];
  /** Routed legs, strictly index-aligned with the gaps between control points. */
  legs: PreviewedLeg[];
  /** True while a leg is being routed. */
  routing: boolean;
  /** Set when a leg could not be routed at all, as opposed to being unmatched. */
  error: string | null;
  /**
   * Incremented whenever an in-flight reply would no longer be valid. Callers
   * capture it before awaiting and discard their result if it has moved.
   */
  generation: number;

  reset(): void;
  appendPoint(point: LatLon): void;
  /** Removes the last control point and the leg that reached it. */
  undoLastPoint(): void;
  setRouting(routing: boolean): void;
  setError(error: string | null): void;
  /**
   * Appends a routed leg if it is still the one we are waiting for.
   *
   * Returns false when the reply was stale, so the caller can stop draining
   * rather than loop against state that has moved on.
   */
  acceptLeg(generation: number, index: number, leg: PreviewedLeg): boolean;
  /** The next leg that needs routing, or null when the line is complete. */
  nextGap(): { index: number; from: LatLon; to: LatLon } | null;
}

export const useSnapRoutingStore = create<SnapRoutingState>((set, get) => ({
  controlPoints: [],
  legs: [],
  routing: false,
  error: null,
  generation: 0,

  reset: () =>
    set((state) => ({
      controlPoints: [],
      legs: [],
      routing: false,
      error: null,
      // Bumped, not zeroed: a request in flight from the previous session must
      // not be able to land in the new one.
      generation: state.generation + 1,
    })),

  appendPoint: (point) =>
    set((state) => ({
      controlPoints: [...state.controlPoints, point],
      error: null,
    })),

  undoLastPoint: () =>
    set((state) => ({
      controlPoints: state.controlPoints.slice(0, -1),
      // One fewer point means one fewer gap, so the last leg goes too.
      legs: state.legs.slice(0, Math.max(0, state.controlPoints.length - 2)),
      error: null,
      generation: state.generation + 1,
      routing: false,
    })),

  setRouting: (routing) => set({ routing }),
  setError: (error) => set({ error }),

  acceptLeg: (generation, index, leg) => {
    const state = get();
    if (state.generation !== generation) return false;
    // The leg must be exactly the next one. Anything else means two drains ran
    // concurrently, and appending would corrupt the alignment.
    if (index !== state.legs.length) return false;
    set({ legs: [...state.legs, leg] });
    return true;
  },

  nextGap: () => {
    const { controlPoints, legs } = get();
    const index = legs.length;
    const from = controlPoints[index];
    const to = controlPoints[index + 1];
    if (from === undefined || to === undefined) return null;
    return { index, from, to };
  },
}));

/** Total metres over the routed legs. Null until at least one leg has landed. */
export function snapRoutedDistanceM(legs: readonly PreviewedLeg[]): number | null {
  if (legs.length === 0) return null;
  let total = 0;
  for (const leg of legs) {
    // A provider that reported no distance makes the total unknown rather than
    // short. Understating a route's length is worse than declining to state it.
    if (leg.distanceM === null) return null;
    total += leg.distanceM;
  }
  return total;
}

export function snapPointCount(legs: readonly PreviewedLeg[]): number {
  if (legs.length === 0) return 0;
  // Shared vertices are dropped on save, so count them that way here too —
  // the number shown must be the number that gets stored.
  return legs.reduce((sum, leg) => sum + leg.shape.length, 0) - (legs.length - 1);
}
