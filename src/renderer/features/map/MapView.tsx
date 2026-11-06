import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { MAP_PROVIDERS } from '@shared/map/MapProvider';
import type { MapPosition } from '@shared/domain/types';
import { api, callOr } from '../../lib/client';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';
import { useLeafletMap } from './useLeafletMap';

/**
 * The centre workspace.
 *
 * Phase 1 renders the base map only; routes, tracks and waypoints arrive in
 * Phases 2 and 3 as additional layer effects on the same instance.
 */
export function MapView(): ReactNode {
  const settings = useSettingsStore((s) => s.settings);
  const loaded = useSettingsStore((s) => s.loaded);
  const offline = useUiStore((s) => s.mapOffline);
  const setOffline = useUiStore((s) => s.setMapOffline);
  const [layerMenuOpen, setLayerMenuOpen] = useState(false);

  // Captured once: the hook treats these as initial values, and re-centring
  // later goes through flyTo rather than rebuilding the map.
  const initial = useRef<MapPosition>(settings.mapPosition);

  const persistTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onPositionChange = useCallback((position: MapPosition) => {
    // Pan and zoom fire continuously; each write is a transaction.
    clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      void callOr(
        api().settings.set({
          key: 'mapPosition',
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

  const map = useLeafletMap({
    providerId: settings.mapProviderId,
    initial: initial.current,
    onPositionChange,
    onTileError: setOffline,
  });

  // Menu actions for zoom and layers are dispatched from the native menu.
  useEffect(() => {
    return api().events.onMenuAction((action) => {
      if (action === 'map:zoomIn') map.zoomIn();
      else if (action === 'map:zoomOut') map.zoomOut();
      else if (action === 'map:layers') setLayerMenuOpen((open) => !open);
      else if (action === 'map:fitTrip') {
        // Honest about the limitation: there is no geometry to fit until
        // Phase 2 adds routes and waypoints.
        useUiStore
          .getState()
          .showToast(
            'Nothing to fit yet — trips get routes and waypoints in the next phase.',
          );
      }
    });
  }, [map]);

  const setProvider = async (id: string): Promise<void> => {
    await useSettingsStore.getState().set({ key: 'mapProviderId', value: id });
    setLayerMenuOpen(false);
  };

  if (!loaded) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[var(--color-surface-sunken)] text-[var(--color-text-muted)]">
        Loading map…
      </div>
    );
  }

  return (
    <div className="relative flex-1 overflow-hidden">
      <div ref={map.containerRef} className="absolute inset-0" />

      {/* Controls, floated over the map. */}
      <div className="absolute top-3 right-3 z-[500] flex flex-col gap-1.5">
        <div className="flex flex-col overflow-hidden rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] shadow-md">
          <button
            type="button"
            aria-label="Zoom in"
            onClick={map.zoomIn}
            className="h-8 w-8 text-[16px] leading-none text-[var(--color-text-primary)] hover:bg-[var(--color-surface-sunken)]"
          >
            +
          </button>
          <div className="h-px bg-[var(--color-border-subtle)]" />
          <button
            type="button"
            aria-label="Zoom out"
            onClick={map.zoomOut}
            className="h-8 w-8 text-[16px] leading-none text-[var(--color-text-primary)] hover:bg-[var(--color-surface-sunken)]"
          >
            −
          </button>
        </div>

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
                      ? 'font-semibold text-[var(--color-accent)]'
                      : 'text-[var(--color-text-primary)]'
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

      {/* Non-blocking: the map stays interactive over cached tiles. */}
      {offline && (
        <div
          role="status"
          className="absolute bottom-3 left-3 z-[500] rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] shadow-md"
        >
          Map tiles unavailable — your trips are still fully editable offline.
        </div>
      )}
    </div>
  );
}
