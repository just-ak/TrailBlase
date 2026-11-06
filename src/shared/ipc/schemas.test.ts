import { describe, expect, it } from 'vitest';
import {
  exportRunRequest,
  folderMoveRequest,
  importAddPathsRequest,
  importCommitRequest,
  importHistoryRequest,
  openExternalRequest,
  settingsSetRequest,
  trackGeometryRequest,
  trackSimplifyRequest,
  trackUpdateRequest,
  tripCreateRequest,
  tripSetStatusRequest,
  tripUpdateRequest,
} from './schemas';

const VALID_ID = '0190c3ae-1f2b-7c4d-9e8f-1a2b3c4d5e6f';

describe('tripCreateRequest', () => {
  it('accepts a minimal payload and applies defaults', () => {
    const parsed = tripCreateRequest.parse({ name: 'Dolomites' });
    expect(parsed).toEqual({
      name: 'Dolomites',
      folderId: null,
      description: null,
      notes: null,
    });
  });

  it('trims the name', () => {
    expect(tripCreateRequest.parse({ name: '  Alps  ' }).name).toBe('Alps');
  });

  it('rejects an empty or whitespace-only name', () => {
    expect(tripCreateRequest.safeParse({ name: '' }).success).toBe(false);
    expect(tripCreateRequest.safeParse({ name: '   ' }).success).toBe(false);
  });

  it('rejects an over-long name rather than silently truncating', () => {
    expect(
      tripCreateRequest.safeParse({ name: 'x'.repeat(201) }).success,
    ).toBe(false);
  });

  it('rejects a non-uuid folder id', () => {
    expect(
      tripCreateRequest.safeParse({ name: 'A', folderId: 'not-a-uuid' }).success,
    ).toBe(false);
  });

  it('rejects unknown keys, so a hostile payload cannot smuggle fields', () => {
    expect(
      tripCreateRequest.safeParse({ name: 'A', status: 'archived' }).success,
    ).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(tripCreateRequest.safeParse(null).success).toBe(false);
    expect(tripCreateRequest.safeParse('trip').success).toBe(false);
    expect(tripCreateRequest.safeParse(42).success).toBe(false);
  });
});

describe('tripUpdateRequest', () => {
  it('requires at least one mutable field', () => {
    expect(tripUpdateRequest.safeParse({ id: VALID_ID }).success).toBe(false);
  });

  it('accepts a single field', () => {
    expect(
      tripUpdateRequest.safeParse({ id: VALID_ID, name: 'Renamed' }).success,
    ).toBe(true);
  });

  it('allows clearing optional text with null', () => {
    expect(
      tripUpdateRequest.safeParse({ id: VALID_ID, description: null }).success,
    ).toBe(true);
  });
});

describe('tripSetStatusRequest', () => {
  it('accepts the two known statuses only', () => {
    expect(
      tripSetStatusRequest.safeParse({ id: VALID_ID, status: 'archived' }).success,
    ).toBe(true);
    expect(
      tripSetStatusRequest.safeParse({ id: VALID_ID, status: 'deleted' }).success,
    ).toBe(false);
  });
});

describe('folderMoveRequest', () => {
  it('accepts null to move to the root', () => {
    expect(
      folderMoveRequest.safeParse({ id: VALID_ID, parentId: null }).success,
    ).toBe(true);
  });

  it('requires parentId to be present', () => {
    expect(folderMoveRequest.safeParse({ id: VALID_ID }).success).toBe(false);
  });
});

describe('settingsSetRequest', () => {
  it('validates each key against its own value type', () => {
    expect(settingsSetRequest.safeParse({ key: 'theme', value: 'dark' }).success).toBe(true);
    expect(settingsSetRequest.safeParse({ key: 'theme', value: 'mauve' }).success).toBe(false);
    expect(settingsSetRequest.safeParse({ key: 'units', value: 'metric' }).success).toBe(true);
    expect(settingsSetRequest.safeParse({ key: 'units', value: 'furlongs' }).success).toBe(false);
  });

  it('rejects a value of the wrong type for the key', () => {
    expect(
      settingsSetRequest.safeParse({ key: 'backupRetention', value: 'lots' }).success,
    ).toBe(false);
    expect(
      settingsSetRequest.safeParse({ key: 'showArchivedTrips', value: 'yes' }).success,
    ).toBe(false);
  });

  it('bounds numeric settings', () => {
    expect(
      settingsSetRequest.safeParse({ key: 'backupRetention', value: 0 }).success,
    ).toBe(false);
    expect(
      settingsSetRequest.safeParse({ key: 'planningSpeedKmh', value: 0 }).success,
    ).toBe(false);
    expect(
      settingsSetRequest.safeParse({ key: 'planningSpeedKmh', value: 4.5 }).success,
    ).toBe(true);
  });

  it('validates nested map position coordinates', () => {
    expect(
      settingsSetRequest.safeParse({
        key: 'mapPosition',
        value: { lat: 46.8, lon: 8.2, zoom: 8 },
      }).success,
    ).toBe(true);
    expect(
      settingsSetRequest.safeParse({
        key: 'mapPosition',
        value: { lat: 91, lon: 8.2, zoom: 8 },
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown settings key', () => {
    expect(
      settingsSetRequest.safeParse({ key: 'telemetryEnabled', value: true }).success,
    ).toBe(false);
  });
});

describe('openExternalRequest', () => {
  it('accepts a well-formed url', () => {
    expect(
      openExternalRequest.safeParse({ url: 'https://example.org/docs' }).success,
    ).toBe(true);
  });

  it('rejects malformed input at the shape level', () => {
    expect(openExternalRequest.safeParse({ url: 'not a url' }).success).toBe(false);
    expect(openExternalRequest.safeParse({ url: 123 }).success).toBe(false);
  });
});

// ------------------------------------------------- Phase 2: routes, waypoints

import {
  routeCreateRequest,
  routePointsSchema,
  routeSetGeometryRequest,
  routeUpdateRequest,
  waypointCreateRequest,
  waypointMoveRequest,
  waypointUpdateRequest,
} from './schemas';

const POINT = { lat: 46.8, lon: 8.2 };

describe('routePointsSchema', () => {
  it('accepts an empty array, for a route being drawn', () => {
    expect(routePointsSchema.safeParse([]).success).toBe(true);
  });

  it('defaults optional point fields rather than requiring them', () => {
    const parsed = routePointsSchema.parse([POINT]);
    expect(parsed[0]).toEqual({
      lat: 46.8,
      lon: 8.2,
      ele: null,
      name: null,
      symbol: null,
      notes: null,
    });
  });

  it('rejects out-of-range coordinates', () => {
    expect(routePointsSchema.safeParse([{ lat: 91, lon: 0 }]).success).toBe(false);
    expect(routePointsSchema.safeParse([{ lat: 0, lon: 181 }]).success).toBe(false);
  });

  it('rejects non-finite coordinates', () => {
    expect(
      routePointsSchema.safeParse([{ lat: Number.NaN, lon: 0 }]).success,
    ).toBe(false);
  });

  it('accepts a null elevation but rejects an implausible one', () => {
    expect(routePointsSchema.safeParse([{ ...POINT, ele: null }]).success).toBe(true);
    expect(routePointsSchema.safeParse([{ ...POINT, ele: 2000 }]).success).toBe(true);
    // A metres/feet mix-up or a parse error should not slip through.
    expect(routePointsSchema.safeParse([{ ...POINT, ele: 99_000 }]).success).toBe(false);
    expect(routePointsSchema.safeParse([{ ...POINT, ele: -9000 }]).success).toBe(false);
  });

  it('caps the point count so one undo entry stays bounded', () => {
    const tooMany = Array.from({ length: 10_001 }, () => POINT);
    expect(routePointsSchema.safeParse(tooMany).success).toBe(false);
  });

  it('rejects unknown keys on a point', () => {
    expect(
      routePointsSchema.safeParse([{ ...POINT, speed: 3 }]).success,
    ).toBe(false);
  });
});

describe('routeCreateRequest', () => {
  it('accepts a named route with no points yet', () => {
    const parsed = routeCreateRequest.parse({ tripId: VALID_ID, name: 'Day 1' });
    expect(parsed.points).toEqual([]);
    expect(parsed.colour).toBeNull();
  });

  it('validates the colour format', () => {
    expect(
      routeCreateRequest.safeParse({ tripId: VALID_ID, name: 'A', colour: '#2563eb' })
        .success,
    ).toBe(true);
    expect(
      routeCreateRequest.safeParse({ tripId: VALID_ID, name: 'A', colour: 'blue' })
        .success,
    ).toBe(false);
  });

  it('requires a trip, since every route belongs to exactly one', () => {
    expect(routeCreateRequest.safeParse({ name: 'Orphan' }).success).toBe(false);
  });
});

describe('routeUpdateRequest', () => {
  it('requires at least one field', () => {
    expect(routeUpdateRequest.safeParse({ id: VALID_ID }).success).toBe(false);
  });

  it('allows clearing the colour', () => {
    expect(
      routeUpdateRequest.safeParse({ id: VALID_ID, colour: null }).success,
    ).toBe(true);
  });
});

describe('routeSetGeometryRequest', () => {
  it('accepts a full replacement array', () => {
    expect(
      routeSetGeometryRequest.safeParse({ id: VALID_ID, points: [POINT, POINT] })
        .success,
    ).toBe(true);
  });

  it('requires the points key explicitly', () => {
    expect(routeSetGeometryRequest.safeParse({ id: VALID_ID }).success).toBe(false);
  });
});

describe('waypointCreateRequest', () => {
  it('defaults symbol, elevation and text fields', () => {
    const parsed = waypointCreateRequest.parse({
      tripId: VALID_ID,
      name: 'Hut',
      lat: 46.8,
      lon: 8.2,
    });
    expect(parsed.symbol).toBe('pin');
    expect(parsed.eleM).toBeNull();
    expect(parsed.description).toBeNull();
    expect(parsed.groupId).toBeNull();
  });

  it('rejects coordinates outside the valid range', () => {
    expect(
      waypointCreateRequest.safeParse({
        tripId: VALID_ID,
        name: 'Bad',
        lat: -91,
        lon: 0,
      }).success,
    ).toBe(false);
  });

  it('requires both coordinates', () => {
    expect(
      waypointCreateRequest.safeParse({ tripId: VALID_ID, name: 'X', lat: 1 }).success,
    ).toBe(false);
  });
});

describe('waypointUpdateRequest', () => {
  it('requires at least one field beyond the id', () => {
    expect(waypointUpdateRequest.safeParse({ id: VALID_ID }).success).toBe(false);
  });

  it('allows a partial coordinate update', () => {
    expect(
      waypointUpdateRequest.safeParse({ id: VALID_ID, lat: 47 }).success,
    ).toBe(true);
  });

  it('still range-checks a partial coordinate update', () => {
    expect(
      waypointUpdateRequest.safeParse({ id: VALID_ID, lat: 200 }).success,
    ).toBe(false);
  });
});

describe('waypointMoveRequest', () => {
  it('requires both coordinates together', () => {
    expect(
      waypointMoveRequest.safeParse({ id: VALID_ID, lat: 46.8, lon: 8.2 }).success,
    ).toBe(true);
    expect(waypointMoveRequest.safeParse({ id: VALID_ID, lat: 46.8 }).success).toBe(
      false,
    );
  });
});

// -------------------------------------------------------- Phase 3 schemas

describe('trackUpdateRequest', () => {
  it('accepts a single field', () => {
    expect(
      trackUpdateRequest.parse({ id: VALID_ID, name: 'Walk' }),
    ).toMatchObject({ name: 'Walk' });
  });

  it('rejects a payload with nothing to change', () => {
    expect(trackUpdateRequest.safeParse({ id: VALID_ID }).success).toBe(false);
  });

  it('accepts null to clear the colour and width', () => {
    const parsed = trackUpdateRequest.parse({
      id: VALID_ID,
      colour: null,
      width: null,
    });
    expect(parsed.colour).toBeNull();
    expect(parsed.width).toBeNull();
  });

  it('rejects a colour that is not a hex triplet', () => {
    for (const colour of ['red', '#fff', '#1234567', 'rgb(1,2,3)']) {
      expect(
        trackUpdateRequest.safeParse({ id: VALID_ID, colour }).success,
        colour,
      ).toBe(false);
    }
  });

  it('bounds the line width so a stray value cannot blank the map', () => {
    expect(trackUpdateRequest.safeParse({ id: VALID_ID, width: 0 }).success).toBe(
      false,
    );
    expect(
      trackUpdateRequest.safeParse({ id: VALID_ID, width: 9999 }).success,
    ).toBe(false);
    expect(trackUpdateRequest.safeParse({ id: VALID_ID, width: 4 }).success).toBe(
      true,
    );
  });

  it('rejects an unknown field rather than ignoring it', () => {
    expect(
      trackUpdateRequest.safeParse({ id: VALID_ID, name: 'A', evil: 1 }).success,
    ).toBe(false);
  });
});

describe('trackGeometryRequest', () => {
  it('bounds the zoom to a real map range', () => {
    expect(trackGeometryRequest.safeParse({ id: VALID_ID, zoom: 12 }).success).toBe(
      true,
    );
    expect(trackGeometryRequest.safeParse({ id: VALID_ID, zoom: -1 }).success).toBe(
      false,
    );
    expect(trackGeometryRequest.safeParse({ id: VALID_ID, zoom: 99 }).success).toBe(
      false,
    );
  });
});

describe('trackSimplifyRequest', () => {
  // A zero tolerance would be a no-op presented as an edit; an unbounded one
  // would reduce a track to its endpoints without warning.
  it('requires a positive, bounded tolerance', () => {
    expect(
      trackSimplifyRequest.safeParse({ id: VALID_ID, toleranceM: 0 }).success,
    ).toBe(false);
    expect(
      trackSimplifyRequest.safeParse({ id: VALID_ID, toleranceM: -5 }).success,
    ).toBe(false);
    expect(
      trackSimplifyRequest.safeParse({ id: VALID_ID, toleranceM: 1e9 }).success,
    ).toBe(false);
    expect(
      trackSimplifyRequest.safeParse({ id: VALID_ID, toleranceM: 10 }).success,
    ).toBe(true);
  });

  it('rejects a non-finite tolerance', () => {
    expect(
      trackSimplifyRequest.safeParse({
        id: VALID_ID,
        toleranceM: Number.POSITIVE_INFINITY,
      }).success,
    ).toBe(false);
  });
});

describe('importCommitRequest', () => {
  it('accepts a single file with defaults applied', () => {
    const parsed = importCommitRequest.parse({
      files: [{ token: 'abc' }],
    });
    expect(parsed.files[0]).toMatchObject({
      token: 'abc',
      destinationTripId: null,
      retainOriginal: true,
    });
  });

  it('requires at least one file', () => {
    expect(importCommitRequest.safeParse({ files: [] }).success).toBe(false);
  });

  it('rejects an empty token', () => {
    expect(
      importCommitRequest.safeParse({ files: [{ token: '' }] }).success,
    ).toBe(false);
  });

  it('rejects a negative selection index', () => {
    expect(
      importCommitRequest.safeParse({
        files: [{ token: 'abc', routeIndices: [-1] }],
      }).success,
    ).toBe(false);
  });

  it('accepts an explicit destination trip', () => {
    const parsed = importCommitRequest.parse({
      files: [{ token: 'abc', destinationTripId: VALID_ID }],
    });
    expect(parsed.files[0]?.destinationTripId).toBe(VALID_ID);
  });

  it('rejects a destination that is not a uuid', () => {
    expect(
      importCommitRequest.safeParse({
        files: [{ token: 'abc', destinationTripId: 'nope' }],
      }).success,
    ).toBe(false);
  });
});

describe('importAddPathsRequest', () => {
  it('requires at least one path', () => {
    expect(importAddPathsRequest.safeParse({ paths: [] }).success).toBe(false);
  });

  it('bounds the number of paths', () => {
    expect(
      importAddPathsRequest.safeParse({
        paths: Array.from({ length: 201 }, () => '/tmp/a.gpx'),
      }).success,
    ).toBe(false);
  });

  it('rejects a path that is not a string', () => {
    expect(importAddPathsRequest.safeParse({ paths: [42] }).success).toBe(false);
  });
});

describe('exportRunRequest', () => {
  it('accepts each scope shape', () => {
    for (const scope of [
      { kind: 'route', id: VALID_ID },
      { kind: 'track', id: VALID_ID },
      { kind: 'waypoint', id: VALID_ID },
      { kind: 'trips', tripIds: [VALID_ID] },
      { kind: 'everything' },
    ]) {
      expect(
        exportRunRequest.safeParse({ scope, format: 'gpx' }).success,
        JSON.stringify(scope),
      ).toBe(true);
    }
  });

  // TCX and FIT are read-only by design, so they are rejected at the boundary
  // rather than relying on the service to notice.
  it('rejects a format TrailRT does not write', () => {
    for (const format of ['tcx', 'fit', 'gdb', 'img']) {
      expect(
        exportRunRequest.safeParse({
          scope: { kind: 'everything' },
          format,
        }).success,
        format,
      ).toBe(false);
    }
  });

  it('rejects an unknown scope kind', () => {
    expect(
      exportRunRequest.safeParse({
        scope: { kind: 'database', id: VALID_ID },
        format: 'gpx',
      }).success,
    ).toBe(false);
  });

  it('requires at least one trip for a trips scope', () => {
    expect(
      exportRunRequest.safeParse({
        scope: { kind: 'trips', tripIds: [] },
        format: 'gpx',
      }).success,
    ).toBe(false);
  });

  it('rejects an extra field smuggled into a scope', () => {
    expect(
      exportRunRequest.safeParse({
        scope: { kind: 'everything', path: '/etc/passwd' },
        format: 'gpx',
      }).success,
    ).toBe(false);
  });
});

describe('importHistoryRequest', () => {
  it('defaults and bounds the limit', () => {
    expect(importHistoryRequest.parse({}).limit).toBe(100);
    expect(importHistoryRequest.safeParse({ limit: 0 }).success).toBe(false);
    expect(importHistoryRequest.safeParse({ limit: 100_000 }).success).toBe(
      false,
    );
  });
});
