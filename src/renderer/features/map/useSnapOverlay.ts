import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { RouteProvenance } from '@shared/routing/results';

/**
 * Draws the parts of a snapped route that are **not** on a road.
 *
 * Requirement 3.6: when the provider cannot route a leg, the straight line
 * survives and the user is told which section it is. A snapped route that
 * quietly contains three straight-line shortcuts through a mountain would be
 * the worst kind of silent failure, so each one gets a dashed red line over the
 * top of the route and a count in the properties panel.
 *
 * An unmatched leg is exactly the straight line between two control points, so
 * the pair of indices plus the control-point coordinates is all this needs. It
 * does not try to locate the straight sections inside the snapped point array,
 * which would be guesswork.
 *
 * Only the selected route is annotated. Marking every route in a trip would
 * turn the map into a warning display.
 */
export function useSnapOverlay(
  map: L.Map | null,
  provenance: RouteProvenance | null,
): void {
  const groupRef = useRef<L.LayerGroup | null>(null);

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
    if (provenance === null) return;

    for (const [from, to] of provenance.unmatchedLegs) {
      const a = provenance.controlPoints[from];
      const b = provenance.controlPoints[to];
      if (a === undefined || b === undefined) continue;

      L.polyline(
        [
          [a.lat, a.lon],
          [b.lat, b.lon],
        ],
        {
          color: '#dc2626',
          weight: 3,
          dashArray: '6 6',
          // Not interactive: this is an annotation over the route, and
          // intercepting clicks would break vertex editing underneath it.
          interactive: false,
        },
      ).addTo(group);
    }
  }, [map, provenance]);
}
