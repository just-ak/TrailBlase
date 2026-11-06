import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import L from "leaflet";
import { MAP_PROVIDERS } from "@shared/map/MapProvider";
import type { Bounds, MapPosition } from "@shared/domain/types";
import { formatDistance } from "@shared/geo/units";
import { pathDistance } from "@shared/geo/distance";
import { ContextMenu, type MenuItem } from "../../components/ContextMenu";
import { api, callOr } from "../../lib/client";
import * as actions from "../../lib/actions";
import { useEditorStore } from "../../stores/editorStore";
import { useGeometryStore } from "../../stores/geometryStore";
import { useSelectionStore } from "../../stores/selectionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";
import { getMapInstance, useMapInstance } from "./mapInstance";
import { useDrawMode } from "./useDrawMode";
import { useLeafletMap } from "./useLeafletMap";
import { useRouteLayers } from "./useRouteLayers";
import { useWaypointLayers } from "./useWaypointLayers";

/**
 * The centre workspace: base map plus the selected trip's routes and waypoints.
 *
 * Layer rendering is delegated to hooks that attach to the single Leaflet
 * instance. This component wires them to the stores and owns the overlay UI.
 */

function fitTo(bounds: Bounds | null): boolean {
  const map = getMapInstance();
  if (map === null || bounds === null) return false;
  map.fitBounds(
    L.latLngBounds(
      [bounds.minLat, bounds.minLon],
      [bounds.maxLat, bounds.maxLon],
    ),
    // A degenerate box — one waypoint — would otherwise zoom to maximum.
    { padding: [56, 56], maxZoom: 16 },
  );
  return true;
}

export function MapView(): ReactNode {
  const settings = useSettingsStore((s) => s.settings);
  const loaded = useSettingsStore((s) => s.loaded);
  const offline = useUiStore((s) => s.mapOffline);
  const setOffline = useUiStore((s) => s.setMapOffline);
  const showToast = useUiStore((s) => s.showToast);

  const geometry = useGeometryStore((s) => s.geometry);
  const selected = useSelectionStore((s) => s.selected);
  const select = useSelectionStore((s) => s.select);

  const mode = useEditorStore((s) => s.mode);
  const pending = useEditorStore((s) => s.pending);

  const [layerMenuOpen, setLayerMenuOpen] = useState(false);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    items: MenuItem[];
  } | null>(null);

  // Frozen on first render; later re-centring goes through fitBounds.
  const [initialPosition] = useState<MapPosition>(() => settings.mapPosition);

  const persistTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onPositionChange = useCallback((position: MapPosition) => {
    clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      void callOr(
        api().settings.set({
          key: "mapPosition",
          value: {
            lat: Number(position.lat.toFixed(6)),
            lon: Number(position.lon.toFixed(6)),
            zoom: Math.round(position.zoom),
          },
        }),
        null,
      );
    }, 600);
  }, []);

  const handle = useLeafletMap({
    providerId: settings.mapProviderId,
    initial: initialPosition,
    onPositionChange,
    onTileError: setOffline,
  });

  const map = useMapInstance();

  // --- object layers
  useRouteLayers(
    map,
    geometry?.routes ?? [],
    selected?.kind === "route" ? selected.id : null,
    {
      onSelect: (id) => void select({ kind: "route", id }),
      onVertexMoved: (id, index, lat, lon) =>
        void actions.moveRouteVertex(id, index, lat, lon),
      onVertexDelete: (id, index) => void actions.deleteRouteVertex(id, index),
      onSegmentClick: (id, index, lat, lon) =>
        void actions.insertRouteVertex(id, index, lat, lon),
      onContextMenu: (id, x, y) => {
        void select({ kind: "route", id });
        setMenu({
          x,
          y,
          items: [
            { label: "Fit Route to Screen", onSelect: () => fitRoute(id) },
            {
              label: "Reverse Route",
              separatorBefore: true,
              onSelect: () => void actions.reverseRoute(id),
            },
            {
              label: "Duplicate Route",
              onSelect: () => void actions.duplicateRoute(id),
            },
            {
              label: "Delete Route",
              danger: true,
              separatorBefore: true,
              onSelect: () => void actions.deleteRoute(id),
            },
          ],
        });
      },
    },
    // Handles appear only when not drawing, so a draw click is never eaten by
    // a vertex that happens to be underneath.
    mode === "idle",
  );

  useWaypointLayers(
    map,
    geometry?.waypoints ?? [],
    selected?.kind === "waypoint" ? selected.id : null,
    {
      onSelect: (id) => void select({ kind: "waypoint", id }),
      onMoved: (id, lat, lon) => void actions.moveWaypoint(id, lat, lon),
      onContextMenu: (id, x, y) => {
        void select({ kind: "waypoint", id });
        setMenu({
          x,
          y,
          items: [
            {
              label: "Duplicate Waypoint",
              onSelect: () => void actions.duplicateWaypoint(id),
            },
            {
              label: "Delete Waypoint",
              danger: true,
              separatorBefore: true,
              onSelect: () => void actions.deleteWaypoint(id),
            },
          ],
        });
      },
    },
  );

  // --- draw mode
  useDrawMode(map, {
    active: mode === "drawRoute",
    pending,
    onAppend: (lat, lon) =>
      useEditorStore.getState().appendPending({
        lat,
        lon,
        ele: null,
        name: null,
        symbol: null,
        notes: null,
      }),
    onFinish: () => {
      const tripId = useEditorStore.getState().targetTripId;
      const points = useEditorStore.getState().finish();
      if (tripId !== null && points.length > 0) {
        void actions.createRouteFromPoints(tripId, points);
      }
    },
    onCancel: () => {
      useEditorStore.getState().cancel();
      showToast("Route drawing cancelled — nothing was saved.");
    },
    onUndoLast: () => useEditorStore.getState().undoLastPending(),
  });

  /**
   * During a placement or drawing mode, object layers stop receiving pointer
   * events so every click reaches the map. Toggling a class is used rather than
   * recreating layers with `interactive: false`, because Leaflet cannot change
   * that flag after construction.
   */
  useEffect(() => {
    if (map === null) return;
    const container = map.getContainer();
    const capturing = mode !== "idle";
    container.classList.toggle("trailrt-map-capture", capturing);
    return () => {
      container.classList.remove("trailrt-map-capture");
    };
  }, [map, mode]);

  // --- waypoint placement: a single click, then back to idle
  useEffect(() => {
    if (map === null || mode !== "placeWaypoint") return;

    const container = map.getContainer();
    const previousCursor = container.style.cursor;
    container.style.cursor = "crosshair";

    const onClick = (event: L.LeafletMouseEvent): void => {
      const tripId = useEditorStore.getState().targetTripId;
      useEditorStore.getState().cancel();
      if (tripId !== null) {
        void actions.createWaypoint(tripId, event.latlng.lat, event.latlng.lng);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") useEditorStore.getState().cancel();
    };

    map.on("click", onClick);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      map.off("click", onClick);
      window.removeEventListener("keydown", onKeyDown);
      container.style.cursor = previousCursor;
    };
  }, [map, mode]);

  const fitRoute = useCallback(
    (routeId: string) => {
      const route = useGeometryStore.getState().findRoute(routeId);
      if (route === null || route.points.length === 0) {
        showToast("That route has no points to fit.", "error");
        return;
      }
      const lats = route.points.map((p) => p.lat);
      const lons = route.points.map((p) => p.lon);
      fitTo({
        minLat: Math.min(...lats),
        maxLat: Math.max(...lats),
        minLon: Math.min(...lons),
        maxLon: Math.max(...lons),
      });
    },
    [showToast],
  );

  // --- menu actions
  useEffect(() => {
    return api().events.onMenuAction((action) => {
      switch (action) {
        case "map:zoomIn":
          handle.zoomIn();
          break;
        case "map:zoomOut":
          handle.zoomOut();
          break;
        case "map:layers":
          setLayerMenuOpen((open) => !open);
          break;
        case "map:fitTrip": {
          const bounds = useGeometryStore.getState().geometry?.bounds ?? null;
          if (!fitTo(bounds)) {
            showToast(
              "Nothing to fit — this trip has no routes or waypoints yet.",
            );
          }
          break;
        }
        case "map:fitRoute": {
          const ref = useSelectionStore.getState().selected;
          if (ref?.kind === "route") fitRoute(ref.id);
          else showToast("Select a route first.");
          break;
        }
        case "map:returnToSelection": {
          const state = useSelectionStore.getState();
          if (state.route !== null) fitRoute(state.route.id);
          else if (state.waypoint !== null) {
            getMapInstance()?.panTo([state.waypoint.lat, state.waypoint.lon]);
          } else {
            const bounds = useGeometryStore.getState().geometry?.bounds ?? null;
            if (!fitTo(bounds)) showToast("Nothing selected to return to.");
          }
          break;
        }
        case "route:new":
          actions.startDrawingRoute();
          break;
        case "waypoint:new":
          actions.startPlacingWaypoint();
          break;
        default:
          break;
      }
    });
  }, [handle, fitRoute, showToast]);

  const setProvider = async (id: string): Promise<void> => {
    await useSettingsStore.getState().set({ key: "mapProviderId", value: id });
    setLayerMenuOpen(false);
  };

  if (!loaded) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[var(--color-surface-sunken)] text-[var(--color-text-muted)]">
        Loading map…
      </div>
    );
  }

  // Derived from the subscribed value, so it re-renders with it rather than
  // reading store state during render.
  const pendingDistance = pending.length < 2 ? null : pathDistance(pending);

  return (
    <div className="relative flex-1 overflow-hidden">
      {/* oxlint-disable-next-line react/refs */}
      <div ref={handle.containerRef} className="absolute inset-0" />

      {/* Mode hint bar. Also the place that states no road-snapping happens. */}
      {mode !== "idle" && (
        <div className="pointer-events-none absolute top-3 left-1/2 z-[600] -translate-x-1/2 rounded-md bg-[var(--color-text-primary)] px-3 py-2 text-[12px] text-[var(--color-surface)] shadow-lg">
          {mode === "drawRoute" ? (
            <span>
              Click to add points · <strong>Enter</strong> or double-click to
              finish · <strong>Backspace</strong> removes the last ·{" "}
              <strong>Esc</strong> cancels
              {pending.length > 0 && (
                <>
                  {" · "}
                  {pending.length} point{pending.length === 1 ? "" : "s"}
                  {pendingDistance !== null && (
                    <> · {formatDistance(pendingDistance, settings.units)}</>
                  )}
                </>
              )}
              <span className="ml-2 opacity-70">
                Straight lines — not snapped to paths
              </span>
            </span>
          ) : (
            <span>
              Click the map to place a waypoint · <strong>Esc</strong> cancels
            </span>
          )}
        </div>
      )}

      <div className="absolute top-3 right-3 z-[500] flex flex-col gap-1.5">
        <div className="flex flex-col overflow-hidden rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] shadow-md">
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => handle.zoomIn()}
            className="h-8 w-8 text-[16px] leading-none text-[var(--color-text-primary)] hover:bg-[var(--color-surface-sunken)]"
          >
            +
          </button>
          <div className="h-px bg-[var(--color-border-subtle)]" />
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => handle.zoomOut()}
            className="h-8 w-8 text-[16px] leading-none text-[var(--color-text-primary)] hover:bg-[var(--color-surface-sunken)]"
          >
            −
          </button>
        </div>

        <button
          type="button"
          aria-label="Fit trip to screen"
          title="Fit trip to screen"
          onClick={() => {
            const bounds = useGeometryStore.getState().geometry?.bounds ?? null;
            if (!fitTo(bounds)) {
              showToast("Nothing to fit — no routes or waypoints yet.");
            }
          }}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] text-[13px] shadow-md hover:bg-[var(--color-surface-sunken)]"
        >
          ⤢
        </button>

        <div className="relative">
          <button
            type="button"
            aria-label="Map layers"
            aria-expanded={layerMenuOpen}
            onClick={() => setLayerMenuOpen((open) => !open)}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] shadow-md hover:bg-[var(--color-surface-sunken)]"
          >
            <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true">
              <path
                d="M10 2 2 6l8 4 8-4-8-4Zm0 7.5L2 13l8 4 8-4-8-3.5Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {layerMenuOpen && (
            <div className="absolute top-0 right-9 w-56 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] py-1 shadow-xl">
              <p className="px-3 py-1 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
                Base map
              </p>
              {MAP_PROVIDERS.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => void setProvider(provider.id)}
                  className={`block w-full px-3 py-1.5 text-left text-[13px] hover:bg-[var(--color-surface-sunken)] ${
                    provider.id === settings.mapProviderId
                      ? "font-semibold text-[var(--color-accent)]"
                      : "text-[var(--color-text-primary)]"
                  }`}
                >
                  {provider.name}
                </button>
              ))}
              <div className="my-1 h-px bg-[var(--color-border-subtle)]" />
              <p className="px-3 py-1 text-[11px] leading-snug text-[var(--color-text-muted)]">
                Terrain and offline sources arrive in a later phase. Tiles are
                never bulk-downloaded.
              </p>
            </div>
          )}
        </div>
      </div>

      {selected?.kind === "route" && mode === "idle" && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-[500] -translate-x-1/2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] text-[var(--color-text-secondary)] shadow-md">
          Drag a handle to move a point · click the line to insert · Alt-click a
          handle to delete
        </div>
      )}

      {offline && (
        <div
          role="status"
          className="absolute bottom-3 left-3 z-[500] rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] shadow-md"
        >
          Map tiles unavailable — your trips are still fully editable offline.
        </div>
      )}

      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
