import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { RoutePoint } from '@shared/domain/types';
import { pendingPointIcon } from './markers';

/**
 * Click-to-draw interaction and its preview layer.
 *
 * The map click handler is attached and detached by this effect, so leaving
 * draw mode genuinely stops appending points. Leaving a handler bound and
 * guarding inside it is how phantom points appear after finishing.
 *
 * Segments are drawn as straight dashed lines. Dashed is deliberate: it signals
 * that nothing has been snapped to a road, which no provider does until Phase 4
 * (Requirement 1.5).
 */

interface Options {
  active: boolean;
  pending: readonly RoutePoint[];
  onAppend: (lat: number, lon: number) => void;
  onFinish: () => void;
  onCancel: () => void;
  onUndoLast: () => void;
}

export function useDrawMode(map: L.Map | null, options: Options): void {
  const { active, pending } = options;
  const groupRef = useRef<L.LayerGroup | null>(null);
  const optionsRef = useRef(options);
  // Assigned in an effect rather than during render: writing to a ref while
  // rendering is a side effect, and React may render without committing.
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // --- click, double-click and keyboard handling
  useEffect(() => {
    if (map === null || !active) return;

    const container = map.getContainer();
    const previousCursor = container.style.cursor;
    container.style.cursor = 'crosshair';

    const onClick = (event: L.LeafletMouseEvent): void => {
      optionsRef.current.onAppend(event.latlng.lat, event.latlng.lng);
    };

    const onDoubleClick = (event: L.LeafletMouseEvent): void => {
      // Suppress Leaflet's own zoom-on-double-click while drawing.
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
    // `map` is in the dependencies and checked here on purpose: the group is
    // recreated when the map is, and the preview has to be redrawn onto the
    // new one.
    if (map === null || group === null) return;

    group.clearLayers();
    if (!active || pending.length === 0) return;

    const latlngs = pending.map((p) => [p.lat, p.lon] as L.LatLngTuple);

    if (latlngs.length > 1) {
      L.polyline(latlngs, {
        color: '#f59e0b',
        weight: 4,
        // Dashed: these are straight lines, not road-snapped geometry.
        dashArray: '8 6',
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
  }, [map, active, pending]);
}
