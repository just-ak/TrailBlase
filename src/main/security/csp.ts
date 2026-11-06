import { session } from 'electron';
import { allTileHosts } from '@shared/map/MapProvider';
import { routingConnectOrigin } from '@shared/net/origin';

/**
 * The network surface the policy permits, derived from settings.
 *
 * Passed in rather than read here, so the policy is a pure function of its
 * inputs and can be unit-tested without Electron or a database.
 */
export interface NetworkSurface {
  /** User-supplied tile template, if the custom provider is configured. */
  customTileUrl?: string;
  customOverlayUrl?: string;
  /** Routing endpoint. Validated; an invalid one contributes nothing. */
  routingEndpoint?: string;
}

/**
 * Content-Security-Policy for renderer responses.
 *
 * Tile hosts come from the map provider registry rather than being hardcoded,
 * so adding a provider means declaring its hosts — which makes the CSP a
 * deliberate choke point rather than something that drifts out of date.
 *
 * `style-src` needs 'unsafe-inline' because Leaflet sets inline transforms on
 * tile and marker elements. That is the single relaxation here and it is scoped
 * to styles; `script-src` stays 'self'.
 */
export function buildCsp(isDev: boolean, surface: NetworkSurface = {}): string {
  const tileHosts = allTileHosts({
    ...(surface.customTileUrl === undefined
      ? {}
      : { customTileUrl: surface.customTileUrl }),
    ...(surface.customOverlayUrl === undefined
      ? {}
      : { customOverlayUrl: surface.customOverlayUrl }),
  }).join(' ');

  // The Vite dev server and its HMR websocket only exist in development. They
  // must never appear in a packaged build's policy.
  const devScript = isDev ? " 'unsafe-inline'" : '';
  const devConnect = isDev ? ' ws://localhost:* http://localhost:*' : '';

  /*
   * The routing origin is the first and only outbound connection this
   * application makes. It is validated by `checkRoutingOrigin` — https
   * anywhere, http only for loopback, no credentials — and an endpoint that
   * fails validation contributes nothing rather than being passed through.
   *
   * Never a wildcard. A provider reaches exactly the origin the user named.
   */
  const routingOrigin =
    surface.routingEndpoint === undefined
      ? null
      : routingConnectOrigin(surface.routingEndpoint);
  const routeConnect = routingOrigin === null ? '' : ` ${routingOrigin}`;

  return [
    "default-src 'self'",
    `script-src 'self'${devScript}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${tileHosts}`,
    `connect-src 'self'${devConnect}${routeConnect}`,
    "font-src 'self' data:",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/**
 * Installs the policy.
 *
 * The header is rebuilt from `surface` on every request rather than captured
 * once, so changing the routing endpoint in settings takes effect on the next
 * navigation without restarting the app.
 */
export function installContentSecurityPolicy(
  isDev: boolean,
  readSurface: () => NetworkSurface = () => ({}),
): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // Only the renderer's own documents and subresources need the policy.
    // Rewriting headers on every request, including tile images served over
    // file:// or from the cache, risks dropping headers the loader needs and
    // surfaces as an opaque ERR_FAILED.
    const isDocument =
      details.resourceType === 'mainFrame' ||
      details.resourceType === 'subFrame';

    if (!isDocument) {
      callback({});
      return;
    }

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [buildCsp(isDev, readSurface())],
      },
    });
  });
}

/**
 * The OpenStreetMap tile usage policy requires a descriptive User-Agent that
 * identifies the application, so operators can contact us rather than simply
 * blocking. Applied to tile requests only; it is not a general override.
 */
export function installTileUserAgent(appVersion: string): void {
  const ua = `TrailRT/${appVersion} (+https://github.com/trailrt/trailrt)`;
  const hostPatterns = allTileHosts().map((h) => `${h}/*`);
  if (hostPatterns.length === 0) return;

  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: hostPatterns },
    (details, callback) => {
      callback({
        requestHeaders: { ...details.requestHeaders, 'User-Agent': ua },
      });
    },
  );
}

/**
 * Deny every permission request. Phase 1 needs no camera, microphone,
 * geolocation or notifications, and a silent default-allow is how those get
 * granted by accident later.
 */
export function denyAllPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
}
