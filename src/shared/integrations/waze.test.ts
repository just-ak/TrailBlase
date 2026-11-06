import { describe, expect, it } from 'vitest';
import { wazeNavigateUrl, wazeTargetFor } from './waze';

describe('wazeNavigateUrl', () => {
  it('builds an https link with the encoded coordinate pair', () => {
    const url = wazeNavigateUrl({ lat: 46.5, lon: 8.25 });

    // https only, and on the host the main process allowlists.
    expect(url.startsWith('https://www.waze.com/ul?')).toBe(true);
    expect(url).toContain('ll=46.500000%2C8.250000');
    expect(url).toContain('navigate=yes');
  });

  it('rounds to six decimals rather than printing a full double', () => {
    const url = wazeNavigateUrl({ lat: 46.123456789, lon: -8.987654321 });

    expect(url).toContain('ll=46.123457%2C-8.987654');
  });

  it('survives URL parsing, so the main process check can validate it', () => {
    const parsed = new URL(wazeNavigateUrl({ lat: -33.9, lon: 151.2 }));

    expect(parsed.protocol).toBe('https:');
    expect(parsed.hostname).toBe('www.waze.com');
    expect(parsed.searchParams.get('ll')).toBe('-33.900000,151.200000');
  });
});

describe('wazeTargetFor', () => {
  it('hands off a waypoint at its own position', () => {
    const target = wazeTargetFor({
      kind: 'waypoint',
      name: 'Trailhead',
      point: { lat: 46.5, lon: 8 },
    });

    expect(target?.label).toBe('Trailhead');
    expect(target?.point).toEqual({ lat: 46.5, lon: 8 });
  });

  // Not the start: the user is about to travel the route, so where it finishes
  // is the useful destination.
  it('hands off the end point of a route, and says so in the label', () => {
    const target = wazeTargetFor({
      kind: 'route',
      name: 'Alpine loop',
      points: [
        { lat: 46.5, lon: 8 },
        { lat: 46.6, lon: 8.1 },
        { lat: 46.7, lon: 8.2 },
      ],
    });

    expect(target?.point).toEqual({ lat: 46.7, lon: 8.2 });
    // The limitation is in the label, where the user cannot miss it.
    expect(target?.label).toContain('end point');
  });

  it('does the same for a track', () => {
    const target = wazeTargetFor({
      kind: 'track',
      name: 'Morning ride',
      points: [
        { lat: 1, lon: 2 },
        { lat: 3, lon: 4 },
      ],
    });

    expect(target?.point).toEqual({ lat: 3, lon: 4 });
    expect(target?.label).toContain('end point');
  });

  it('returns null for an empty geometry so the control can be disabled', () => {
    expect(
      wazeTargetFor({ kind: 'route', name: 'Empty', points: [] }),
    ).toBeNull();
  });
});
