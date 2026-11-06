import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { haversineDistance, type LatLon } from '@shared/geo/distance';
import { pendingPointIcon } from './markers';

/**
 * The measure tool — Requirement 4.5.
 *
 * A distinct editor mode that **creates nothing**. No route, no waypoint, no
 * database write, and therefore no undo entry: there is nothing to undo,
 * because nothing happened. Putting a no-op on the undo stack would be worse
 * than leaving it off, since the user would press ⌘Z and watch an unrelated
 * edit disappear.
 *
 * The measurement lives in a Leaflet layer group and in this hook's state. It
 * is gone when the mode ends, which is the whole point of a scratch tool.
 *
 * Drawn visibly differently from a route: a thin dotted line in a distinct
 * colour, with no vertex handles. A measurement that looked like a route would
 * leave users hunting for the route they thought they had just drawn.
 */

export interface MeasureState {
  points: LatLon[];
  /** Cumulative metres along the placed points. */
  totalM: number;
  /** Metres in the last placed segment. Null with fewer than two points. */
  lastSegmentM: number | null;
}

export const EMPTY_MEASURE: MeasureState = {
  points: [],
  totalM: 0,
  lastSegmentM: null,
};

export function measureStateFrom(points: readonly LatLon[]): MeasureState {
  let total = 0;
  let last: number | null = null;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined) continue;
    last = haversineDistance(a, b);
    total += last;
  }
  return { points: [...points], totalM: total, lastSegmentM: last };
}

interface Options {
  active: boolean;
  points: readonly LatLon[];
  onAppend: (point: LatLon) => void;
  onUndoLast: () => void;
  onClear: () => void;
  onExit: () => void;
}

export function useMeasureTool(map: L.Map | null, options: Options): void {
  const { active, points } = options;
  const groupRef = useRef<L.LayerGroup | null>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    if (map === null || !active) return;

    const container = map.getContainer();
    const previousCursor = container.style.cursor;
    container.style.cursor = 'crosshair';

    const onClick = (event: L.LeafletMouseEvent): void => {
      optionsRef.current.onAppend({
        lat: event.latlng.lat,
        lon: event.latlng.lng,
      });
    };

    const onDoubleClick = (event: L.LeafletMouseEvent): void => {
      L.DomEvent.stop(event);
      optionsRef.current.onExit();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        optionsRef.current.onExit();
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        optionsRef.current.onUndoLast();
      } else if (event.key === 'Enter') {
        // Enter clears and keeps measuring, rather than finishing: there is
        // nothing to finish, so the useful gesture is "start a new line".
        event.preventDefault();
        optionsRef.current.onClear();
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
    if (!active || points.length === 0) return;

    const latlngs = points.map((p) => [p.lat, p.lon] as L.LatLngTuple);

    if (latlngs.length > 1) {
      L.polyline(latlngs, {
        // Teal and finely dotted: deliberately unlike the amber dashed draw
        // preview and unlike any route colour.
        color: '#0d9488',
        weight: 2,
        dashArray: '2 5',
        interactive: false,
      }).addTo(group);
    }

    for (const latlng of latlngs) {
      L.marker(latlng, {
        icon: pendingPointIcon(),
        interactive: false,
        zIndexOffset: 500,
      }).addTo(group);
    }
  }, [map, active, points]);
}
