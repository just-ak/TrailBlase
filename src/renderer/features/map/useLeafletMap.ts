import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import type { MapPosition } from '@shared/domain/types';
import { getMapProvider } from '@shared/map/MapProvider';
import { setMapInstance } from './mapInstance';

/**
 * Owns the Leaflet map instance.
 *
 * There is no react-leaflet: it is Hippocratic-2.1 licensed and incompatible
 * with this project's GPL-3.0 licence (ADR 0008). Leaflet itself is
 * BSD-2-Clause and driven directly here.
 *
 * Three things this has to get right, each of which is a common bug:
 *
 * 1. **One instance, ever.** React 19 strict mode double-invokes effects in
 *    development. Without the guard below you get two maps stacked in one
 *    container and duplicated tile requests.
 * 2. **Resize via ResizeObserver, not window resize.** The map is in a flex
 *    pane whose width changes when a divider is dragged or a panel toggled —
 *    neither fires a window resize, and Leaflet renders grey gutters until
 *    `invalidateSize()` is called. Requirement 3.4.
 * 3. **No prefetching.** Leaflet's defaults fetch only visible tiles, which is
 *    what the OpenStreetMap usage policy requires. Nothing here adds
 *    `keepBuffer` growth or bulk loading. Requirement 8.5.
 */

interface Options {
  providerId: string;
  initial: MapPosition;
  onPositionChange: (position: MapPosition) => void;
  onTileError: (failing: boolean) => void;
}

/**
 * Callbacks only, plus the container ref.
 *
 * The Leaflet instance itself is deliberately not exposed: reading it during
 * render would be reading a ref during render, which React forbids because the
 * value is not part of the render output. Anything that needs the map operates
 * through these methods, which run in effects and event handlers.
 */
export interface LeafletHandle {
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoomIn: () => void;
  zoomOut: () => void;
}

export function useLeafletMap(options: Options): LeafletHandle {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);

  // Latest callbacks without re-running the init effect.
  const callbacks = useRef(options);
  callbacks.current = options;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    // The strict-mode guard: a second invocation must not build a second map.
    if (mapRef.current !== null) return;

    const map = L.map(container, {
      center: [options.initial.lat, options.initial.lon],
      zoom: options.initial.zoom,
      // Our own controls are rendered in React so they can be themed.
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
    });

    mapRef.current = map;
    // Publish to the external store so layer hooks can attach in their effects.
    setMapInstance(map);

    const persist = (): void => {
      const centre = map.getCenter();
      callbacks.current.onPositionChange({
        lat: centre.lat,
        lon: centre.lng,
        zoom: map.getZoom(),
      });
    };
    map.on('moveend', persist);
    map.on('zoomend', persist);

    // Keep Leaflet's own size in step with the pane, which flex resizes without
    // any window resize event.
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      setMapInstance(null);
      map.off();
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
    };
    // Intentionally mount-only. Centre and zoom are initial values; later
    // changes come through flyTo rather than a map rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tile layer follows the configured provider. Swapping providers replaces the
  // layer; it never recreates the map.
  useEffect(() => {
    const map = mapRef.current;
    if (map === null) return;

    const provider = getMapProvider(options.providerId);

    tileLayerRef.current?.remove();

    const layer = L.tileLayer(provider.tileUrlTemplate, {
      attribution: provider.attribution,
      minZoom: provider.minZoom,
      maxZoom: provider.maxZoom,
      ...(provider.subdomains === undefined
        ? {}
        : { subdomains: [...provider.subdomains] }),
    });

    let failures = 0;
    layer.on('tileerror', () => {
      failures += 1;
      // One failed tile is noise; a run of them means we are offline or
      // blocked, and the UI should say so without blocking interaction.
      if (failures >= 4) callbacks.current.onTileError(true);
    });
    layer.on('tileload', () => {
      failures = 0;
      callbacks.current.onTileError(false);
    });

    layer.addTo(map);
    tileLayerRef.current = layer;

    return () => {
      layer.off();
      layer.remove();
    };
  }, [options.providerId]);

  // Stable across renders, so effects that depend on the handle do not re-run.
  return useMemo<LeafletHandle>(
    () => ({
      containerRef,
      zoomIn: () => mapRef.current?.zoomIn(),
      zoomOut: () => mapRef.current?.zoomOut(),
    }),
    [],
  );
}
