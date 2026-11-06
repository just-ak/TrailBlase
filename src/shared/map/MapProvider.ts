/**
 * The map provider abstraction.
 *
 * Trip management must never reference a concrete provider. Adding a provider
 * should be a registry entry plus a CSP allowlist entry, with no change to any
 * component — that is the test of whether this abstraction held, and Phase 4 is
 * where it gets tested.
 *
 * `RoutingProvider` now lives in `shared/routing/RoutingProvider.ts`, declared
 * in Phase 4 because Phase 4 implements it. `GarminMapProvider` is still
 * deliberately absent: an interface with no implementation and no caller is a
 * placeholder, and the steering rules forbid those. It is Phase 6.
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
  /**
   * True when the template is supplied by the user rather than by the registry.
   *
   * Such a provider has no usable tile URL or host until the user sets one, so
   * callers must resolve it through `resolveProvider` rather than reading
   * `tileUrlTemplate` directly.
   */
  readonly userSupplied?: boolean;
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
 * OpenTopoMap, the terrain provider required by Phase 4 Requirement 1.1.
 *
 * Two separate licences apply and the attribution names both, because they
 * cover different things: the underlying data is OpenStreetMap under ODbL,
 * while the topographic *rendering* is OpenTopoMap's own work under
 * CC-BY-SA 2.0. Crediting only one would misstate who made what.
 *
 * Its maxZoom is 17, lower than OSM's 19. The tile layer must honour that
 * rather than requesting zoom 18 and painting blank tiles.
 *
 * It is a volunteer-run service with finite capacity, so the same restraint the
 * OSM policy demands applies: no prefetching, no bulk retrieval.
 */
export const OPENTOPOMAP_PROVIDER: MapProvider = {
  id: 'opentopomap',
  name: 'OpenTopoMap (terrain)',
  kind: 'raster-tiles',
  attribution:
    'Map data © OpenStreetMap contributors, SRTM · Rendering © OpenTopoMap (CC-BY-SA)',
  minZoom: 0,
  maxZoom: 17,
  tileUrlTemplate: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
  subdomains: ['a', 'b', 'c'],
  requiresApiKey: false,
  tileHosts: [
    'https://a.tile.opentopomap.org',
    'https://b.tile.opentopomap.org',
    'https://c.tile.opentopomap.org',
  ],
};

/**
 * A user-supplied tile source.
 *
 * This is both the escape hatch for a provider we have not vetted and the
 * offline groundwork of Requirement 8.1: a local tile directory or a
 * `http://localhost` tile server needs no new code path, only a template and a
 * declared host.
 *
 * Shipping this instead of a third-party overlay server is deliberate. Adopting
 * someone else's tile service means accepting their usage policy, and the
 * licensing steering requires that check *before* adoption. A documented gap is
 * worth more than an unvetted dependency.
 */
export const CUSTOM_PROVIDER: MapProvider = {
  id: 'custom',
  name: 'Custom tile source',
  kind: 'offline',
  attribution: 'Tiles supplied by the user',
  minZoom: 0,
  maxZoom: 19,
  tileUrlTemplate: '',
  requiresApiKey: false,
  tileHosts: [],
  userSupplied: true,
};

/**
 * The provider registry. Consumers resolve by id from settings and never
 * hardcode a tile URL.
 */
export const MAP_PROVIDERS: readonly MapProvider[] = [
  OSM_PROVIDER,
  OPENTOPOMAP_PROVIDER,
  CUSTOM_PROVIDER,
];

export function getMapProvider(id: string): MapProvider {
  return MAP_PROVIDERS.find((p) => p.id === id) ?? OSM_PROVIDER;
}

// ------------------------------------------------------------------ overlays

/**
 * An overlay drawn above the base layer.
 *
 * A separate registry rather than a flag on `MapProvider`, because an overlay
 * is chosen independently of the base map (Requirement 1.6) and must be
 * selectable alongside any of them. Sharing the type would mean a base map
 * could be selected as an overlay and vice versa.
 */
export interface MapOverlay {
  readonly id: string;
  readonly name: string;
  readonly attribution: string;
  readonly tileUrlTemplate: string;
  readonly tileHosts: readonly string[];
  readonly maxZoom: number;
  /** 0–1. Overlays are drawn over a base map and must not obscure it. */
  readonly opacity: number;
  readonly userSupplied?: boolean;
}

/**
 * A user-supplied overlay.
 *
 * The only overlay that ships, for the reason given on `CUSTOM_PROVIDER`: it
 * proves the mechanism without adopting a third-party service whose usage
 * policy has not been reviewed.
 */
export const CUSTOM_OVERLAY: MapOverlay = {
  id: 'custom',
  name: 'Custom overlay',
  attribution: 'Overlay supplied by the user',
  tileUrlTemplate: '',
  tileHosts: [],
  maxZoom: 19,
  opacity: 0.7,
  userSupplied: true,
};

export const MAP_OVERLAYS: readonly MapOverlay[] = [CUSTOM_OVERLAY];

export function getMapOverlay(id: string): MapOverlay | null {
  if (id.length === 0) return null;
  return MAP_OVERLAYS.find((o) => o.id === id) ?? null;
}

// ----------------------------------------------------------------- resolution

/**
 * Extracts the origin of a tile template, for the CSP allowlist.
 *
 * Returns null for anything that is not an absolute http(s) URL — a `file://`
 * template or a relative path needs no `img-src` entry, and emitting a bad
 * token would invalidate the whole directive rather than fail visibly.
 */
export function tileTemplateOrigin(template: string): string | null {
  if (template.length === 0) return null;
  try {
    // `{s}` is a Leaflet subdomain placeholder and not valid in a URL host, so
    // it is substituted before parsing. Any single letter resolves the same
    // origin shape; the real subdomains are declared in `tileHosts`.
    const url = new URL(template.replace('{s}', 'a'));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export interface ResolvedProvider {
  provider: MapProvider;
  /** The template to hand Leaflet. Empty when unusable. */
  tileUrlTemplate: string;
  tileHosts: readonly string[];
  /** False when the provider needs configuration it has not been given. */
  usable: boolean;
}

/**
 * Resolves a provider against the user's settings.
 *
 * A user-supplied provider has no template in the registry, so this is the only
 * correct way to read one. It returns `usable: false` rather than falling back
 * to OpenStreetMap, so the UI can say "this needs a URL" instead of silently
 * showing a different map than the one selected — Requirement 1.4.
 */
export function resolveProvider(
  id: string,
  customTileUrl: string,
): ResolvedProvider {
  const provider = getMapProvider(id);

  if (provider.userSupplied !== true) {
    return {
      provider,
      tileUrlTemplate: provider.tileUrlTemplate,
      tileHosts: provider.tileHosts,
      usable: true,
    };
  }

  const template = customTileUrl.trim();
  const origin = tileTemplateOrigin(template);

  return {
    provider,
    tileUrlTemplate: template,
    // A file:// or relative template has no origin to allowlist, which is
    // correct rather than an error: `img-src` already permits 'self'.
    tileHosts: origin === null ? [] : [origin],
    usable: template.length > 0,
  };
}

/**
 * Every tile host the CSP must allow.
 *
 * Includes the user's custom template and overlay origins, because a provider
 * that cannot reach its own tiles is indistinguishable from a broken one. The
 * caller passes current settings rather than this module reading them, keeping
 * `shared/` free of any dependency on how settings are stored.
 */
export function allTileHosts(
  options: { customTileUrl?: string; customOverlayUrl?: string } = {},
): readonly string[] {
  const hosts = new Set<string>();

  for (const provider of MAP_PROVIDERS) {
    for (const host of provider.tileHosts) hosts.add(host);
  }
  for (const overlay of MAP_OVERLAYS) {
    for (const host of overlay.tileHosts) hosts.add(host);
  }

  for (const template of [options.customTileUrl, options.customOverlayUrl]) {
    if (template === undefined) continue;
    const origin = tileTemplateOrigin(template);
    if (origin !== null) hosts.add(origin);
  }

  return [...hosts];
}
