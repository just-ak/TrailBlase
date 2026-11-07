import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { LatLon } from '@shared/geo/distance';
import type { PreviewedLeg } from '@shared/routing/results';
import { pendingPointIcon } from './markers';

/**
 * The interactive snap routing tool's map interaction and preview layer.
 *
 * Deliberately a sibling of `useDrawMode` rather than a flag on it. The two
 * gestures look the same and behave differently in ways that matter:
 * `useDrawMode` keeps every click as a route vertex, while here a click is a
 * **control point** and the vertices between them come from the provider. A
 * shared hook would need a branch at every step and the distinction is exactly
 * what a reader needs to see.
 *
 * ## What the user can tell apart on screen
 *
 * - A **routed leg** is a solid line in the accent colour: this follows roads.
 * - An **unmatched leg** is dashed red, matching `useSnapOverlay` so a straight
 *   section looks identical whether it appeared during routing or after a
 *   whole-route snap. Requirement 3.6.
 * - A **gap still being routed** is a faint dotted line straight to the next
 *   control point, so a slow provider shows as pending rather than as a route
 *   that quietly stops short.
 *
 * That third state is the one worth having. Without it, a leg in flight is
 * indistinguishable from a leg that failed, and the user's next action — click
 * again, or wait — depends on which it is.
 */

interface Options {
  active: boolean;
  controlPoints: readonly LatLon[];
  legs: readonly PreviewedLeg[];
  routing: boolean;
  onAppend: (point: LatLon) => void;
  onUndoLast: () => void;
  onFinish: () => void;
  onCancel: () => void;
}

export function useSnapRouting(map: L.Map | null, options: Options): void {
  const { active, controlPoints, legs, routing } = options;
  const groupRef = useRef<L.LayerGroup | null>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // --- interaction
  useEffect(() => {
    if (map === null || !active) return;

    const container = map.getContainer();
    const previousCursor = container.style.cursor;
    container.style.cursor = 'crosshair';

    const onClick = (event: L.LeafletMouseEvent): void => {
      /*
       * The click is accepted even while a leg is in flight.
       *
       * Blocking clicks during a request would make the tool feel broken on a
       * slow provider. The legs are queued and routed in order by
       * `drainSnapLegs`, so clicking ahead is safe and the preview catches up.
       */
      optionsRef.current.onAppend({
        lat: event.latlng.lat,
        lon: event.latlng.lng,
      });
    };

    const onDoubleClick = (event: L.LeafletMouseEvent): void => {
      // Leaflet's zoom-on-double-click would otherwise fire alongside the
      // finish, leaving the user zoomed in on a route they just saved.
      L.DomEvent.stop(event);
      optionsRef.current.onFinish();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        optionsRef.current.onCancel();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        optionsRef.current.onFinish();
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        optionsRef.current.onUndoLast();
      }
    };

    map.on('click', onClick);
    map.on('dblclick', onDoubleClick);
    map.doubleClickZoom.disable();
    window.addEventListener('keydown', onKeyDown);

    return () => {
      map.off('click', onClick);
      map.off('dblclick', onDoubleClick);
      map.doubleClickZoom.enable();
      window.removeEventListener('keydown', onKeyDown);
      container.style.cursor = previousCursor;
    };
  }, [map, active]);

  // --- preview layer
  useEffect(() => {
    if (map === null) return;
    const group = L.layerGroup().addTo(map);
    groupRef.current = group;
    return () => {
      group.clearLayers();
      group.remove();
      groupRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const group = groupRef.current;
    if (map === null || group === null) return;

    group.clearLayers();
    if (!active || controlPoints.length === 0) return;

    for (const leg of legs) {
      const latlngs = leg.shape.map((p) => [p.lat, p.lon] as L.LatLngTuple);
      L.polyline(
        latlngs,
        leg.matched
          ? { color: '#f59e0b', weight: 4, interactive: false }
          : // Same styling as a snapped route's unmatched legs, so the meaning
            // is learned once.
            {
              color: '#dc2626',
              weight: 3,
              dashArray: '6 6',
              interactive: false,
            },
      ).addTo(group);
    }

    /*
     * The pending tail: control points with no leg yet.
     *
     * Drawn as one dotted line through all of them rather than only the next
     * gap, so clicking ahead of a slow provider shows the whole queue instead
     * of hiding the clicks that have not been reached.
     */
    const firstUnrouted = legs.length;
    if (firstUnrouted < controlPoints.length - 1) {
      const tail = controlPoints
        .slice(firstUnrouted)
        .map((p) => [p.lat, p.lon] as L.LatLngTuple);
      if (tail.length > 1) {
        L.polyline(tail, {
          color: routing ? '#f59e0b' : '#94a3b8',
          weight: 2,
          dashArray: '2 5',
          opacity: 0.8,
          interactive: false,
        }).addTo(group);
      }
    }

    for (const point of controlPoints) {
      L.marker([point.lat, point.lon], {
        icon: pendingPointIcon(),
        interactive: false,
        zIndexOffset: 500,
      }).addTo(group);
    }
  }, [map, active, controlPoints, legs, routing]);
}
