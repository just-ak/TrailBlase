import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ServiceError } from '../services/errors';
import { encodePolyline, VALHALLA_PRECISION } from './polyline';
import { createValhallaProvider } from './valhalla';

/**
 * Tested against a loopback HTTP server rather than a mocked `fetch`.
 *
 * That exercises the real request path — headers, abort, status handling,
 * bounded reading — which is where the mistakes in a first network integration
 * actually live. A mocked fetch would test the adapter's parsing and nothing
 * else.
 *
 * The responses are synthetic, hand-authored from the published Valhalla API
 * reference. This proves the adapter against the documented contract; it does
 * **not** prove the documentation matches a live deployment, and the design
 * says so rather than implying coverage it does not have.
 */

type Handler = (
  path: string,
  body: Record<string, unknown>,
) => { status?: number; json?: unknown; raw?: string; delayMs?: number };

let server: Server;
let endpoint: string;
let handler: Handler;
let lastBody: Record<string, unknown> = {};
let requestCount = 0;

beforeEach(async () => {
  requestCount = 0;
  handler = () => ({ json: {} });

  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      requestCount += 1;
      const text = Buffer.concat(chunks).toString('utf8');
      lastBody = text.length > 0 ? JSON.parse(text) : {};

      const result = handler(req.url ?? '', lastBody);
      const send = (): void => {
        res.writeHead(result.status ?? 200, {
          'Content-Type': 'application/json',
        });
        res.end(result.raw ?? JSON.stringify(result.json ?? {}));
      };
      if (result.delayMs === undefined) send();
      else setTimeout(send, result.delayMs);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  endpoint = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

const ALPS = [
  { lat: 46.5197, lon: 8.012 },
  { lat: 46.5231, lon: 8.0168 },
  { lat: 46.531, lon: 8.0255 },
];

const provider = () => createValhallaProvider({ endpoint, timeoutMs: 2000 });

/** A canned `trace_attributes` body with the given edges. */
const matchResponse = (edges: unknown[]) => ({
  json: {
    shape: encodePolyline(ALPS, VALHALLA_PRECISION),
    edges,
    matched_points: [
      { type: 'matched' },
      { type: 'matched' },
      { type: 'matched' },
    ],
  },
});

// ------------------------------------------------------------------- snap

describe('snap', () => {
  it('decodes the leg shape at Valhalla precision', async () => {
    const roadShape = [
      { lat: 46.5197, lon: 8.012 },
      { lat: 46.5205, lon: 8.0135 },
      { lat: 46.5231, lon: 8.0168 },
    ];
    handler = () => ({
      json: {
        trip: {
          legs: [
            {
              shape: encodePolyline(roadShape, VALHALLA_PRECISION),
              summary: { length: 1.25, time: 95 },
            },
          ],
        },
      },
    });

    const result = await provider().snap(ALPS.slice(0, 2), 'auto');

    expect(result.legs).toHaveLength(1);
    expect(result.legs[0]?.matched).toBe(true);
    expect(result.legs[0]?.shape).toHaveLength(3);
    // Precision 6: a precision-5 decode would put this past the north pole.
    expect(result.legs[0]?.shape[1]?.lat).toBeCloseTo(46.5205, 6);
  });

  // km → m. A missed conversion is a 1000× error that looks like a plausible
  // number in the wrong unit.
  it('converts leg length from kilometres to metres', async () => {
    handler = () => ({
      json: {
        trip: {
          legs: [
            {
              shape: encodePolyline(ALPS.slice(0, 2), VALHALLA_PRECISION),
              summary: { length: 2.5, time: 180 },
            },
          ],
        },
      },
    });

    const result = await provider().snap(ALPS.slice(0, 2), 'auto');
    expect(result.legs[0]?.distanceM).toBeCloseTo(2500, 6);
    expect(result.legs[0]?.durationS).toBe(180);
  });

  it('requests kilometres explicitly rather than trusting the default', async () => {
    handler = () => ({
      json: {
        trip: {
          legs: [{ shape: encodePolyline(ALPS.slice(0, 2), VALHALLA_PRECISION) }],
        },
      },
    });

    await provider().snap(ALPS.slice(0, 2), 'auto');
    expect(lastBody.directions_options).toEqual({ units: 'kilometers' });
  });

  it('maps each transport mode to a costing model', async () => {
    handler = () => ({
      json: {
        trip: {
          legs: [{ shape: encodePolyline(ALPS.slice(0, 2), VALHALLA_PRECISION) }],
        },
      },
    });

    for (const [mode, costing] of [
      ['auto', 'auto'],
      ['motorcycle', 'motorcycle'],
      ['bicycle', 'bicycle'],
      ['pedestrian', 'pedestrian'],
    ] as const) {
      await provider().snap(ALPS.slice(0, 2), mode);
      expect(lastBody.costing, mode).toBe(costing);
    }
  });

  // One call per leg, so a single unroutable stretch does not lose the rest.
  it('calls once per leg', async () => {
    handler = () => ({
      json: {
        trip: {
          legs: [{ shape: encodePolyline(ALPS.slice(0, 2), VALHALLA_PRECISION) }],
        },
      },
    });

    await provider().snap(ALPS, 'auto');
    expect(requestCount).toBe(2);
  });

  describe('an unroutable leg', () => {
    it('stays straight and is reported, rather than failing the whole snap', async () => {
      handler = (_path, body) => {
        const locations = body.locations as { lat: number }[];
        // The second leg starts at the middle point; refuse that one only.
        if (locations[0]?.lat === ALPS[1]?.lat) {
          return { status: 400, json: { error: 'No path could be found' } };
        }
        return {
          json: {
            trip: {
              legs: [
                { shape: encodePolyline(ALPS.slice(0, 2), VALHALLA_PRECISION) },
              ],
            },
          },
        };
      };

      const result = await provider().snap(ALPS, 'auto');

      expect(result.legs).toHaveLength(2);
      expect(result.legs[0]?.matched).toBe(true);
      expect(result.legs[1]?.matched).toBe(false);
      // The straight line the user drew, not a guess at a detour.
      expect(result.legs[1]?.shape).toEqual([ALPS[1], ALPS[2]]);
      expect(result.unmatchedLegs).toEqual([[1, 2]]);
    });

    it('is reported when the provider returns a degenerate shape', async () => {
      handler = () => ({ json: { trip: { legs: [{ shape: '' }] } } });

      const result = await provider().snap(ALPS.slice(0, 2), 'auto');
      expect(result.legs[0]?.matched).toBe(false);
      expect(result.unmatchedLegs).toEqual([[0, 1]]);
      // A straight-line distance is still computed, so statistics work.
      expect(result.legs[0]?.distanceM).toBeGreaterThan(0);
    });
  });

  it('refuses fewer than two points', async () => {
    await expect(provider().snap([ALPS[0] as never], 'auto')).rejects.toThrow(
      /at least two points/,
    );
  });
});

// ------------------------------------------------------------------ match

describe('match', () => {
  it('converts a posted speed limit from km/h to metres per second', async () => {
    handler = () =>
      matchResponse([
        {
          begin_shape_index: 0,
          end_shape_index: 2,
          length: 1.5,
          speed_limit: 80,
          road_class: 'secondary',
          surface: 'paved',
        },
      ]);

    const result = await provider().match(ALPS, 'auto');
    const edge = result.edges[0];

    // 80 km/h is 22.22 m/s. Storing 80 would be a 3.6× error.
    expect(edge?.speedLimitMps).toBeCloseTo(80 * (1000 / 3600), 9);
    expect(edge?.lengthM).toBeCloseTo(1500, 6);
    expect(edge?.roadClass).toBe('secondary');
    expect(edge?.surface).toBe('paved');
  });

  /*
   * The rule from ADR 0011 that matters most. Valhalla returns `speed_limit`
   * only when the data has one, and OSM coverage is partial. A 0 here would
   * land in the lowest speed band instead of the Unknown band, converting a
   * data gap into a false measurement.
   */
  it('keeps an absent speed limit as null, never zero', async () => {
    handler = () =>
      matchResponse([
        {
          begin_shape_index: 0,
          end_shape_index: 2,
          length: 1.5,
          road_class: 'unclassified',
        },
      ]);

    const result = await provider().match(ALPS, 'auto');
    expect(result.edges[0]?.speedLimitMps).toBeNull();
    expect(result.edges[0]?.speedLimitMps).not.toBe(0);
    expect(result.edges[0]?.surface).toBeNull();
  });

  it('preserves a genuine zero limit if one is ever reported', async () => {
    handler = () =>
      matchResponse([
        { begin_shape_index: 0, end_shape_index: 1, speed_limit: 0 },
      ]);
    const result = await provider().match(ALPS, 'auto');
    expect(result.edges[0]?.speedLimitMps).toBe(0);
  });

  it('rejects a road class or surface it does not recognise', async () => {
    handler = () =>
      matchResponse([
        {
          begin_shape_index: 0,
          end_shape_index: 1,
          road_class: 'hyperlane',
          surface: 'obsidian',
        },
      ]);

    const result = await provider().match(ALPS, 'auto');
    // Null rather than passing an unknown string into the domain, where it
    // would reach a UI that cannot label it.
    expect(result.edges[0]?.roadClass).toBeNull();
    expect(result.edges[0]?.surface).toBeNull();
  });

  it('skips an edge with no shape indices rather than guessing', async () => {
    handler = () => matchResponse([{ length: 1, speed_limit: 50 }]);
    const result = await provider().match(ALPS, 'auto');
    expect(result.edges).toEqual([]);
  });

  it('counts unmatched points', async () => {
    handler = () => ({
      json: {
        shape: encodePolyline(ALPS, VALHALLA_PRECISION),
        edges: [{ begin_shape_index: 0, end_shape_index: 1 }],
        matched_points: [
          { type: 'matched' },
          { type: 'unmatched' },
          { type: 'interpolated' },
        ],
      },
    });

    const result = await provider().match(ALPS, 'auto');
    expect(result.unmatchedPointCount).toBe(1);
  });

  it('sends the shape as an encoded polyline, not an array of objects', async () => {
    handler = () => matchResponse([]);
    await provider().match(ALPS, 'auto');

    expect(typeof lastBody.encoded_polyline).toBe('string');
    expect(lastBody.shape).toBeUndefined();
  });

  it('asks for map_snap and an explicit attribute list', async () => {
    handler = () => matchResponse([]);
    await provider().match(ALPS, 'auto');

    expect(lastBody.shape_match).toBe('map_snap');
    const filters = lastBody.filters as { attributes: string[]; action: string };
    expect(filters.action).toBe('include');
    expect(filters.attributes).toContain('edge.speed_limit');
    expect(filters.attributes).toContain('edge.road_class');
    expect(filters.attributes).toContain('edge.begin_shape_index');
  });

  it('refuses fewer than two points', async () => {
    await expect(provider().match([ALPS[0] as never], 'auto')).rejects.toThrow(
      /at least two points/,
    );
  });
});

// ------------------------------------------------------- transport failures

describe('transport failures', () => {
  it('reports a timeout as the provider being unavailable', async () => {
    handler = () => ({ json: {}, delayMs: 500 });
    const slow = createValhallaProvider({ endpoint, timeoutMs: 50 });

    try {
      await slow.match(ALPS, 'auto');
      expect.unreachable('should have timed out');
    } catch (cause) {
      expect(cause).toBeInstanceOf(ServiceError);
      expect((cause as ServiceError).code).toBe('PROVIDER_UNAVAILABLE');
      expect((cause as ServiceError).message).toMatch(/did not respond/);
    }
  });

  // A cancellation is the user getting what they asked for, not a failure, so
  // it gets its own code and must not be reported as an error.
  it('distinguishes a cancellation from a timeout', async () => {
    handler = () => ({ json: {}, delayMs: 500 });
    const controller = new AbortController();
    const cancellable = createValhallaProvider({
      endpoint,
      timeoutMs: 5000,
      signal: controller.signal,
    });

    const pending = cancellable.match(ALPS, 'auto');
    setTimeout(() => controller.abort(), 20);

    try {
      await pending;
      expect.unreachable('should have been cancelled');
    } catch (cause) {
      expect((cause as ServiceError).code).toBe('CANCELLED');
    }
  });

  it.each([
    [401, /API key/],
    [404, /no endpoint at that address/],
    [429, /rate-limiting/],
    [500, /internal error/],
  ])('explains status %s in terms a user can act on', async (status, hint) => {
    handler = () => ({ status, json: { error: 'x' } });

    try {
      await provider().match(ALPS, 'auto');
      expect.unreachable('should have thrown');
    } catch (cause) {
      expect((cause as ServiceError).code).toBe('PROVIDER_ERROR');
      expect((cause as ServiceError).message).toMatch(hint);
    }
  });

  it('reports malformed JSON as a provider error, naming the likely cause', async () => {
    handler = () => ({ raw: '<html>not a routing service</html>' });

    try {
      await provider().match(ALPS, 'auto');
      expect.unreachable('should have thrown');
    } catch (cause) {
      expect((cause as ServiceError).code).toBe('PROVIDER_ERROR');
      expect((cause as ServiceError).message).toMatch(/not valid JSON/);
    }
  });

  it('refuses an endpoint the origin policy rejects, without a request', async () => {
    const insecure = createValhallaProvider({
      endpoint: 'http://routing.example.org',
    });

    await expect(insecure.match(ALPS, 'auto')).rejects.toThrow(
      /only allowed for a routing service on this machine/,
    );
    expect(requestCount).toBe(0);
  });

  it('tolerates a response that is valid JSON but has no trip', async () => {
    handler = () => ({ json: { status: 'ok' } });
    const result = await provider().snap(ALPS.slice(0, 2), 'auto');
    // Reported as unmatched rather than throwing on a missing field.
    expect(result.legs[0]?.matched).toBe(false);
  });
});
