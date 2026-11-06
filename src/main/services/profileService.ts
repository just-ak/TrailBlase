import type { LatLon } from '@shared/geo/distance';
import { haversineDistance } from '@shared/geo/distance';
import {
  cumulativeDistances,
  elevationProfile,
  spansFromIndices,
  thinForDisplay,
  type ProfileSpan,
} from '@shared/geo/profile';
import { recordedSpeedMps } from '@shared/geo/speedBands';
import type { RoadClass, SurfaceKind } from '@shared/routing/RoutingProvider';
import type {
  AttributeOwnerType,
  Profile,
  ProfileSample,
} from '@shared/routing/results';
import type { Db } from '../db/client';
import { ServiceError } from './errors';
import * as roadAttributeService from './roadAttributeService';
import * as routeService from './routeService';
import * as trackService from './trackService';

/**
 * Assembles the data behind the profile panel.
 *
 * All the arithmetic lives here and in `shared/geo/profile.ts`, so the chart
 * component is a `<path>` and a run of `<rect>`s with nothing to get wrong.
 *
 * ## Absence is a value, not an empty array
 *
 * Every band is either present or **absent with a stated reason**. Requirement
 * 5.6 forbids drawing a band that has no data, and a reason string is the only
 * way the UI can say *why* a band is missing — no elevation in the recording is
 * a different situation from roads never having been matched, and the user can
 * act on the second one. An empty array would make them indistinguishable.
 */

/** Maximum samples sent to the renderer. A chart is a few hundred pixels wide. */
export const MAX_PROFILE_SAMPLES = 1200;

export type {
  ElevationSummary,
  Profile,
  ProfileSample,
} from '@shared/routing/results';

type SourcePoint = {
  lat: number;
  lon: number;
  ele: number | null;
  time: number | null;
};

function sourceGeometry(
  db: Db,
  ownerType: AttributeOwnerType,
  ownerId: string,
): SourcePoint[] {
  if (ownerType === 'route') {
    return routeService.get(db, ownerId).points.map((p) => ({
      lat: p.lat,
      lon: p.lon,
      ele: p.ele,
      time: null,
    }));
  }

  /*
   * A track is profiled from its **real points**, not its render cache.
   *
   * The cache carries coordinates only; elevation and timestamps are dropped
   * when it is packed, and those are two of the three bands this panel draws.
   * Reading the full points and thinning them here keeps the elevation and
   * recorded-speed curves real, and the thinning is even-sampling over a
   * monotonic axis rather than geometric simplification.
   */
  return trackService
    .get(db, ownerId)
    .segments.flatMap((segment) =>
      segment.points.map((p) => ({
        lat: p.lat,
        lon: p.lon,
        ele: p.ele,
        time: p.time,
      })),
    );
}

/**
 * Rescales distance spans from the matched geometry onto the profile axis.
 *
 * Matched edges index into the geometry that was *sent* for matching, which for
 * a track is the simplified render cache — a slightly shorter line than the
 * full points the profile is drawn from. Both describe the same route, so a
 * span is placed at the same fraction along it. The alternative, using the raw
 * distances, would leave every band drifting progressively further left as the
 * chart goes on.
 *
 * When the two lengths agree this is the identity.
 */
function rescaleSpans<T>(
  spans: readonly ProfileSpan<T>[],
  fromTotalM: number,
  toTotalM: number,
): ProfileSpan<T>[] {
  if (fromTotalM <= 0 || toTotalM <= 0 || fromTotalM === toTotalM) {
    return [...spans];
  }
  const factor = toTotalM / fromTotalM;
  return spans.map((span) => ({
    startM: span.startM * factor,
    endM: span.endM * factor,
    value: span.value,
  }));
}

/** Total length of a shape, used to compare the matched and profiled lines. */
function totalLength(points: readonly LatLon[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined) continue;
    total += haversineDistance(a, b);
  }
  return total;
}

export function profileFor(
  db: Db,
  input: {
    ownerType: AttributeOwnerType;
    ownerId: string;
    maxSamples?: number | undefined;
  },
): Profile {
  const points = sourceGeometry(db, input.ownerType, input.ownerId);

  if (points.length < 2) {
    throw new ServiceError(
      'INVALID_REQUEST',
      'There are not enough points here to draw a profile.',
    );
  }

  const distances = cumulativeDistances(points);
  const totalDistanceM = distances.at(-1) ?? 0;

  // Built at full resolution, then thinned, so the summary figures describe the
  // real data rather than the drawn subset. Thinning first would understate
  // ascent on any track with detail between samples.
  const elevation = elevationProfile(points);

  const full: ProfileSample[] = points.map((point, index) => {
    const previous = index > 0 ? points[index - 1] : undefined;
    return {
      distanceM: distances[index] ?? 0,
      lat: point.lat,
      lon: point.lon,
      eleM: point.ele,
      recordedSpeedMps:
        previous === undefined
          ? null
          : recordedSpeedMps(
              haversineDistance(previous, point),
              previous.time,
              point.time,
            ),
    };
  });

  const thinned = thinForDisplay(full, input.maxSamples ?? MAX_PROFILE_SAMPLES);

  // -------------------------------------------------------- road bands
  const entry = roadAttributeService.cached(
    db,
    input.ownerType,
    input.ownerId,
  );

  let postedSpeedSpans: ProfileSpan<number>[] | null = null;
  let postedSpeedAbsentBecause: string | null =
    'Roads have not been matched for this geometry yet.';
  let roadClassSpans: ProfileSpan<RoadClass>[] | null = null;
  let roadClassAbsentBecause: string | null = postedSpeedAbsentBecause;
  let surfaceSpans: ProfileSpan<SurfaceKind>[] | null = null;
  let surfaceAbsentBecause: string | null = postedSpeedAbsentBecause;

  if (entry !== null) {
    const matched = roadAttributeService.matchedGeometry(
      db,
      input.ownerType,
      input.ownerId,
    );
    const matchedTotalM = totalLength(matched);

    const speed = spansFromIndices(
      matched,
      entry.edges.map((edge) => ({
        startIndex: edge.startIndex,
        endIndex: edge.endIndex,
        value: edge.speedLimitMps,
      })),
    ).filter((span) => span.value !== null);

    const classes = spansFromIndices(
      matched,
      entry.edges.map((edge) => ({
        startIndex: edge.startIndex,
        endIndex: edge.endIndex,
        value: edge.roadClass,
      })),
    ).filter((span) => span.value !== null);

    const surfaces = spansFromIndices(
      matched,
      entry.edges.map((edge) => ({
        startIndex: edge.startIndex,
        endIndex: edge.endIndex,
        value: edge.surface,
      })),
    ).filter((span) => span.value !== null);

    // Each band is judged on its own data. OpenStreetMap routinely has a road
    // class for a way and no speed limit, so a present class band alongside an
    // absent speed band is the normal case rather than an inconsistency.
    if (speed.length > 0) {
      postedSpeedSpans = rescaleSpans(speed, matchedTotalM, totalDistanceM);
      postedSpeedAbsentBecause = null;
    } else {
      postedSpeedAbsentBecause =
        'The road data carries no posted speed limit for any part of this geometry.';
    }

    if (classes.length > 0) {
      roadClassSpans = rescaleSpans(classes, matchedTotalM, totalDistanceM);
      roadClassAbsentBecause = null;
    } else {
      roadClassAbsentBecause =
        'The road data carries no classification for any part of this geometry.';
    }

    if (surfaces.length > 0) {
      surfaceSpans = rescaleSpans(surfaces, matchedTotalM, totalDistanceM);
      surfaceAbsentBecause = null;
    } else {
      surfaceAbsentBecause =
        'The road data carries no surface information for any part of this geometry.';
    }
  }

  // --------------------------------------------------- recorded speed
  let recordedSpeedAbsentBecause: string | null = null;
  if (input.ownerType === 'route') {
    recordedSpeedAbsentBecause =
      'A route is a plan, so it has no recorded speed. Posted limits are shown instead.';
  } else if (full.every((sample) => sample.recordedSpeedMps === null)) {
    recordedSpeedAbsentBecause =
      'This recording has no timestamps, so no speed can be derived from it.';
  }

  return {
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    totalDistanceM,
    sourcePointCount: points.length,
    simplified: thinned.simplified,
    samples: thinned.values,

    elevation:
      elevation === null
        ? null
        : {
            minM: elevation.minM,
            maxM: elevation.maxM,
            gainM: elevation.gainM,
            lossM: elevation.lossM,
          },
    elevationAbsentBecause:
      elevation === null
        ? 'No point in this geometry carries an elevation, so there is nothing to plot. This is not the same as a flat route.'
        : null,

    postedSpeedSpans,
    postedSpeedAbsentBecause,
    roadClassSpans,
    roadClassAbsentBecause,
    surfaceSpans,
    surfaceAbsentBecause,
    recordedSpeedAbsentBecause,

    attributes: entry?.status ?? null,
  };
}
