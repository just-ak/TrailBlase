import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LatLon } from '@shared/geo/distance';
import {
  MAX_SNAPPED_POINTS,
  MAX_UNDOABLE_POINTS,
  type MatchResult,
  type RoutingProvider,
  type SnapResult,
  type TransportMode,
} from '@shared/routing/RoutingProvider';
import { createDatabase, type Db, type DbHandle } from '../db/client';
import * as controlRepo from '../db/repositories/routeControlPoints';
import { ServiceError } from './errors';
import * as roadAttributeService from './roadAttributeService';
import * as routeService from './routeService';
import * as routingService from './routingService';
import * as trackService from './trackService';
import * as tripService from './tripService';
import * as undoService from './undoService';

let dir: string;
let handle: DbHandle;
let db: Db;
let tripId: string;

const rp = (lat: number, lon: number, ele: number | null = null) => ({
  lat,
  lon,
  ele,
  name: null,
  symbol: null,
  notes: null,
});

/**
 * A short timed recording. Module scope because it closes over the
 * per-test `db` and `tripId` module variables, not over a describe block.
 */
const timedTrack = () =>
  trackService.createFromParsed(db, {
    tripId,
    source: 'import',
    parsed: {
      name: 'Timed',
      segments: [
        {
          points: [
            { lat: 46.5, lon: 8, ele: null, time: 0 },
            { lat: 46.51, lon: 8, ele: null, time: 60_000 },
            { lat: 46.52, lon: 8, ele: null, time: 120_000 },
          ],
        },
      ],
      metadata: {},
    },
  }).result;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailrt-routing-'));
  handle = createDatabase({ file: join(dir, 'test.db') });
  db = handle.db;
  undoService.clear();
  tripId = tripService.create(db, {
    name: 'Trip',
    folderId: null,
    description: null,
    notes: null,
  }).result.id;
});

afterEach(() => {
  undoService.clear();
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A provider that returns scripted geometry.
 *
 * The real adapter is tested against a loopback HTTP server in
 * `main/routing/valhalla.test.ts`. Here the question is what the *service* does
 * with a provider's answer, so the provider is a fake and the tests stay about
 * storage, control points, caps and undo.
 */
function fakeProvider(options: {
  /**
   * Returns the shape for a leg. `null` scripts an unmatched leg; returning
   * `undefined` (or omitting the hook) falls back to a straight three-point
   * shape. The two cases have to stay distinguishable, so `??` is not usable
   * here — it would collapse a scripted `null` into the default.
   */
  legShape?: (from: LatLon, to: LatLon) => LatLon[] | null | undefined;
  edges?: MatchResult['edges'];
  onCall?: () => void;
}): RoutingProvider {
  return {
    id: 'fake',
    name: 'Fake',
    origins: ['https://fake.invalid'],
    attribution: 'Fake',

    async snap(controlPoints, mode: TransportMode): Promise<SnapResult> {
      options.onCall?.();
      const legs: SnapResult['legs'] = [];
      const unmatchedLegs: [number, number][] = [];

      for (let i = 0; i < controlPoints.length - 1; i += 1) {
        const from = controlPoints[i] as LatLon;
        const to = controlPoints[i + 1] as LatLon;
        const scripted = options.legShape?.(from, to);
        const shape =
          scripted === undefined
            ? [
                from,
                { lat: (from.lat + to.lat) / 2, lon: (from.lon + to.lon) / 2 },
                to,
              ]
            : scripted;
        if (shape === null) {
          legs.push({
            matched: false,
            fromControlIndex: i,
            toControlIndex: i + 1,
            shape: [from, to],
            distanceM: null,
            durationS: null,
          });
          unmatchedLegs.push([i, i + 1]);
          continue;
        }
        legs.push({
          matched: true,
          fromControlIndex: i,
          toControlIndex: i + 1,
          shape,
          distanceM: null,
          durationS: null,
        });
      }

      return { provider: 'fake', mode, legs, unmatchedLegs };
    },

    async match(shape, mode): Promise<MatchResult> {
      options.onCall?.();
      return {
        provider: 'fake',
        mode,
        shape: [...shape],
        edges: options.edges ?? [
          {
            startIndex: 0,
            endIndex: shape.length - 1,
            lengthM: null,
            speedLimitMps: 22.22,
            roadClass: 'secondary',
            surface: 'paved',
          },
        ],
        unmatchedPointCount: 0,
      };
    },
  };
}

const newRoute = (points = [rp(46.5, 8), rp(46.52, 8.02)], name = 'Route') =>
  routeService.create(db, { tripId, name, colour: null, points }).result;

// ------------------------------------------------------------- flattenLegs

describe('flattenLegs', () => {
  // Leg n ends where leg n+1 begins. Keeping both copies puts a zero-length
  // segment at every control point, which inflates the count and reads as a
  // stationary sample in any speed calculation.
  it('drops the vertex shared between consecutive legs', () => {
    const shared = { lat: 46.51, lon: 8.01 };
    const flat = routingService.flattenLegs([
      { shape: [{ lat: 46.5, lon: 8 }, shared] },
      { shape: [shared, { lat: 46.52, lon: 8.02 }] },
    ]);

    expect(flat).toHaveLength(3);
  });

  it('keeps a genuinely distinct vertex at a leg boundary', () => {
    const flat = routingService.flattenLegs([
      {
        shape: [
          { lat: 46.5, lon: 8 },
          { lat: 46.51, lon: 8.01 },
        ],
      },
      {
        shape: [
          { lat: 46.6, lon: 8.1 },
          { lat: 46.62, lon: 8.12 },
        ],
      },
    ]);
    expect(flat).toHaveLength(4);
  });
});

// ---------------------------------------------------------------- snapping

describe('snapRoute', () => {
  it('replaces geometry with road shape and keeps the control points', async () => {
    const route = newRoute();
    const outcome = await routingService.snapRoute(db, {
      routeId: route.id,
      provider: fakeProvider({}),
      mode: 'motorcycle',
    });

    expect(outcome.result.pointCount).toBe(3);
    expect(routeService.get(db, route.id).points).toHaveLength(3);

    // The user's two points survive as intent, so one of them can be moved
    // later and only the affected leg re-snapped.
    expect(controlRepo.listControlPoints(db, route.id)).toEqual([
      { lat: 46.5, lon: 8 },
      { lat: 46.52, lon: 8.02 },
    ]);
  });

  it('records provenance so the geometry origin is auditable', async () => {
    const route = newRoute();
    await routingService.snapRoute(db, {
      routeId: route.id,
      provider: fakeProvider({}),
      mode: 'motorcycle',
    });

    const provenance = routingService.provenance(db, route.id);
    expect(provenance.routingProvider).toBe('fake');
    expect(provenance.transportMode).toBe('motorcycle');
    expect(provenance.snappedAt).toBeGreaterThan(0);
    expect(provenance.controlPointCount).toBe(2);
  });

  // Absence of a provider is what marks a hand-drawn route, which is how every
  // pre-Phase-4 route keeps behaving identically.
  it('leaves a hand-drawn route with no provenance', () => {
    const route = newRoute();
    const provenance = routingService.provenance(db, route.id);
    expect(provenance.routingProvider).toBeNull();
    expect(provenance.controlPointCount).toBe(0);
  });

  it('recomputes statistics from the snapped geometry', async () => {
    const route = newRoute();
    const before = routeService.get(db, route.id).distanceM;

    await routingService.snapRoute(db, {
      routeId: route.id,
      provider: fakeProvider({
        // A detour: via a point well off the straight line.
        legShape: (from, to) => [from, { lat: 46.7, lon: 8.3 }, to],
      }),
      mode: 'auto',
    });

    // Longer than the straight line, because the road is.
    expect(routeService.get(db, route.id).distanceM).toBeGreaterThan(
      before as number,
    );
  });

  it('drops elevation on snapped points rather than carrying it over', async () => {
    const route = newRoute([rp(46.5, 8, 1200), rp(46.52, 8.02, 1400)]);
    await routingService.snapRoute(db, {
      routeId: route.id,
      provider: fakeProvider({}),
      mode: 'auto',
    });

    // The road shape is a different set of positions; a height measured
    // somewhere else would be invented data.
    expect(
      routeService.get(db, route.id).points.every((p) => p.ele === null),
    ).toBe(true);
    expect(routeService.get(db, route.id).elevGainM).toBeNull();
  });

  describe('an unmatched leg', () => {
    it('stays straight and is recorded in metadata', async () => {
      const route = newRoute([rp(46.5, 8), rp(46.52, 8.02), rp(46.54, 8.04)]);

      const outcome = await routingService.snapRoute(db, {
        routeId: route.id,
        provider: fakeProvider({
          // Refuse the second leg only.
          legShape: (from) => (from.lat === 46.52 ? null : undefined),
        }),
        mode: 'auto',
      });

      expect(outcome.result.unmatchedLegs).toEqual([[1, 2]]);
      expect(routingService.provenance(db, route.id).unmatchedLegs).toEqual([
        [1, 2],
      ]);
    });

    it('does not fail the whole snap', async () => {
      const route = newRoute([rp(46.5, 8), rp(46.52, 8.02), rp(46.54, 8.04)]);
      const outcome = await routingService.snapRoute(db, {
        routeId: route.id,
        provider: fakeProvider({
          legShape: (from) => (from.lat === 46.52 ? null : undefined),
        }),
        mode: 'auto',
      });
      expect(outcome.result.pointCount).toBeGreaterThan(2);
    });
  });

  it('preserves existing metadata when recording unmatched legs', async () => {
    const route = routeService.create(db, {
      tripId,
      name: 'Imported',
      colour: null,
      points: [rp(46.5, 8), rp(46.52, 8.02)],
      metadata: { extensions: { source: 'gpx' } },
    }).result;

    await routingService.snapRoute(db, {
      routeId: route.id,
      provider: fakeProvider({}),
      mode: 'auto',
    });

    // A snap must not discard fields preserved from an import.
    const { readMetadata } = await import('../db/repositories/routes');
    expect(readMetadata(db, route.id).extensions).toEqual({ source: 'gpx' });
  });

  it('refuses a route with fewer than two points', async () => {
    const route = newRoute([rp(46.5, 8)]);
    await expect(
      routingService.snapRoute(db, {
        routeId: route.id,
        provider: fakeProvider({}),
        mode: 'auto',
      }),
    ).rejects.toThrow(/at least two points/);
  });

  // Refused before anything is written, with the count, rather than storing a
  // route that cannot be drawn or exported.
  it('refuses a snap that would exceed the point cap, naming the count', async () => {
    const route = newRoute();
    const huge = Array.from({ length: MAX_SNAPPED_POINTS + 10 }, (_, i) => ({
      lat: 46.5 + i * 1e-6,
      lon: 8 + i * 1e-6,
    }));

    try {
      await routingService.snapRoute(db, {
        routeId: route.id,
        provider: fakeProvider({ legShape: () => huge }),
        mode: 'auto',
      });
      expect.unreachable('should have been refused');
    } catch (cause) {
      expect(cause).toBeInstanceOf(ServiceError);
      expect((cause as Error).message).toMatch(
        new RegExp(MAX_SNAPPED_POINTS.toLocaleString()),
      );
    }

    // Untouched.
    expect(routeService.get(db, route.id).points).toHaveLength(2);
    expect(controlRepo.hasControlPoints(db, route.id)).toBe(false);
  });

  it('reports a provider that returns nothing usable', async () => {
    const route = newRoute();
    await expect(
      routingService.snapRoute(db, {
        routeId: route.id,
        provider: fakeProvider({ legShape: () => [] }),
        mode: 'auto',
      }),
    ).rejects.toThrow(/no usable road geometry/);
  });
});

// -------------------------------------------------------------------- undo

describe('snap undo', () => {
  it('restores the previous geometry and clears control points', async () => {
    const route = newRoute();
    const original = routeService.get(db, route.id).points;

    const mutation = await routingService.snapRoute(db, {
      routeId: route.id,
      provider: fakeProvider({}),
      mode: 'auto',
    });
    expect(mutation.result.undoable).toBe(true);
    expect(mutation.inverse.kind).toBe('route:restoreSnap');

    routingService.restoreSnap(
      db,
      mutation.inverse.payload as Parameters<
        typeof routingService.restoreSnap
      >[1],
    );

    expect(routeService.get(db, route.id).points).toEqual(original);
    // A route that was hand-drawn before the snap is hand-drawn again, not a
    // snapped route carrying old geometry.
    expect(controlRepo.hasControlPoints(db, route.id)).toBe(false);
    expect(routingService.provenance(db, route.id).routingProvider).toBeNull();
  });

  it('round-trips through the undo stack', async () => {
    const route = newRoute();
    const mutation = await routingService.snapRoute(db, {
      routeId: route.id,
      provider: fakeProvider({}),
      mode: 'auto',
    });

    undoService.record(mutation.inverse);
    expect(undoService.state().canUndo).toBe(true);
    undoService.undo(db);

    expect(routeService.get(db, route.id).points).toHaveLength(2);
    // Redo puts the snap back.
    undoService.redo(db);
    expect(routeService.get(db, route.id).points).toHaveLength(3);
  });

  // An inverse holding tens of thousands of points on a 50-deep stack is a
  // memory problem dressed as a convenience. Declaring it beats faking it.
  it('declares itself non-undoable above the bound rather than faking an inverse', async () => {
    const big = Array.from({ length: MAX_UNDOABLE_POINTS + 1 }, (_, i) =>
      rp(46.5 + i * 1e-6, 8 + i * 1e-6),
    );
    const route = routeService.create(db, {
      tripId,
      name: 'Big',
      colour: null,
      points: big,
    }).result;

    const mutation = await routingService.snapRoute(db, {
      routeId: route.id,
      provider: fakeProvider({ legShape: (from, to) => [from, to] }),
      mode: 'auto',
    });

    expect(mutation.result.undoable).toBe(false);
    expect(mutation.inverse.kind).toBe('none');
  });
});

// ------------------------------------------------------- road attributes

describe('road attributes', () => {
  it('matches a route and caches the result', async () => {
    const route = newRoute();
    let calls = 0;
    const provider = fakeProvider({ onCall: () => (calls += 1) });

    const first = await roadAttributeService.match(db, {
      ownerType: 'route',
      ownerId: route.id,
      provider,
      mode: 'auto',
    });

    expect(first.provider).toBe('fake');
    expect(first.edgeCount).toBe(1);
    expect(calls).toBe(1);
  });

  it('serves a second request from the cache without calling out', async () => {
    const route = newRoute();
    let calls = 0;
    const provider = fakeProvider({ onCall: () => (calls += 1) });

    await roadAttributeService.match(db, {
      ownerType: 'route',
      ownerId: route.id,
      provider,
      mode: 'auto',
    });
    await roadAttributeService.match(db, {
      ownerType: 'route',
      ownerId: route.id,
      provider,
      mode: 'auto',
    });

    expect(calls).toBe(1);
  });

  it('re-matches when asked explicitly', async () => {
    const route = newRoute();
    let calls = 0;
    const provider = fakeProvider({ onCall: () => (calls += 1) });

    await roadAttributeService.match(db, {
      ownerType: 'route',
      ownerId: route.id,
      provider,
      mode: 'auto',
    });
    await roadAttributeService.match(db, {
      ownerType: 'route',
      ownerId: route.id,
      provider,
      mode: 'auto',
      force: true,
    });

    expect(calls).toBe(2);
  });

  // The reason the cache is keyed by content hash: an edited route must never
  // be handed attributes computed for its previous shape.
  it('invalidates when the geometry changes', async () => {
    const route = newRoute();
    const provider = fakeProvider({});

    await roadAttributeService.match(db, {
      ownerType: 'route',
      ownerId: route.id,
      provider,
      mode: 'auto',
    });
    expect(
      roadAttributeService.cached(db, 'route', route.id)?.status.stale,
    ).toBe(false);

    routeService.setGeometry(db, {
      id: route.id,
      points: [rp(46.5, 8), rp(46.52, 8.02), rp(46.6, 8.1)],
    });

    expect(
      roadAttributeService.cached(db, 'route', route.id)?.status.stale,
    ).toBe(true);
  });

  it('matches a track without modifying its geometry', async () => {
    const track = trackService.createFromParsed(db, {
      tripId,
      source: 'import',
      parsed: {
        name: 'Recorded',
        segments: [
          {
            points: [
              { lat: 46.5, lon: 8, ele: 1000, time: 1_700_000_000_000 },
              { lat: 46.51, lon: 8.01, ele: 1010, time: 1_700_000_060_000 },
              { lat: 46.52, lon: 8.02, ele: 1020, time: 1_700_000_120_000 },
            ],
          },
        ],
        metadata: {},
      },
    }).result;

    const before = trackService.get(db, track.id).segments;

    await roadAttributeService.match(db, {
      ownerType: 'track',
      ownerId: track.id,
      provider: fakeProvider({}),
      mode: 'auto',
    });

    // A recording is measured data. Matching reads road attributes; it must
    // never move the samples. ADR 0011 §4.
    expect(trackService.get(db, track.id).segments).toEqual(before);
  });

  it('keeps route and track caches independent', async () => {
    const route = newRoute();
    await roadAttributeService.match(db, {
      ownerType: 'route',
      ownerId: route.id,
      provider: fakeProvider({}),
      mode: 'auto',
    });
    expect(roadAttributeService.cached(db, 'track', route.id)).toBeNull();
  });
});

// ----------------------------------------------------- speed distribution

describe('postedSpeedSamples', () => {
  const shape = [
    { lat: 46.5, lon: 8 },
    { lat: 46.51, lon: 8 },
    { lat: 46.52, lon: 8 },
    { lat: 46.53, lon: 8 },
  ];

  it('weights each edge by the distance it actually covers', () => {
    const samples = roadAttributeService.postedSpeedSamples(shape, [
      {
        startIndex: 0,
        endIndex: 1,
        lengthM: null,
        speedLimitMps: 20,
        roadClass: null,
        surface: null,
      },
      {
        startIndex: 1,
        endIndex: 3,
        lengthM: null,
        speedLimitMps: 30,
        roadClass: null,
        surface: null,
      },
    ]);

    expect(samples).toHaveLength(2);
    // The second edge spans two segments, so roughly twice the distance.
    expect(samples[1]?.distanceM).toBeCloseTo(
      (samples[0]?.distanceM ?? 0) * 2,
      0,
    );
  });

  /*
   * The half that makes the Unknown band honest. Without it, a route that
   * matched only part of its length would report a distribution over that part
   * and appear fully characterised.
   */
  it('accounts for geometry no edge covered as Unknown', () => {
    const samples = roadAttributeService.postedSpeedSamples(shape, [
      {
        startIndex: 0,
        endIndex: 1,
        lengthM: null,
        speedLimitMps: 20,
        roadClass: null,
        surface: null,
      },
    ]);

    const unknown = samples.filter((s) => s.speedMps === null);
    expect(unknown).toHaveLength(1);
    // Two of the three segments were unmatched.
    expect(unknown[0]?.distanceM).toBeCloseTo(
      (samples[0]?.distanceM ?? 0) * 2,
      0,
    );
  });

  it('adds no Unknown sample when every segment is covered', () => {
    const samples = roadAttributeService.postedSpeedSamples(shape, [
      {
        startIndex: 0,
        endIndex: 3,
        lengthM: null,
        speedLimitMps: 25,
        roadClass: null,
        surface: null,
      },
    ]);
    expect(samples.filter((s) => s.speedMps === null)).toHaveLength(0);
  });

  it('carries a null speed limit through as Unknown', () => {
    const samples = roadAttributeService.postedSpeedSamples(shape, [
      {
        startIndex: 0,
        endIndex: 3,
        lengthM: null,
        speedLimitMps: null,
        roadClass: 'unclassified',
        surface: null,
      },
    ]);
    expect(samples.every((s) => s.speedMps === null)).toBe(true);
  });
});

describe('recordedDistribution', () => {
  it('derives speed from the track timestamps', () => {
    const track = timedTrack();
    const distribution = roadAttributeService.recordedDistribution(
      db,
      track.id,
      'metric',
    );

    expect(distribution?.source).toBe('recorded');
    expect(distribution?.totalDistanceM).toBeGreaterThan(0);
    expect(distribution?.allUnknown).toBe(false);
  });

  // A different answer from "all speeds unknown": one means the question
  // cannot be asked at all.
  it('returns null for an untimed recording', () => {
    const track = trackService.createFromParsed(db, {
      tripId,
      source: 'import',
      parsed: {
        name: 'Untimed',
        segments: [
          {
            points: [
              { lat: 46.5, lon: 8, ele: null, time: null },
              { lat: 46.51, lon: 8, ele: null, time: null },
            ],
          },
        ],
        metadata: {},
      },
    }).result;

    expect(
      roadAttributeService.recordedDistribution(db, track.id, 'metric'),
    ).toBeNull();
  });

  it('labels itself recorded, never posted', () => {
    const track = timedTrack();
    expect(
      roadAttributeService.recordedDistribution(db, track.id, 'metric')?.source,
    ).toBe('recorded');
  });
});

describe('postedDistribution', () => {
  it('is null before anything is matched', () => {
    const route = newRoute();
    expect(
      roadAttributeService.postedDistribution(db, 'route', route.id, 'metric'),
    ).toBeNull();
  });

  it('labels itself posted and reports the provider', async () => {
    const route = newRoute();
    await roadAttributeService.match(db, {
      ownerType: 'route',
      ownerId: route.id,
      provider: fakeProvider({}),
      mode: 'auto',
    });

    const result = roadAttributeService.postedDistribution(
      db,
      'route',
      route.id,
      'metric',
    );
    expect(result?.distribution.source).toBe('posted');
    expect(result?.status.provider).toBe('fake');
  });

  it('reports an all-unknown route honestly', async () => {
    const route = newRoute();
    await roadAttributeService.match(db, {
      ownerType: 'route',
      ownerId: route.id,
      provider: fakeProvider({
        edges: [
          {
            startIndex: 0,
            endIndex: 1,
            lengthM: null,
            speedLimitMps: null,
            roadClass: 'unclassified',
            surface: null,
          },
        ],
      }),
      mode: 'auto',
    });

    const result = roadAttributeService.postedDistribution(
      db,
      'route',
      route.id,
      'metric',
    );
    expect(result?.distribution.allUnknown).toBe(true);
    expect(result?.distribution.unknown.percent).toBeCloseTo(100, 6);
  });
});

// ------------------------------------------- the interactive snap routing tool

/** A previewed leg, as the renderer would hand one back on finish. */
const previewed = (
  shape: { lat: number; lon: number }[],
  matched = true,
  distanceM: number | null = 100,
) => ({ matched, shape, distanceM });

describe('routeLeg', () => {
  it('returns one leg from a two-point snap', async () => {
    const leg = await routingService.routeLeg(
      fakeProvider({}),
      { lat: 46.5, lon: 8 },
      { lat: 46.52, lon: 8.02 },
      'auto',
    );

    expect(leg.matched).toBe(true);
    // The fake inserts a midpoint, so a routed leg is more than the two ends.
    expect(leg.shape).toHaveLength(3);
  });

  it('issues exactly one provider call per leg', async () => {
    let calls = 0;
    const provider = fakeProvider({
      onCall: () => {
        calls += 1;
      },
    });

    await routingService.routeLeg(
      provider,
      { lat: 46.5, lon: 8 },
      { lat: 46.51, lon: 8.01 },
      'auto',
    );

    // The whole point of the interactive tool: a click costs one call, so the
    // tenth click is no more expensive than the first.
    expect(calls).toBe(1);
  });

  // Requirement 3.6: a leg with no road path is a straight line and a report,
  // not an error that loses the user's click.
  it('reports an unmatched leg as a straight line rather than failing', async () => {
    const leg = await routingService.routeLeg(
      fakeProvider({ legShape: () => null }),
      { lat: 46.5, lon: 8 },
      { lat: 46.52, lon: 8.02 },
      'auto',
    );

    expect(leg.matched).toBe(false);
    expect(leg.shape).toEqual([
      { lat: 46.5, lon: 8 },
      { lat: 46.52, lon: 8.02 },
    ]);
    expect(leg.distanceM).toBeNull();
  });

  it('treats a provider that returns nothing usable as unmatched', async () => {
    const leg = await routingService.routeLeg(
      fakeProvider({ legShape: () => [] }),
      { lat: 46.5, lon: 8 },
      { lat: 46.52, lon: 8.02 },
      'auto',
    );

    expect(leg.matched).toBe(false);
    expect(leg.shape).toHaveLength(2);
  });
});

describe('createSnappedRoute', () => {
  const control = [
    { lat: 46.5, lon: 8 },
    { lat: 46.52, lon: 8.02 },
    { lat: 46.54, lon: 8.04 },
  ];

  it('saves the previewed geometry, not a re-route', () => {
    /*
     * A shape that deliberately detours well off the straight line. If the
     * service re-routed on save, the stored geometry would come back as
     * something else and this detour would vanish.
     */
    const detour = { lat: 46.7, lon: 8.3 };

    const mutation = routingService.createSnappedRoute(db, {
      tripId,
      name: 'Built by clicking',
      colour: null,
      controlPoints: control,
      legs: [
        previewed([control[0] as never, detour, control[1] as never]),
        previewed([control[1] as never, control[2] as never]),
      ],
      mode: 'auto',
      provider: 'fake',
    });

    const saved = routeService.get(db, mutation.result.id);
    // Four points: three leg vertices plus two, minus the shared one.
    expect(saved.points).toHaveLength(4);
    expect(saved.points[1]).toMatchObject(detour);
  });

  it('keeps the clicked points as control points', () => {
    const mutation = routingService.createSnappedRoute(db, {
      tripId,
      name: 'Route',
      colour: null,
      controlPoints: control,
      legs: [
        previewed([control[0] as never, control[1] as never]),
        previewed([control[1] as never, control[2] as never]),
      ],
      mode: 'motorcycle',
      provider: 'fake',
    });

    const stored = controlRepo.listControlPoints(db, mutation.result.id);
    expect(stored).toHaveLength(3);
    expect(stored[0]).toMatchObject({ lat: 46.5, lon: 8 });

    const provenance = routingService.provenance(db, mutation.result.id);
    expect(provenance.routingProvider).toBe('fake');
    expect(provenance.transportMode).toBe('motorcycle');
    expect(provenance.controlPointCount).toBe(3);
  });

  it('records which legs stayed straight', () => {
    const mutation = routingService.createSnappedRoute(db, {
      tripId,
      name: 'Route',
      colour: null,
      controlPoints: control,
      legs: [
        previewed([control[0] as never, control[1] as never]),
        previewed([control[1] as never, control[2] as never], false, null),
      ],
      mode: 'auto',
      provider: 'fake',
    });

    expect(
      routingService.provenance(db, mutation.result.id).unmatchedLegs,
    ).toEqual([[1, 2]]);
  });

  /*
   * A leg count that does not match the control points means the renderer's
   * preview and its points had drifted apart, so neither can be trusted. The
   * alternative — writing the legs anyway — stores a route whose control points
   * do not describe it, and a later re-snap silently produces a different line.
   */
  it('refuses a leg count that does not match the control points', () => {
    expect(() =>
      routingService.createSnappedRoute(db, {
        tripId,
        name: 'Route',
        colour: null,
        controlPoints: control,
        legs: [previewed([control[0] as never, control[1] as never])],
        mode: 'auto',
        provider: 'fake',
      }),
    ).toThrow(ServiceError);

    // And nothing was written.
    expect(routeService.listForTrip(db, tripId)).toHaveLength(0);
  });

  it('refuses fewer than two points', () => {
    expect(() =>
      routingService.createSnappedRoute(db, {
        tripId,
        name: 'Route',
        colour: null,
        controlPoints: [control[0] as never],
        legs: [],
        mode: 'auto',
        provider: 'fake',
      }),
    ).toThrow(ServiceError);
  });

  /*
   * Bounded by the undo limit rather than the higher snapped-route limit, so a
   * route built with the tool stays editable through `route:setGeometry`
   * afterwards. Producing a route this app can store but not edit would be
   * worse than refusing the last leg.
   */
  it('refuses a route past the editable point limit, naming the count', () => {
    const huge = Array.from({ length: MAX_UNDOABLE_POINTS + 10 }, (_, i) => ({
      lat: 46.5 + i * 0.00001,
      lon: 8,
    }));

    let message = '';
    try {
      routingService.createSnappedRoute(db, {
        tripId,
        name: 'Route',
        colour: null,
        controlPoints: [control[0] as never, control[1] as never],
        legs: [previewed(huge)],
        mode: 'auto',
        provider: 'fake',
      });
    } catch (error) {
      message = (error as ServiceError).message;
    }

    expect(message).toContain(MAX_UNDOABLE_POINTS.toLocaleString());
    expect(routeService.listForTrip(db, tripId)).toHaveLength(0);
  });

  it('is undoable, and the undo takes the control points with it', async () => {
    const mutation = routingService.createSnappedRoute(db, {
      tripId,
      name: 'Route',
      colour: null,
      controlPoints: control,
      legs: [
        previewed([control[0] as never, control[1] as never]),
        previewed([control[1] as never, control[2] as never]),
      ],
      mode: 'auto',
      provider: 'fake',
    });
    const id = mutation.result.id;
    undoService.record(mutation.inverse);

    expect(controlRepo.hasControlPoints(db, id)).toBe(true);

    undoService.undo(db);

    // The route is gone, and `route_control_points` cascades on delete, so no
    // orphaned control points are left behind.
    expect(routeService.listForTrip(db, tripId)).toHaveLength(0);
    expect(controlRepo.listControlPoints(db, id)).toHaveLength(0);
  });

  it('joins legs by the same rule as a whole-route snap', () => {
    const shared = { lat: 46.52, lon: 8.02 };

    const mutation = routingService.createSnappedRoute(db, {
      tripId,
      name: 'Route',
      colour: null,
      controlPoints: [control[0] as never, shared, control[2] as never],
      legs: [
        previewed([control[0] as never, shared]),
        previewed([shared, control[2] as never]),
      ],
      mode: 'auto',
      provider: 'fake',
    });

    // Three, not four: the shared vertex at the control point is dropped once,
    // exactly as `flattenLegs` does for `snapRoute`.
    expect(routeService.get(db, mutation.result.id).points).toHaveLength(3);
  });

  it('stores no elevation rather than copying it from a control point', () => {
    const mutation = routingService.createSnappedRoute(db, {
      tripId,
      name: 'Route',
      colour: null,
      controlPoints: [control[0] as never, control[1] as never],
      legs: [previewed([control[0] as never, control[1] as never])],
      mode: 'auto',
      provider: 'fake',
    });

    const saved = routeService.get(db, mutation.result.id);
    // Road vertices are different positions from the clicked points, so an
    // elevation measured elsewhere would be invented data.
    expect(saved.points.every((p) => p.ele === null)).toBe(true);
    expect(saved.elevGainM).toBeNull();
  });
});
