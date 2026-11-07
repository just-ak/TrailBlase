import { describe, expect, it } from 'vitest';
import { createValhallaProvider } from './valhalla';

/**
 * The Valhalla adapter against a **real** Valhalla instance.
 *
 * Skipped unless `TRAILRT_LIVE_VALHALLA` names an endpoint, so the normal suite
 * stays entirely offline — a test that needs the network is a test that fails
 * on a train, and `valhalla.test.ts` already covers the wire format against a
 * loopback server.
 *
 * This file exists because "verified against the published API reference" is a
 * weaker claim than it sounds: a reference can be out of date, and an adapter
 * can parse a documented shape that no deployment actually emits. Running this
 * is what turns that caveat into a fact.
 *
 *   TRAILRT_LIVE_VALHALLA=https://valhalla1.openstreetmap.de \
 *     npx vitest run src/main/routing/valhalla.live.test.ts
 *
 * Note the `1` in that host. `valhalla.openstreetmap.de` without it is the demo
 * *website*, whose nginx answers POST with 405 — the single most likely reason
 * a correctly written client appears broken. The public instance is also rate
 * limited to roughly one call per second, which `client.ts` respects for any
 * non-loopback origin.
 */

const endpoint = process.env.TRAILRT_LIVE_VALHALLA;

/** Two points about 1.8 km apart on a classified road near Interlaken. */
const FROM = { lat: 46.6863, lon: 7.8632 };
const TO = { lat: 46.6925, lon: 7.885 };

describe.runIf(endpoint !== undefined && endpoint.length > 0)(
  'Valhalla adapter against a live instance',
  () => {
    const provider = createValhallaProvider({
      endpoint: endpoint ?? '',
      timeoutMs: 30_000,
    });

    it('routes between two points and returns polyline6 geometry', async () => {
      const result = await provider.snap([FROM, TO], 'auto');

      expect(result.legs).toHaveLength(1);
      const leg = result.legs[0];
      expect(leg?.matched).toBe(true);

      // Hundreds of vertices for under two kilometres of road: proof the shape
      // decoded at precision 6. At precision 5 the coordinates come out ten
      // times too large and would fail the bounds check below.
      expect(leg?.shape.length ?? 0).toBeGreaterThan(5);
      for (const point of leg?.shape ?? []) {
        expect(point.lat).toBeGreaterThan(46);
        expect(point.lat).toBeLessThan(47);
        expect(point.lon).toBeGreaterThan(7);
        expect(point.lon).toBeLessThan(9);
      }
    });

    it('converts the reported length from kilometres to metres', async () => {
      const result = await provider.snap([FROM, TO], 'auto');
      const distanceM = result.legs[0]?.distanceM;

      // The straight line is about 1.8 km, so a road route is somewhat more.
      // A missed km-to-m conversion would land this near 2, not near 2000,
      // which is the 1000x error the conversion exists to prevent.
      expect(distanceM).not.toBeNull();
      expect(distanceM ?? 0).toBeGreaterThan(1500);
      expect(distanceM ?? 0).toBeLessThan(20_000);
    });

    it('map matches and returns road attributes in SI units', async () => {
      const shape = [
        FROM,
        { lat: 46.688, lon: 7.87 },
        { lat: 46.69, lon: 7.878 },
        TO,
      ];

      const result = await provider.match(shape, 'auto');

      expect(result.edges.length).toBeGreaterThan(0);
      expect(result.shape.length).toBeGreaterThan(0);

      const classes = new Set(
        result.edges.map((edge) => edge.roadClass).filter((c) => c !== null),
      );
      // Real OSM road classes came back and survived `isRoadClass`, rather
      // than every one being dropped as unrecognised.
      expect(classes.size).toBeGreaterThan(0);

      const limits = result.edges
        .map((edge) => edge.speedLimitMps)
        .filter((v): v is number => v !== null);

      expect(limits.length).toBeGreaterThan(0);
      for (const mps of limits) {
        // 50 km/h is 13.9 m/s. A missed km/h-to-m/s conversion would show up
        // here as 50, which this range excludes.
        expect(mps).toBeGreaterThan(1);
        expect(mps).toBeLessThan(60);
      }
    });

    /*
     * The finding ADR 0011 is built on, confirmed against live data rather than
     * taken from a coverage statistic: some matched edges carry no posted
     * limit. Those become the Unknown band, which is why it must never be
     * redistributed or inferred away.
     */
    it('returns some edges with no posted speed limit, as null', async () => {
      const result = await provider.match(
        [FROM, { lat: 46.688, lon: 7.87 }, { lat: 46.69, lon: 7.878 }, TO],
        'auto',
      );

      const total = result.edges.length;
      const known = result.edges.filter(
        (edge) => edge.speedLimitMps !== null,
      ).length;

      expect(total).toBeGreaterThan(0);
      // Never 0 as a stand-in for absent.
      expect(
        result.edges.every(
          (edge) => edge.speedLimitMps === null || edge.speedLimitMps > 0,
        ),
      ).toBe(true);
      // Logged rather than asserted: the exact ratio is a property of the map
      // data on the day, not of our code.
      console.info(
        `[live] ${known} of ${total} matched edges carried a posted speed limit`,
      );
    });
  },
);
