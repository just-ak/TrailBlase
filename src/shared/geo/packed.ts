/**
 * Packed polyline encoding for the track render cache.
 *
 * A 200,000-point track is about 3.2 MB as `Float64Array` pairs against roughly
 * 9 MB of JSON text, and decoding is a buffer view rather than a parse. Since
 * this is read on every map render of a large track, that difference is the
 * point.
 *
 * `Float64` rather than a fixed-point integer scheme: coordinates must survive
 * byte-identical for the fidelity guarantee, and this is a cache of values that
 * are themselves doubles. A lossy encoding here would mean the map drew
 * something subtly different from the stored data.
 *
 * The API is `Uint8Array`, not Node's `Buffer`, so this module stays usable
 * from the renderer as well as the main process. `Buffer` is a `Uint8Array`
 * subclass, so the main process can pass one straight in.
 *
 * Layout: little-endian `[lat0, lon0, lat1, lon1, …]`.
 */

export interface PackedPoint {
  lat: number;
  lon: number;
}

const BYTES_PER_POINT = 16;

export function packPolyline(points: readonly PackedPoint[]): Uint8Array {
  const array = new Float64Array(points.length * 2);
  for (const [index, point] of points.entries()) {
    array[index * 2] = point.lat;
    array[index * 2 + 1] = point.lon;
  }
  return new Uint8Array(array.buffer);
}

export function unpackPolyline(bytes: Uint8Array): PackedPoint[] {
  // A trailing partial pair means the blob was truncated. Returning nothing is
  // safe because this is a rebuildable cache, not a source of truth.
  if (bytes.byteLength % BYTES_PER_POINT !== 0) return [];

  const count = bytes.byteLength / BYTES_PER_POINT;
  const points: PackedPoint[] = [];

  // Copy rather than view: bytes arriving from SQLite are not guaranteed to be
  // 8-byte aligned, and Float64Array demands alignment.
  const aligned = new Uint8Array(bytes.byteLength);
  aligned.set(bytes);
  const array = new Float64Array(aligned.buffer);

  for (let i = 0; i < count; i += 1) {
    points.push({ lat: array[i * 2] ?? 0, lon: array[i * 2 + 1] ?? 0 });
  }
  return points;
}

export function packedPointCount(bytes: Uint8Array): number {
  return Math.floor(bytes.byteLength / BYTES_PER_POINT);
}
