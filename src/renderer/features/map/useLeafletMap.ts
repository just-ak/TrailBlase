import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import type { MapPosition } from '@shared/domain/types';
import { getMapOverlay, resolveProvider } from '@shared/map/MapProvider';
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
  /** Template for a user-supplied base map. Empty for a registry provider. */
  customTileUrl: string;
  /** Overlay id, or empty for none. */
  overlayId: string;
  customOverlayUrl: string;
  initial: MapPosition;
  onPositionChange: (position: MapPosition) => void;
  onTileError: (failing: boolean) => void;
}

/** Live map readout for the scale bar and the cursor position display. */
export interface MapReadout {
  /** Pointer position in degrees, or null when the pointer is elsewhere. */
  cursor: { lat: number; lon: number } | null;
  /**
   * A round distance and the pixel width that represents it, so the bar can be
   * drawn with a label that is a whole number rather than "73.4 m".
   */
  scale: { metres: number; pixels: number } | null;
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
  /** Moves keyboard focus to the map so the arrow keys pan it. */
  focus: () => void;
}

/**
 * The hook's result.
 *
 * `handle` is kept as its own object, and stable for the lifetime of the
 * component, specifically so effects can depend on it. `readout` changes on
 * every pointer move; folding the two together would make any effect with
 * `[handle]` in its dependencies re-subscribe a few hundred times a second.
 */
export interface LeafletMap {
  handle: LeafletHandle;
  readout: MapReadout;
  /** False when the selected provider has no usable tile template. */
  providerUsable: boolean;
}

/**
 * Round numbers a scale bar is allowed to show.
 *
 * A bar labelled "500 m" that the user can measure against is useful; one
 * labelled "487 m" is just the width of the control. Metric and imperial share
 * the list because the bar is drawn in metres and the label is formatted by the
 * caller — picking a round metre value keeps the mental arithmetic honest in
 * either system.
 */
const SCALE_STEPS: readonly number[] = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000,
  100_000, 200_000, 500_000, 1_000_000, 2_000_000, 5_000_000,
];

/** Widest bar in pixels. The chosen step is the largest that fits. */
const MAX_SCALE_PIXELS = 110;

function computeScale(map: L.Map): MapReadout['scale'] {
  const size = map.getSize();
  if (size.x < 2 || size.y < 2) return null;

  /*
   * Metres per pixel is measured from the map itself rather than computed from
   * the Web Mercator formula.
   *
   * `map.distance` between two points on the same screen row gives the real
   * ground distance at the current latitude, which is what a scale bar has to
   * represent. The textbook `156543 * cos(lat) / 2^zoom` is the same number
   * only at the centre row and drifts noticeably at high latitudes.
   */
  const y = Math.round(size.y / 2);
  const left = map.containerPointToLatLng(L.point(0, y));
  const right = map.containerPointToLatLng(L.point(size.x, y));
  const metresAcross = map.distance(left, right);
  if (!Number.isFinite(metresAcross) || metresAcross <= 0) return null;

  const metresPerPixel = metresAcross / size.x;

  let chosen = SCALE_STEPS[0] ?? 1;
  for (const step of SCALE_STEPS) {
    if (step / metresPerPixel > MAX_SCALE_PIXELS) break;
    chosen = step;
  }

  return { metres: chosen, pixels: chosen / metresPerPixel };
}

export function useLeafletMap(options: Options): LeafletMap {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const overlayLayerRef = useRef<L.TileLayer | null>(null);

  const [readout, setReadout] = useState<MapReadout>({
    cursor: null,
    scale: null,
  });

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
      /*
       * Keyboard panning and zooming, Requirement 4.4.
       *
       * Leaflet's handler is on by default but the step is 80 px, which is a
       * sixth of a pane and takes a lot of presses to cross a map. 160 px is
       * about a quarter of the viewport per press — enough to navigate with,
       * small enough to stay oriented.
       */
      keyboard: true,
      keyboardPanDelta: 160,
    });

    mapRef.current = map;
    // Publish to the external store so layer hooks can attach in their effects.
    setMapInstance(map);

    /*
     * Make the map a real keyboard stop and announce it.
     *
     * Leaflet's keyboard handler sets `tabIndex` itself, but it adds no
     * accessible name, so a screen reader reaches an unlabelled group and a
     * sighted keyboard user gets no focus ring. Both are set here.
     */
    container.tabIndex = 0;
    container.setAttribute('role', 'application');
    container.setAttribute(
      'aria-label',
      'Map. Use the arrow keys to pan, plus and minus to zoom.',
    );

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

    const refreshScale = (): void => {
      setReadout((current) => ({ ...current, scale: computeScale(map) }));
    };
    map.on('move', refreshScale);
    map.on('zoom', refreshScale);
    map.on('resize', refreshScale);
    refreshScale();

    const onMouseMove = (event: L.LeafletMouseEvent): void => {
      setReadout((current) => ({
        ...current,
        cursor: { lat: event.latlng.lat, lon: event.latlng.lng },
      }));
    };
    const onMouseOut = (): void => {
      setReadout((current) => ({ ...current, cursor: null }));
    };
    map.on('mousemove', onMouseMove);
    map.on('mouseout', onMouseOut);

    // Keep Leaflet's own size in step with the pane, which flex resizes without
    // any window resize event.
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
      refreshScale();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      setMapInstance(null);
      map.off();
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      overlayLayerRef.current = null;
    };
    // Intentionally mount-only. Centre and zoom are initial values; later
    // changes come through flyTo rather than a map rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolved = useMemo(
    () => resolveProvider(options.providerId, options.customTileUrl),
    [options.providerId, options.customTileUrl],
  );

  // Tile layer follows the configured provider. Swapping providers replaces the
  // layer; it never recreates the map.
  useEffect(() => {
    const map = mapRef.current;
    if (map === null) return;

    tileLayerRef.current?.remove();
    tileLayerRef.current = null;

    /*
     * An unusable provider gets no layer at all.
     *
     * A custom source with no template would otherwise have Leaflet request
     * the literal string `{z}/{x}/{y}`. Falling back to OpenStreetMap would be
     * worse still: the user would be shown a different map from the one they
     * selected and have no way to tell. The UI reports the gap instead —
     * Requirement 1.4.
     */
    if (!resolved.usable) return;

    const { provider } = resolved;
    const layer = L.tileLayer(resolved.tileUrlTemplate, {
      attribution: provider.attribution,
      minZoom: provider.minZoom,
      // OpenTopoMap stops at 17. Requesting 18 would paint blank tiles, so the
      // registry's value is honoured rather than assumed to be OSM's 19.
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
  }, [resolved]);

  // Overlay, chosen independently of the base map (Requirement 1.6).
  useEffect(() => {
    const map = mapRef.current;
    if (map === null) return;

    overlayLayerRef.current?.remove();
    overlayLayerRef.current = null;

    const overlay = getMapOverlay(options.overlayId);
    if (overlay === null) return;

    const template =
      overlay.userSupplied === true
        ? options.customOverlayUrl.trim()
        : overlay.tileUrlTemplate;
    if (template.length === 0) return;

    const layer = L.tileLayer(template, {
      attribution: overlay.attribution,
      maxZoom: overlay.maxZoom,
      opacity: overlay.opacity,
      // Above the base tiles, below every vector layer and marker. Leaflet's
      // default pane would put it level with the base map and the order would
      // depend on insertion.
      pane: 'overlayPane',
    });

    layer.addTo(map);
    overlayLayerRef.current = layer;

    return () => {
      layer.off();
      layer.remove();
    };
  }, [options.overlayId, options.customOverlayUrl]);

  // Stable across renders, so effects that depend on the handle do not re-run.
  const handle = useMemo<LeafletHandle>(
    () => ({
      containerRef,
      zoomIn: () => mapRef.current?.zoomIn(),
      zoomOut: () => mapRef.current?.zoomOut(),
      focus: () => mapRef.current?.getContainer().focus(),
    }),
    [],
  );

  return { handle, readout, providerUsable: resolved.usable };
}
