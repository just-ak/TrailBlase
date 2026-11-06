/**
 * The map provider abstraction.
 *
 * Trip management must never reference a concrete provider. Adding a provider
 * in Phase 4 should be a registry entry plus a CSP allowlist entry, with no
 * change to any component — that is the test of whether this abstraction held.
 *
 * `RoutingProvider` and `GarminMapProvider` are deliberately *not* declared
 * here. An interface with no implementation and no caller is a placeholder, and
 * the steering rules forbid those. They are designed in Phases 4 and 5.
 */

export type MapProviderKind =
  | 'raster-tiles'
  | 'vector-tiles'
  | 'offline'
  | 'garmin';

export interface MapProvider {
  readonly id: string;
  readonly name: string;
  readonly kind: MapProviderKind;
  /** Rendered verbatim in the map's attribution control. Required. */
  readonly attribution: string;
  readonly minZoom: number;
  readonly maxZoom: number;
  /** Leaflet-style template, e.g. `https://host/{z}/{x}/{y}.png`. */
  readonly tileUrlTemplate: string;
  readonly subdomains?: readonly string[];
  readonly requiresApiKey: boolean;
  /**
   * Hosts this provider fetches tiles from. The main process builds the CSP
   * `img-src` allowlist from these, so a provider cannot silently reach a host
   * it has not declared.
   */
  readonly tileHosts: readonly string[];
}

/**
 * OpenStreetMap, the Phase 1 provider.
 *
 * Usage policy obligations, which the tile layer implementation must honour:
 * a descriptive User-Agent identifying the application, no prefetching, no
 * bulk or area downloads, and caching limited to tiles fetched for
 * user-initiated viewing.
 */
export const OSM_PROVIDER: MapProvider = {
  id: 'osm',
  name: 'OpenStreetMap',
  kind: 'raster-tiles',
  attribution: '© OpenStreetMap contributors',
  minZoom: 0,
  maxZoom: 19,
  tileUrlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  requiresApiKey: false,
  tileHosts: ['https://tile.openstreetmap.org'],
};

/**
 * The provider registry. Phase 1 ships one entry; Phase 4 adds more. Consumers
 * resolve by id from settings and never hardcode a tile URL.
 */
export const MAP_PROVIDERS: readonly MapProvider[] = [OSM_PROVIDER];

export function getMapProvider(id: string): MapProvider {
  return MAP_PROVIDERS.find((p) => p.id === id) ?? OSM_PROVIDER;
}

/** Every tile host across all registered providers, for the CSP allowlist. */
export function allTileHosts(): readonly string[] {
  return [...new Set(MAP_PROVIDERS.flatMap((p) => [...p.tileHosts]))];
}
