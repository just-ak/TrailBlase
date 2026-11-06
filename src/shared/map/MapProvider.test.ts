import { describe, expect, it } from 'vitest';
import {
  allTileHosts,
  CUSTOM_OVERLAY,
  CUSTOM_PROVIDER,
  getMapOverlay,
  getMapProvider,
  MAP_OVERLAYS,
  MAP_PROVIDERS,
  OPENTOPOMAP_PROVIDER,
  OSM_PROVIDER,
  resolveProvider,
  tileTemplateOrigin,
} from './MapProvider';

describe('the registry', () => {
  it('has unique ids', () => {
    const ids = MAP_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves a known id and falls back for an unknown one', () => {
    expect(getMapProvider('opentopomap')).toBe(OPENTOPOMAP_PROVIDER);
    expect(getMapProvider('nonexistent')).toBe(OSM_PROVIDER);
  });

  it('declares every host its template can reach', () => {
    for (const provider of MAP_PROVIDERS) {
      if (provider.userSupplied === true) continue;
      const origin = tileTemplateOrigin(provider.tileUrlTemplate);
      expect(origin, provider.id).not.toBeNull();
      // A provider whose template points somewhere it has not declared would
      // be blocked by the CSP at runtime and look simply broken.
      if (provider.subdomains === undefined) {
        expect(provider.tileHosts, provider.id).toContain(origin);
      } else {
        // With subdomains, each one is declared separately.
        expect(provider.tileHosts.length).toBe(provider.subdomains.length);
        for (const sub of provider.subdomains) {
          expect(
            provider.tileHosts.some((h) => h.includes(`${sub}.`)),
            `${provider.id} ${sub}`,
          ).toBe(true);
        }
      }
    }
  });

  it('gives every provider a non-empty attribution', () => {
    for (const provider of MAP_PROVIDERS) {
      expect(provider.attribution.length, provider.id).toBeGreaterThan(0);
    }
  });
});

describe('OpenTopoMap', () => {
  // Two licences cover different things: the data is OSM under ODbL, the
  // topographic rendering is OpenTopoMap's own under CC-BY-SA. Crediting one
  // would misstate who made what.
  it('credits both the data and the rendering', () => {
    expect(OPENTOPOMAP_PROVIDER.attribution).toContain('OpenStreetMap');
    expect(OPENTOPOMAP_PROVIDER.attribution).toContain('OpenTopoMap');
    expect(OPENTOPOMAP_PROVIDER.attribution).toContain('CC-BY-SA');
  });

  // Its tiles stop at 17. Requesting 18 paints blank tiles rather than failing,
  // which is the sort of thing that gets blamed on the app.
  it('declares its real maximum zoom rather than copying OSM', () => {
    expect(OPENTOPOMAP_PROVIDER.maxZoom).toBe(17);
    expect(OPENTOPOMAP_PROVIDER.maxZoom).toBeLessThan(OSM_PROVIDER.maxZoom);
  });

  it('needs no API key', () => {
    expect(OPENTOPOMAP_PROVIDER.requiresApiKey).toBe(false);
  });
});

describe('tileTemplateOrigin', () => {
  it('extracts the origin and discards the tile path', () => {
    expect(tileTemplateOrigin('https://tiles.example/a/{z}/{x}/{y}.png')).toBe(
      'https://tiles.example',
    );
  });

  it('substitutes the Leaflet subdomain placeholder before parsing', () => {
    // `{s}` is not valid in a URL host, so a naive parse would throw.
    expect(
      tileTemplateOrigin('https://{s}.tile.example/{z}/{x}/{y}.png'),
    ).toBe('https://a.tile.example');
  });

  it('returns null for a non-http scheme or an unparseable template', () => {
    expect(tileTemplateOrigin('file:///tmp/{z}/{x}/{y}.png')).toBeNull();
    expect(tileTemplateOrigin('/local/{z}/{x}/{y}.png')).toBeNull();
    expect(tileTemplateOrigin('')).toBeNull();
    expect(tileTemplateOrigin('not a url')).toBeNull();
  });
});

describe('resolveProvider', () => {
  it('returns a registry provider unchanged', () => {
    const resolved = resolveProvider('osm', '');
    expect(resolved.usable).toBe(true);
    expect(resolved.tileUrlTemplate).toBe(OSM_PROVIDER.tileUrlTemplate);
  });

  // Falling back to OSM would silently show a different map than the one
  // selected. Reporting it unusable lets the UI say "this needs a URL".
  it('reports a user-supplied provider with no URL as unusable', () => {
    const resolved = resolveProvider('custom', '');
    expect(resolved.provider).toBe(CUSTOM_PROVIDER);
    expect(resolved.usable).toBe(false);
    expect(resolved.tileHosts).toEqual([]);
  });

  it('uses a configured custom template and declares its origin', () => {
    const resolved = resolveProvider(
      'custom',
      '  https://tiles.internal.example/{z}/{x}/{y}.png  ',
    );
    expect(resolved.usable).toBe(true);
    expect(resolved.tileUrlTemplate).toBe(
      'https://tiles.internal.example/{z}/{x}/{y}.png',
    );
    expect(resolved.tileHosts).toEqual(['https://tiles.internal.example']);
  });

  it('accepts a local file template with no host to allowlist', () => {
    const resolved = resolveProvider(
      'custom',
      'file:///Users/me/tiles/{z}/{x}/{y}.png',
    );
    // Usable, but contributes no img-src entry: 'self' already covers it.
    expect(resolved.usable).toBe(true);
    expect(resolved.tileHosts).toEqual([]);
  });
});

describe('overlays', () => {
  // A separate registry, not a flag on MapProvider: an overlay is chosen
  // independently of the base map, and sharing the type would let a base map be
  // selected as an overlay.
  it('are a distinct registry from base providers', () => {
    const providerIds = new Set(MAP_PROVIDERS.map((p) => p.id));
    expect(MAP_OVERLAYS.length).toBeGreaterThan(0);
    for (const overlay of MAP_OVERLAYS) {
      expect('kind' in overlay).toBe(false);
      expect(providerIds.has(overlay.id)).toBe(true); // ids may coincide
    }
  });

  it('treats an empty id as no overlay', () => {
    expect(getMapOverlay('')).toBeNull();
  });

  it('returns null for an unknown overlay rather than a default', () => {
    expect(getMapOverlay('nonexistent')).toBeNull();
  });

  it('resolves the custom overlay', () => {
    expect(getMapOverlay('custom')).toBe(CUSTOM_OVERLAY);
  });

  it('keeps overlay opacity below full, so the base map stays visible', () => {
    for (const overlay of MAP_OVERLAYS) {
      expect(overlay.opacity).toBeGreaterThan(0);
      expect(overlay.opacity).toBeLessThan(1);
    }
  });
});

describe('allTileHosts', () => {
  it('collects every registered host without duplicates', () => {
    const hosts = allTileHosts();
    expect(new Set(hosts).size).toBe(hosts.length);
    expect(hosts).toContain('https://tile.openstreetmap.org');
    expect(hosts).toContain('https://c.tile.opentopomap.org');
  });

  it('includes user-supplied origins when given them', () => {
    const hosts = allTileHosts({
      customTileUrl: 'https://base.example/{z}/{x}/{y}.png',
      customOverlayUrl: 'https://over.example/{z}/{x}/{y}.png',
    });
    expect(hosts).toContain('https://base.example');
    expect(hosts).toContain('https://over.example');
  });

  it('ignores a user template with no origin', () => {
    const before = allTileHosts().length;
    const after = allTileHosts({ customTileUrl: 'file:///tmp/{z}.png' }).length;
    expect(after).toBe(before);
  });
});
