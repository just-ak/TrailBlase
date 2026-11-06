import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import type { Track, TrackGeometry } from '@shared/domain/types';
import { api, callOr } from '../../lib/client';
import { endpointIcon } from './markers';

/**
 * Renders track polylines.
 *
 * Tracks are not routes, and the difference drives everything here:
 *
 * - **Geometry is fetched per track, not with the trip.** A recorded track can
 *   hold 200,000 points, so `geometry:forTrip` carries only metadata and this
 *   hook asks for the drawing geometry it actually needs.
 * - **The zoom decides the representation.** Below the cache threshold the
 *   main process returns the simplified render cache; above it, the real
 *   points. The response says which, so nothing has to guess.
 * - **Refetching is bucketed by zoom, not by zoom level.** Re-requesting
 *   200,000 points on every wheel click would make the map unusable, so a
 *   fetch only happens when the simplified/exact decision could change.
 * - **No per-vertex handles.** Materialising a draggable marker per point is
 *   what makes a large track freeze. Track editing is range-based (see
 *   `TrackProperties`), which is also what the data wants: you trim a
 *   recording, you do not nudge its samples.
 */

/** Must match `CACHE_ZOOM` in the main process track service. */
const CACHE_ZOOM = 12;

/** Which representation a zoom asks for. Only a change triggers a refetch. */
function zoomBucket(zoom: number): 'simplified' | 'exact' {
  return zoom < CACHE_ZOOM ? 'simplified' : 'exact';
}

const DEFAULT_COLOUR = '#b45309';
const DEFAULT_WIDTH = 3;

interface Handlers {
  onSelect: (trackId: string) => void;
  onContextMenu: (trackId: string, x: number, y: number) => void;
}

export function useTrackLayers(
  map: L.Map | null,
  tracks: readonly Track[],
  selectedId: string | null,
  handlers: Handlers,
  options: { showPoints: boolean } = { showPoints: false },
): void {
  const lineGroupRef = useRef<L.LayerGroup | null>(null);
  const markerGroupRef = useRef<L.LayerGroup | null>(null);
  const linesRef = useRef(new Map<string, L.Polyline>());

  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const [bucket, setBucket] = useState<'simplified' | 'exact'>('simplified');
  const [geometry, setGeometry] = useState<Map<string, TrackGeometry>>(
    () => new Map(),
  );

  /**
   * A stable key for "which tracks am I drawing".
   *
   * The fetch effect below cannot depend on the `tracks` array itself: callers
   * naturally write `geometry?.tracks ?? []`, which produces a fresh array on
   * every render. Depending on that identity makes the effect re-run, write
   * state, re-render, and re-run — a loop that pins the renderer at 100% and
   * leaves the window unable to process input at all. Depending on the ids
   * means the effect runs when the set of tracks actually changes.
   */
  const trackKey = useMemo(
    () => tracks.map((track) => track.id).join('\u0000'),
    [tracks],
  );

  // --- layer groups
  useEffect(() => {
    if (map === null) return;
    const lines = L.layerGroup().addTo(map);
    const markers = L.layerGroup().addTo(map);
    lineGroupRef.current = lines;
    markerGroupRef.current = markers;
    const index = linesRef.current;
    return () => {
      lines.clearLayers();
      lines.remove();
      markers.clearLayers();
      markers.remove();
      lineGroupRef.current = null;
      markerGroupRef.current = null;
      index.clear();
    };
  }, [map]);

  // --- follow the zoom, but only across the threshold
  useEffect(() => {
    if (map === null) return;

    const onZoom = (): void => {
      setBucket(zoomBucket(map.getZoom()));
    };

    // `whenReady` rather than reading the zoom here: Leaflet calls back once
    // the view exists, which also keeps this out of the synchronous effect
    // body. Setting state synchronously in an effect starts a second render
    // before the first has committed.
    map.whenReady(onZoom);

    map.on('zoomend', onZoom);
    return () => {
      map.off('zoomend', onZoom);
    };
  }, [map]);

  // --- fetch geometry for the current set of tracks and bucket
  useEffect(() => {
    const ids = trackKey.length === 0 ? [] : trackKey.split('\u0000');
    let cancelled = false;
    const zoom = map?.getZoom() ?? 0;

    void (async () => {
      const next = new Map<string, TrackGeometry>();
      // Yield before the first write so an empty track list does not set state
      // synchronously inside the effect body. Stale entries for removed tracks
      // are harmless in the meantime: the draw pass only reads the ids it is
      // rendering.
      await Promise.resolve();
      if (cancelled) return;

      for (const id of ids) {
        // Sequential: these are SQLite reads in the main process over one
        // connection, so firing them in parallel contends rather than helps.
        const result = await callOr(
          api().tracks.geometry({ id, zoom: Math.round(zoom) }),
          null,
        );
        if (cancelled) return;
        if (result !== null) next.set(id, result);
      }
      if (cancelled) return;
      setGeometry((current) =>
        // Returning the same reference when nothing changed is what keeps an
        // empty track list from re-rendering on a loop.
        current.size === 0 && next.size === 0 ? current : next,
      );
    })();

    return () => {
      cancelled = true;
    };
    // `bucket` is a dependency but not read in the body: it exists to trigger
    // a refetch when the simplified/exact decision changes, without refetching
    // on every wheel click. The raw zoom is read through `map` at call time.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [map, trackKey, bucket]);

  // --- polylines
  useEffect(() => {
    const group = lineGroupRef.current;
    if (map === null || group === null) return;

    const lines = linesRef.current;
    const seen = new Set<string>();

    for (const track of tracks) {
      const geom = geometry.get(track.id);
      if (geom === undefined) continue;

      const latlngs = geom.segments
        .filter((segment) => segment.points.length >= 2)
        .map((segment) =>
          segment.points.map((p) => [p.lat, p.lon] as L.LatLngTuple),
        );

      if (latlngs.length === 0) {
        const stale = lines.get(track.id);
        if (stale !== undefined) {
          stale.remove();
          lines.delete(track.id);
        }
        continue;
      }

      seen.add(track.id);
      const isSelected = track.id === selectedId;
      const width = track.width ?? DEFAULT_WIDTH;
      const style: L.PolylineOptions = {
        color: track.colour ?? DEFAULT_COLOUR,
        weight: isSelected ? width + 1.5 : width,
        opacity: isSelected ? 1 : 0.85,
        interactive: true,
        // Recorded tracks are dense; rounded joins stop the line looking
        // ragged where samples double back.
        lineJoin: 'round',
        lineCap: 'round',
      };

      const existing = lines.get(track.id);
      if (existing === undefined) {
        const line = L.polyline(latlngs, style);

        line.on('click', (event) => {
          L.DomEvent.stopPropagation(event);
          handlersRef.current.onSelect(track.id);
        });

        line.on('contextmenu', (event) => {
          L.DomEvent.stopPropagation(event);
          const original = event.originalEvent;
          original.preventDefault();
          handlersRef.current.onContextMenu(
            track.id,
            original.clientX,
            original.clientY,
          );
        });

        line.addTo(group);
        lines.set(track.id, line);
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
  }, [map, tracks, geometry, selectedId]);

  // --- start and finish markers, and optional point dots
  useEffect(() => {
    const group = markerGroupRef.current;
    if (map === null || group === null) return;

    group.clearLayers();

    for (const track of tracks) {
      const geom = geometry.get(track.id);
      if (geom === undefined) continue;

      const first = geom.segments[0]?.points[0];
      const lastSegment = geom.segments.at(-1);
      const last = lastSegment?.points.at(-1);

      if (first !== undefined) {
        L.marker([first.lat, first.lon], {
          icon: endpointIcon('start'),
          interactive: false,
          zIndexOffset: 150,
        }).addTo(group);
      }
      if (last !== undefined && last !== first) {
        L.marker([last.lat, last.lon], {
          icon: endpointIcon('end'),
          interactive: false,
          zIndexOffset: 150,
        }).addTo(group);
      }

      // Individual points are opt-in and only for the selected track. Drawing
      // a circle per point across every track is the straightforward way to
      // make a 200,000-point map unusable.
      if (!options.showPoints || track.id !== selectedId) continue;
      if (geom.simplified) continue;

      for (const segment of geom.segments) {
        for (const point of segment.points) {
          L.circleMarker([point.lat, point.lon], {
            radius: 2,
            color: track.colour ?? DEFAULT_COLOUR,
            fillOpacity: 1,
            interactive: false,
          }).addTo(group);
        }
      }
    }
  }, [map, tracks, geometry, selectedId, options.showPoints]);
}
