import { ServiceError } from '../services/errors';
import { checkRoutingOrigin } from '@shared/net/origin';

/**
 * The HTTP client for routing providers.
 *
 * This is the **only** outbound request path in the application. Phases 1–3
 * made none at all, so everything about it is deliberately conservative:
 * every call has a deadline, a size ceiling, and a validated origin, and every
 * failure becomes a `ServiceError` the IPC layer can turn into a result.
 *
 * Nothing here knows what a route is. Provider semantics live in the adapter.
 */

/** A routing call that has not answered in this long is not going to. */
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Identifies the application to the routing service.
 *
 * The OpenStreetMap-adjacent fair-use policies that cover the public Valhalla
 * instance ask for a descriptive User-Agent, the same obligation
 * `MapProvider` records for tiles. Electron's default UA claims to be Chrome,
 * which tells an operator nothing about who is actually calling and makes a
 * misbehaving client impossible to identify. Sent for self-hosted instances
 * too: an operator reading their own logs benefits equally.
 */
const USER_AGENT = 'TrailRT/0.1.0 (+https://github.com/trailrt/trailrt)';

/**
 * Minimum spacing between calls to a **remote** routing service.
 *
 * The public Valhalla instance is rate-limited to roughly one call per second
 * per user, and a whole-route snap issues one call per leg as fast as the
 * server answers them. Without spacing, snapping a twenty-point route is an
 * instant burst that earns a 429 and makes the feature look broken while also
 * being rude to a volunteer-funded server.
 *
 * Loopback is exempt. A service on the user's own machine has no fair-use
 * policy to respect, and making a self-hosted snap twenty times slower to
 * protect a server that does not need protecting would be the wrong trade. This
 * is the same loopback distinction the origin policy already draws.
 */
const REMOTE_MIN_INTERVAL_MS = 1100;

let lastRemoteCallAt = 0;

function isLoopbackOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host === '::1' ||
      host === '[::1]' ||
      /^127(?:\.\d{1,3}){3}$/.test(host)
    );
  } catch {
    return false;
  }
}

/**
 * Waits out the remaining spacing before a remote call.
 *
 * Serialised against a module-level timestamp rather than a queue, because
 * every caller in the application already awaits its own request — the snap
 * drain loop and the whole-route snap are both strictly sequential — so there
 * is never more than one call in flight to interleave.
 */
async function throttleRemote(origin: string): Promise<void> {
  if (isLoopbackOrigin(origin)) return;

  const now = Date.now();
  const wait = lastRemoteCallAt + REMOTE_MIN_INTERVAL_MS - now;
  lastRemoteCallAt = wait > 0 ? now + wait : now;
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

/**
 * Response ceiling.
 *
 * A `trace_attributes` response for a long trace is genuinely large, but it is
 * not 32 MB. An unbounded read of an unexpected endpoint — a captive portal
 * login page, a misconfigured reverse proxy streaming something else — is how a
 * desktop app runs out of memory because of a typo in a URL.
 */
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export interface RoutingRequestOptions {
  /** Base URL of the service. Validated before use. */
  endpoint: string;
  /** Path appended to the endpoint, e.g. `/route`. */
  path: string;
  body: unknown;
  timeoutMs?: number;
  /** For cancelling a long calculation from the UI. */
  signal?: AbortSignal;
}

function joinUrl(endpoint: string, path: string): string {
  const base = endpoint.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

/**
 * POSTs JSON and returns the parsed response.
 *
 * POST rather than GET for every call, following the Valhalla documentation's
 * own guidance: a shape or encoded polyline can be large enough to exceed URL
 * length limits, and a truncated query string fails in confusing ways.
 */
export async function postJson<T>(
  options: RoutingRequestOptions,
): Promise<T> {
  const check = checkRoutingOrigin(options.endpoint);
  if (!check.ok) {
    throw new ServiceError(
      'INVALID_REQUEST',
      check.message ?? 'The routing service address is not valid.',
    );
  }

  const url = joinUrl(options.endpoint, options.path);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Before the timer starts, so waiting out the rate limit is not counted
  // against the request's own deadline.
  await throttleRemote(check.origin ?? options.endpoint);

  // Two independent reasons to abort — the deadline and the user cancelling —
  // combined so the fetch only needs one signal.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  const onExternalAbort = (): void => controller.abort('cancelled');
  options.signal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify(options.body),
      signal: controller.signal,
      // No cookies or credentials. A routing service has no business receiving
      // anything that identifies the user beyond the coordinates themselves.
      credentials: 'omit',
      redirect: 'error',
    });

    if (!response.ok) {
      /*
       * `PROVIDER_ERROR` means "the service answered and declined this
       * request", and the adapter treats that as an unroutable leg. A status
       * that says nothing about the request itself must not be classified that
       * way, or a misconfigured host and a rate limit both end up drawn as
       * straight lines across the map with no explanation.
       *
       * 429 is transient and affects every following call. 404 and 405 mean
       * the address is wrong, not the route. Both are the user's to fix.
       */
      const transportLevel =
        response.status === 429 ||
        response.status === 404 ||
        response.status === 405;

      throw new ServiceError(
        transportLevel ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_ERROR',
        describeStatus(response.status),
        `${response.status} ${response.statusText} from ${url}`,
      );
    }

    const text = await readBounded(response);

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ServiceError(
        'PROVIDER_ERROR',
        'The routing service returned a response that was not valid JSON. Check that the address points at a routing service.',
        text.slice(0, 200),
      );
    }
  } catch (cause) {
    if (cause instanceof ServiceError) throw cause;

    /*
     * Branch on the signal, not on the thrown value.
     *
     * `AbortController.abort(reason)` makes fetch reject with that reason
     * *itself* rather than with a `DOMException` named `AbortError`, so a
     * `cause.name === 'AbortError'` check silently misses every abort that
     * carries a reason — which is all of ours. The signal is authoritative and
     * does not depend on how the rejection happens to surface.
     */
    if (controller.signal.aborted) {
      // The reason distinguishes a deadline from a deliberate cancellation.
      // They need different handling: one is a problem to report, the other is
      // the user getting exactly what they asked for.
      if (controller.signal.reason === 'cancelled') {
        throw new ServiceError('CANCELLED', 'The routing request was cancelled.');
      }
      throw new ServiceError(
        'PROVIDER_UNAVAILABLE',
        `The routing service did not respond within ${Math.round(timeoutMs / 1000)} seconds.`,
      );
    }

    throw new ServiceError(
      'PROVIDER_UNAVAILABLE',
      'The routing service could not be reached. Check the address and your connection.',
      cause instanceof Error ? cause.message : String(cause),
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Reads the body, refusing to buffer more than the ceiling.
 *
 * Streamed rather than `response.text()` so the limit applies as bytes arrive.
 * Calling `text()` first and checking the length afterwards would already have
 * allocated whatever was sent.
 */
async function readBounded(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) return response.text();

  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;

    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ServiceError(
        'PROVIDER_ERROR',
        `The routing service sent more than ${Math.round(MAX_RESPONSE_BYTES / 1024 / 1024)} MB. That is not a routing response.`,
      );
    }
    chunks.push(value);
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(joined);
}

/** Turns a status code into something a user can act on. */
function describeStatus(status: number): string {
  if (status === 400) {
    return 'The routing service rejected the request. The selected transport mode may not be supported by that service.';
  }
  if (status === 401 || status === 403) {
    return 'The routing service refused the request. It may require an API key.';
  }
  if (status === 404) {
    return 'The routing service has no endpoint at that address. Check the base URL.';
  }
  if (status === 429) {
    return 'The routing service is rate-limiting requests. Wait a moment before trying again.';
  }
  if (status === 405) {
    return 'The routing service refused a POST to that address. On the public Valhalla demo this means the host is the demo website rather than its API — try valhalla1.openstreetmap.de.';
  }
  if (status >= 500) {
    return 'The routing service reported an internal error.';
  }
  return `The routing service returned an unexpected status (${status}).`;
}
