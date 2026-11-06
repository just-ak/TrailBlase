import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { RouteWithPoints } from '@shared/domain/types';
import { routeColour } from '@shared/domain/symbols';
import { closestSegment } from '@shared/geo/routeEdit';
import { endpointIcon, vertexIcon } from './markers';

/**
 * Renders route polylines, and editing handles for the selected route.
 *
 * Handles are materialised for the **selected route only**. Showing a draggable
 * vertex for every point of every route in a trip would be visually unreadable
 * and the obvious source of a sluggish map.
 *
 * Two layer groups are used so the lines and the handles can be rebuilt
 * independently: selecting a route must not tear down and re-add every
 * polyline.
 */

interface Handlers {
  onSelect: (routeId: string) => void;
  /** Vertex drag finished. */
  onVertexMoved: (routeId: string, index: number, lat: number, lon: number) => void;
  /** Alt-click on a vertex. */
  onVertexDelete: (routeId: string, index: number) => void;
  /** Click on a segment: insert a point at the projected position. */
  onSegmentClick: (
    routeId: string,
    insertIndex: number,
    lat: number,
    lon: number,
  ) => void;
  onContextMenu: (routeId: string, x: number, y: number) => void;
}

export function useRouteLayers(
  map: L.Map | null,
  routes: readonly RouteWithPoints[],
  selectedId: string | null,
  handlers: Handlers,
  enabled: boolean,
): void {
  const lineGroupRef = useRef<L.LayerGroup | null>(null);
  const handleGroupRef = useRef<L.LayerGroup | null>(null);
  const linesRef = useRef(new Map<string, L.Polyline>());

  const handlersRef = useRef(handlers);
  // A polyline's click handler is created once per route but needs the *current*
  // selection to decide between "select me" and "insert a point", so it reads
  // the selection from a ref rather than a captured value.
  const selectedIdRef = useRef(selectedId);
  // Assigned in an effect rather than during render: writing to a ref while
  // rendering is a side effect, and React may render without committing.
  useEffect(() => {
    handlersRef.current = handlers;
    selectedIdRef.current = selectedId;
  }, [handlers, selectedId]);

  useEffect(() => {
    if (map === null) return;
    const lines = L.layerGroup().addTo(map);
    const handleLayer = L.layerGroup().addTo(map);
    lineGroupRef.current = lines;
    handleGroupRef.current = handleLayer;
    const lineIndex = linesRef.current;
    return () => {
      lines.clearLayers();
      lines.remove();
      handleLayer.clearLayers();
      handleLayer.remove();
      lineGroupRef.current = null;
      handleGroupRef.current = null;
      lineIndex.clear();
    };
  }, [map]);

  // --- polylines, one per route, updated in place
  useEffect(() => {
    const group = lineGroupRef.current;
    if (map === null || group === null) return;

    const lines = linesRef.current;
    const seen = new Set<string>();

    for (const route of routes) {
      if (route.points.length < 2) {
        // A single point has no line to draw. Drop any stale polyline so a
        // route edited down to one point does not keep a ghost segment.
        const stale = lines.get(route.id);
        if (stale !== undefined) {
          stale.remove();
          lines.delete(route.id);
        }
        continue;
      }

      seen.add(route.id);
      const latlngs = route.points.map(
        (p) => [p.lat, p.lon] as L.LatLngTuple,
      );
      const isSelected = route.id === selectedId;
      const style: L.PolylineOptions = {
        color: routeColour(route.colour),
        weight: isSelected ? 5 : 3.5,
        opacity: isSelected ? 1 : 0.8,
        interactive: true,
      };

      const existing = lines.get(route.id);
      if (existing === undefined) {
        const line = L.polyline(latlngs, style);

        line.on('click', (event) => {
          L.DomEvent.stopPropagation(event);
          if (selectedIdRef.current === route.id) {
            // Already selected: a click on the line means "insert a point here".
            const hit = closestSegment(route.points, {
              lat: event.latlng.lat,
              lon: event.latlng.lng,
            });
            if (hit !== null) {
              handlersRef.current.onSegmentClick(
                route.id,
                hit.insertIndex,
                hit.lat,
                hit.lon,
              );
            }
            return;
          }
          handlersRef.current.onSelect(route.id);
        });

        line.on('contextmenu', (event) => {
          L.DomEvent.stopPropagation(event);
          const original = event.originalEvent;
          original.preventDefault();
          handlersRef.current.onContextMenu(
            route.id,
            original.clientX,
            original.clientY,
          );
        });

        line.addTo(group);
        lines.set(route.id, line);
        continue;
      }

      existing.setLatLngs(latlngs);
      existing.setStyle(style);
    }

    for (const [id, line] of lines) {
      if (seen.has(id)) continue;
      line.remove();
      lines.delete(id);
    }
  }, [map, routes, selectedId]);

  // --- editing handles for the selected route only
  useEffect(() => {
    const group = handleGroupRef.current;
    if (map === null || group === null) return;

    group.clearLayers();
    if (!enabled) return;

    const route = routes.find((r) => r.id === selectedId);
    if (route === undefined) return;

    for (const [index, point] of route.points.entries()) {
      const isFirst = index === 0;
      const isLast = index === route.points.length - 1;

      // Start and finish get a labelled badge; the rest get a plain handle.
      if (isFirst || isLast) {
        L.marker([point.lat, point.lon], {
          icon: endpointIcon(isFirst ? 'start' : 'end'),
          interactive: false,
          zIndexOffset: 200,
        }).addTo(group);
      }

      const handle = L.marker([point.lat, point.lon], {
        icon: vertexIcon(isFirst || isLast),
        draggable: true,
        zIndexOffset: 300,
        title: `Point ${index + 1} of ${route.points.length}`,
      });

      handle.on('dragend', (event) => {
        const { lat, lng } = (event.target as L.Marker).getLatLng();
        handlersRef.current.onVertexMoved(route.id, index, lat, lng);
      });

      handle.on('click', (event) => {
        L.DomEvent.stopPropagation(event);
        // Alt-click deletes. A plain click would be ambiguous with starting a
        // drag, so the modifier makes the destructive action deliberate.
        if (event.originalEvent.altKey) {
          handlersRef.current.onVertexDelete(route.id, index);
        }
      });

      handle.addTo(group);
    }
  }, [map, routes, selectedId, enabled]);
}
