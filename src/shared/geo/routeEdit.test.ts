import { describe, expect, it } from 'vitest';
import type { RoutePoint } from '../domain/types';
import {
  appendPoint,
  closestSegment,
  closestVertex,
  deletePoint,
  emptyPoint,
  insertPointAt,
  movePoint,
  reorderPoint,
  reversePoints,
} from './routeEdit';

const p = (lat: number, lon: number, ele: number | null = null): RoutePoint => ({
  lat,
  lon,
  ele,
  name: null,
  symbol: null,
  notes: null,
});

const LINE = [p(0, 0), p(0, 1), p(0, 2)];

describe('appendPoint', () => {
  it('adds to the end without mutating the input', () => {
    const next = appendPoint(LINE, p(0, 3));
    expect(next).toHaveLength(4);
    expect(LINE).toHaveLength(3);
  });
});

describe('movePoint', () => {
  it('updates the coordinates in place', () => {
    const next = movePoint(LINE, 1, 5, 5);
    expect(next[1]?.lat).toBe(5);
    expect(next[1]?.lon).toBe(5);
    expect(next).toHaveLength(3);
  });

  it('clears elevation, because the old value belonged to the old position', () => {
    const withEle = [p(0, 0, 100), p(0, 1, 200)];
    const next = movePoint(withEle, 1, 10, 10);
    // Keeping 200 m here would be inventing data for a place we know nothing
    // about. Null is the honest answer.
    expect(next[1]?.ele).toBeNull();
  });

  it('preserves the point\u2019s name, symbol and notes', () => {
    const named: RoutePoint[] = [
      { lat: 0, lon: 0, ele: null, name: 'Start', symbol: 'flag', notes: 'go' },
    ];
    const next = movePoint(named, 0, 1, 1);
    expect(next[0]?.name).toBe('Start');
    expect(next[0]?.symbol).toBe('flag');
    expect(next[0]?.notes).toBe('go');
  });

  it('is a no-op for an out-of-range index', () => {
    expect(movePoint(LINE, 99, 1, 1)).toEqual(LINE);
  });
});

describe('deletePoint', () => {
  it('removes the indexed point', () => {
    expect(deletePoint(LINE, 1).map((q) => q.lon)).toEqual([0, 2]);
  });

  it('ignores an out-of-range index', () => {
    expect(deletePoint(LINE, 9)).toEqual(LINE);
    expect(deletePoint(LINE, -1)).toEqual(LINE);
  });

  it('can empty a route entirely', () => {
    expect(deletePoint([p(0, 0)], 0)).toEqual([]);
  });
});

describe('insertPointAt', () => {
  it('inserts before the given index', () => {
    expect(insertPointAt(LINE, 1, p(0, 0.5)).map((q) => q.lon)).toEqual([
      0, 0.5, 1, 2,
    ]);
  });

  it('clamps an index beyond the end', () => {
    expect(insertPointAt(LINE, 99, p(0, 9)).map((q) => q.lon)).toEqual([
      0, 1, 2, 9,
    ]);
  });

  it('clamps a negative index to the start', () => {
    expect(insertPointAt(LINE, -5, p(0, 9)).map((q) => q.lon)).toEqual([
      9, 0, 1, 2,
    ]);
  });
});

describe('reversePoints', () => {
  it('reverses without mutating the input', () => {
    expect(reversePoints(LINE).map((q) => q.lon)).toEqual([2, 1, 0]);
    expect(LINE.map((q) => q.lon)).toEqual([0, 1, 2]);
  });

  it('round-trips', () => {
    expect(reversePoints(reversePoints(LINE))).toEqual(LINE);
  });
});

describe('reorderPoint', () => {
  // `to` is the index in the resulting array, after removal — the standard
  // array-move convention.
  it('moves a point to the end', () => {
    expect(reorderPoint(LINE, 0, 2).map((q) => q.lon)).toEqual([1, 2, 0]);
  });

  it('moves a point one position later', () => {
    expect(reorderPoint(LINE, 0, 1).map((q) => q.lon)).toEqual([1, 0, 2]);
  });

  it('moves a point earlier in the list', () => {
    expect(reorderPoint(LINE, 2, 0).map((q) => q.lon)).toEqual([2, 0, 1]);
  });

  it('is a no-op for an unknown source index', () => {
    expect(reorderPoint(LINE, 9, 0)).toEqual(LINE);
  });
});

describe('closestSegment', () => {
  it('returns null for a route that has no segment', () => {
    expect(closestSegment([], { lat: 0, lon: 0 })).toBeNull();
    expect(closestSegment([p(0, 0)], { lat: 0, lon: 0 })).toBeNull();
  });

  it('projects onto the nearest segment and reports where to insert', () => {
    const hit = closestSegment(LINE, { lat: 0.01, lon: 0.5 });
    expect(hit?.insertIndex).toBe(1);
    expect(hit?.lon).toBeCloseTo(0.5, 5);
    expect(hit?.lat).toBeCloseTo(0, 5);
  });

  it('picks the second segment when the click is nearer to it', () => {
    expect(closestSegment(LINE, { lat: 0, lon: 1.75 })?.insertIndex).toBe(2);
  });

  it('clamps to a vertex when the click is past the end', () => {
    const hit = closestSegment(LINE, { lat: 0, lon: 5 });
    expect(hit?.lon).toBeCloseTo(2, 5);
  });

  it('handles duplicate consecutive points without dividing by zero', () => {
    const degenerate = [p(1, 1), p(1, 1)];
    const hit = closestSegment(degenerate, { lat: 1.1, lon: 1.1 });
    expect(hit).not.toBeNull();
    expect(Number.isFinite(hit!.distanceM)).toBe(true);
  });

  it('reports a real metre distance from the click to the line', () => {
    // Roughly one degree of latitude away, so ~111 km.
    const hit = closestSegment(LINE, { lat: 1, lon: 1 });
    expect(hit!.distanceM).toBeGreaterThan(100_000);
    expect(hit!.distanceM).toBeLessThan(120_000);
  });
});

describe('closestVertex', () => {
  it('returns null for an empty route', () => {
    expect(closestVertex([], { lat: 0, lon: 0 })).toBeNull();
  });

  it('finds the nearest vertex index', () => {
    expect(closestVertex(LINE, { lat: 0, lon: 1.9 })?.index).toBe(2);
    expect(closestVertex(LINE, { lat: 0, lon: 0.1 })?.index).toBe(0);
  });
});

describe('emptyPoint', () => {
  it('starts with no elevation or annotation', () => {
    expect(emptyPoint(1, 2)).toEqual({
      lat: 1,
      lon: 2,
      ele: null,
      name: null,
      symbol: null,
      notes: null,
    });
  });
});
