import { describe, expect, it } from 'vitest';
import {
  folderMoveRequest,
  openExternalRequest,
  settingsSetRequest,
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
