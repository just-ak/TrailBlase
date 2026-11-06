import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { Waypoint } from '@shared/domain/types';
import { waypointIcon } from './markers';

/**
 * Renders waypoint markers.
 *
 * Markers are keyed by id and updated in place rather than torn down and
 * rebuilt on every store change. A full rebuild would cancel an in-progress
 * drag and make the map flicker on unrelated updates.
 *
 * Dragging commits on `dragend` only, so one gesture produces one undo entry
 * rather than one per mouse-move.
 */

interface Handlers {
  onSelect: (id: string) => void;
  onMoved: (id: string, lat: number, lon: number) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
}

export function useWaypointLayers(
  map: L.Map | null,
  waypoints: readonly Waypoint[],
  selectedId: string | null,
  handlers: Handlers,
): void {
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef(new Map<string, L.Marker>());
  /**
   * Ids currently mid-drag. A store update that arrives during a drag must not
   * reposition the marker under the user's pointer.
   */
  const draggingRef = useRef(new Set<string>());

  // Latest handlers without re-running the sync effect on every render.
  const handlersRef = useRef(handlers);
  // Assigned in an effect rather than during render: writing to a ref while
  // rendering is a side effect, and React may render without committing.
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (map === null) return;
    const group = L.layerGroup().addTo(map);
    layerRef.current = group;
    const markers = markersRef.current;
    return () => {
      group.clearLayers();
      group.remove();
      layerRef.current = null;
      markers.clear();
    };
  }, [map]);

  useEffect(() => {
    const group = layerRef.current;
    if (map === null || group === null) return;

    const markers = markersRef.current;
    const seen = new Set<string>();

    for (const waypoint of waypoints) {
      seen.add(waypoint.id);
      const isSelected = waypoint.id === selectedId;
      const existing = markers.get(waypoint.id);

      if (existing === undefined) {
        const marker = L.marker([waypoint.lat, waypoint.lon], {
          icon: waypointIcon(waypoint.symbol, isSelected),
          draggable: true,
          autoPan: true,
          // Keep waypoints above route lines so they stay clickable.
          zIndexOffset: 400,
          title: waypoint.name,
        });

        marker.on('click', () => handlersRef.current.onSelect(waypoint.id));
        marker.on('dragstart', () => {
          draggingRef.current.add(waypoint.id);
          handlersRef.current.onSelect(waypoint.id);
        });
        marker.on('dragend', (event) => {
          draggingRef.current.delete(waypoint.id);
          const { lat, lng } = (event.target as L.Marker).getLatLng();
          // Committing on dragend only means one undo entry per gesture
          // rather than one per mouse-move.
          handlersRef.current.onMoved(waypoint.id, lat, lng);
        });
        marker.on('contextmenu', (event) => {
          const original = event.originalEvent;
          original.preventDefault();
          handlersRef.current.onContextMenu(
            waypoint.id,
            original.clientX,
            original.clientY,
          );
        });

        marker.addTo(group);
        markers.set(waypoint.id, marker);
        continue;
      }

      // Update in place, skipping a marker that is mid-drag.
      if (!draggingRef.current.has(waypoint.id)) {
        const current = existing.getLatLng();
        if (current.lat !== waypoint.lat || current.lng !== waypoint.lon) {
          existing.setLatLng([waypoint.lat, waypoint.lon]);
        }
      }
      existing.setIcon(waypointIcon(waypoint.symbol, isSelected));
      existing.options.title = waypoint.name;
    }

    for (const [id, marker] of markers) {
      if (seen.has(id)) continue;
      marker.remove();
      markers.delete(id);
      draggingRef.current.delete(id);
    }
  }, [map, waypoints, selectedId]);
}
