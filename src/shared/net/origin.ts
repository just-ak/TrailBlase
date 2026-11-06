/**
 * Validation for the one outbound origin the application is allowed to add.
 *
 * Phases 1–3 set `connect-src 'self'`, so the app made no outbound requests at
 * all beyond tile images. Phase 4's routing provider is the first exception,
 * and this module is the gate it goes through.
 *
 * ## Why this is in `shared/` and not `main/security/`
 *
 * It started in `main/security/` on the reasoning that an outbound-origin
 * policy is the main process's business. Three callers then needed the same
 * predicate: the CSP builder, the settings schema in `shared/ipc/`, and the
 * settings field in the renderer, which should tell the user their endpoint is
 * unacceptable as they type rather than after a round trip. One
 * implementation used by all three beats a duplicate per process.
 *
 * Moving the *predicate* does not move the *enforcement*. Nothing the renderer
 * does with this function can widen the CSP or reach the network; main calls it
 * again in `security/csp.ts` and `routing/client.ts`, and those calls are what
 * actually decide. This is a pure function over a string, with no Electron,
 * Node or DOM dependency — exactly what `shared/` is for.
 */

export type OriginRejection =
  | 'empty'
  | 'malformed'
  | 'unsupported-scheme'
  | 'plaintext-not-loopback'
  | 'has-credentials';

export interface OriginCheck {
  ok: boolean;
  /** Scheme + host + port, with no path. Null when rejected. */
  origin: string | null;
  reason: OriginRejection | null;
  message: string | null;
}

/**
 * Hosts that are unambiguously the user's own machine.
 *
 * `localhost` is included even though it is a name rather than a literal,
 * because a self-hosted routing instance is the configuration this project
 * actively wants to support and nobody types `127.0.0.1` for it.
 */
function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host === '[::1]') return true;
  // The whole 127.0.0.0/8 block, not just 127.0.0.1.
  return /^127(?:\.\d{1,3}){3}$/.test(host);
}

/**
 * Validates a user-supplied routing endpoint.
 *
 * The policy, and why:
 *
 * - **https anywhere.** A route is the user's planned movements; sending it in
 *   plaintext across a network is not something to offer by default.
 * - **http only for loopback.** Requiring a certificate for a service running
 *   on the same machine would make self-hosting impractical, and that is the
 *   configuration the no-cloud policy in `.kiro/steering/licensing.md` most
 *   wants to support. Traffic that never leaves the machine is not exposed by
 *   being plaintext.
 * - **No credentials in the URL.** They would end up in the CSP header and in
 *   any log line that prints the configured endpoint.
 */
export function checkRoutingOrigin(raw: string): OriginCheck {
  const value = raw.trim();

  if (value.length === 0) {
    return {
      ok: false,
      origin: null,
      reason: 'empty',
      message: 'No routing service is configured.',
    };
  }

  /*
   * Require a `scheme://` prefix before parsing.
   *
   * Without this check the most likely user mistake — omitting the scheme —
   * produces a baffling error, because `new URL('example.org:8002')` succeeds:
   * it reads `example.org:` as the scheme and `8002` as the path. The user then
   * gets told that "example.org:" is an unsupported scheme, which is true and
   * useless. Detecting it here lets the message say what to do instead.
   */
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return {
      ok: false,
      origin: null,
      reason: 'malformed',
      message: `"${value}" is not a valid URL. Include the scheme, for example https://routing.example.org.`,
    };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return {
      ok: false,
      origin: null,
      reason: 'malformed',
      message: `"${value}" is not a valid URL. Include the scheme, for example https://routing.example.org.`,
    };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return {
      ok: false,
      origin: null,
      reason: 'unsupported-scheme',
      message: `${url.protocol} is not supported for a routing service. Use https, or http for a service on this machine.`,
    };
  }

  if (url.username.length > 0 || url.password.length > 0) {
    return {
      ok: false,
      origin: null,
      reason: 'has-credentials',
      message:
        'A routing endpoint must not contain a username or password; it would be written into the security policy. Put credentials in the service configuration instead.',
    };
  }

  if (url.protocol === 'http:' && !isLoopback(url.hostname)) {
    return {
      ok: false,
      origin: null,
      reason: 'plaintext-not-loopback',
      message:
        'Plaintext http is only allowed for a routing service on this machine. Use https for anything else — a route describes where you plan to be.',
    };
  }

  return { ok: true, origin: url.origin, reason: null, message: null };
}

/** The origin to add to `connect-src`, or null when there is nothing to add. */
export function routingConnectOrigin(raw: string): string | null {
  return checkRoutingOrigin(raw).origin;
}
