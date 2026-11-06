import { describe, expect, it } from 'vitest';
import { simplify, simplifyIndices, toleranceForZoom } from './simplify';
import { packedPointCount, packPolyline, unpackPolyline } from './packed';

const line = (count: number): { lat: number; lon: number }[] =>
  Array.from({ length: count }, (_, i) => ({ lat: 0, lon: i * 0.001 }));

describe('simplifyIndices', () => {
  it('keeps everything for two points or fewer', () => {
    expect(simplifyIndices([], 10)).toEqual([]);
    expect(simplifyIndices([{ lat: 0, lon: 0 }], 10)).toEqual([0]);
    expect(
      simplifyIndices([{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }], 10),
    ).toEqual([0, 1]);
  });

  it('keeps everything at zero tolerance', () => {
    const points = line(10);
    expect(simplifyIndices(points, 0)).toHaveLength(10);
  });

  it('always keeps the first and last point', () => {
    const points = line(100);
    const indices = simplifyIndices(points, 1000);
    expect(indices[0]).toBe(0);
    expect(indices.at(-1)).toBe(99);
  });

  it('collapses a straight line to its endpoints', () => {
    // Every interior point lies exactly on the line, so none is needed.
    expect(simplifyIndices(line(50), 1)).toEqual([0, 49]);
  });

  it('keeps a point that deviates beyond the tolerance', () => {
    const points = [
      { lat: 0, lon: 0 },
      { lat: 0.01, lon: 0.5 }, // ~1.1 km off the line
      { lat: 0, lon: 1 },
    ];
    expect(simplifyIndices(points, 100)).toEqual([0, 1, 2]);
  });

  it('drops a point that deviates less than the tolerance', () => {
    const points = [
      { lat: 0, lon: 0 },
      { lat: 0.000001, lon: 0.5 }, // ~0.1 m off
      { lat: 0, lon: 1 },
    ];
    expect(simplifyIndices(points, 100)).toEqual([0, 2]);
  });

  it('returns ascending indices', () => {
    const points = Array.from({ length: 200 }, (_, i) => ({
      lat: Math.sin(i / 7) * 0.01,
      lon: i * 0.001,
    }));
    const indices = simplifyIndices(points, 5);
    for (let i = 1; i < indices.length; i += 1) {
      expect(indices[i]!).toBeGreaterThan(indices[i - 1]!);
    }
  });

  it('is idempotent at the same tolerance', () => {
    const points = Array.from({ length: 500 }, (_, i) => ({
      lat: Math.sin(i / 11) * 0.02,
      lon: i * 0.0005,
    }));
    const once = simplify(points, 20);
    const twice = simplify(once, 20);
    expect(twice).toEqual(once);
  });

  it('reduces a noisy track substantially', () => {
    const points = Array.from({ length: 5000 }, (_, i) => ({
      lat: 46 + Math.sin(i / 50) * 0.01 + (i % 2) * 0.0000005,
      lon: 8 + i * 0.00002,
    }));
    const reduced = simplify(points, 10);
    expect(reduced.length).toBeLessThan(points.length / 10);
    expect(reduced[0]).toEqual(points[0]);
    expect(reduced.at(-1)).toEqual(points.at(-1));
  });

  it('handles a large track without overflowing the stack', () => {
    // The recursive formulation can nest deeply on adversarial input; this is
    // the iterative version, so it must simply finish.
    const points = Array.from({ length: 200_000 }, (_, i) => ({
      lat: 46 + (i % 3) * 0.00001,
      lon: 8 + i * 0.000001,
    }));
    expect(() => simplify(points, 5)).not.toThrow();
  });

  it('survives duplicate consecutive points', () => {
    const points = [
      { lat: 1, lon: 1 },
      { lat: 1, lon: 1 },
      { lat: 1, lon: 1 },
    ];
    expect(() => simplify(points, 5)).not.toThrow();
  });
});

describe('simplify', () => {
  it('preserves the element type, so per-point data survives', () => {
    const points = [
      { lat: 0, lon: 0, ele: 100, time: 1 },
      { lat: 0.000001, lon: 0.5, ele: 110, time: 2 },
      { lat: 0, lon: 1, ele: 120, time: 3 },
    ];
    const reduced = simplify(points, 100);
    expect(reduced).toEqual([points[0], points[2]]);
    // Elevation and time ride along rather than being stripped.
    expect(reduced[0]?.ele).toBe(100);
    expect(reduced[1]?.time).toBe(3);
  });
});

describe('toleranceForZoom', () => {
  it('shrinks as zoom increases', () => {
    expect(toleranceForZoom(5)).toBeGreaterThan(toleranceForZoom(15));
  });

  it('is sub-metre at high zoom and coarse at low zoom', () => {
    expect(toleranceForZoom(18)).toBeLessThan(1);
    expect(toleranceForZoom(4)).toBeGreaterThan(100);
  });
});

describe('packed polyline', () => {
  it('round-trips exactly, including full double precision', () => {
    const points = [
      { lat: 46.1234567890123, lon: 8.9876543210987 },
      { lat: -33.8688, lon: 151.2093 },
      { lat: 0, lon: 0 },
    ];
    const unpacked = unpackPolyline(packPolyline(points));
    // Byte-identical: a lossy cache would draw something other than the data.
    expect(unpacked).toEqual(points);
  });

  it('handles an empty polyline', () => {
    expect(unpackPolyline(packPolyline([]))).toEqual([]);
    expect(packedPointCount(packPolyline([]))).toBe(0);
  });

  it('reports the point count without decoding', () => {
    expect(packedPointCount(packPolyline(line(1000)))).toBe(1000);
  });

  it('returns nothing for a truncated blob rather than guessing', () => {
    const packed = packPolyline(line(10));
    const truncated = packed.subarray(0, packed.byteLength - 3);
    expect(unpackPolyline(truncated)).toEqual([]);
  });

  it('decodes from an unaligned source', () => {
    // SQLite blobs arrive at arbitrary offsets; Float64Array needs alignment,
    // so the implementation copies rather than viewing.
    const points = line(5);
    const packed = packPolyline(points);
    const padded = new Uint8Array(packed.byteLength + 1);
    padded.set(packed, 1);
    expect(unpackPolyline(padded.subarray(1))).toEqual(points);
  });

  it('is markedly smaller than JSON for realistic GPS coordinates', () => {
    // Full-precision coordinates, as a real recording produces. Degenerate
    // values like lat 0 with short decimals make JSON look far better than it
    // is on actual data, which is what this comparison is about.
    const points = Array.from({ length: 50_000 }, (_, i) => ({
      lat: 46.1234567 + i * 0.0000123,
      lon: 8.9876543 + i * 0.0000234,
    }));
    const packedBytes = packPolyline(points).byteLength;
    const jsonBytes = JSON.stringify(points).length;
    expect(packedBytes).toBeLessThan(jsonBytes / 2);
  });
});
