import { basename } from 'node:path';
import type { RoutePoint } from '@shared/domain/types';
import {
  emptyParsedFile,
  ParseError,
  type ParsedFile,
  type ParsedRoute,
  type ParsedTrack,
  type ParsedTrackPoint,
  type ParsedWaypoint,
} from '@shared/io/types';
import {
  asArray,
  asRecord,
  ATTR,
  num,
  parseXml,
  text,
  time,
  unknownKeys,
} from '../xml';

/**
 * GPX reader, covering 1.0 and 1.1.
 *
 * The two versions differ in namespace and in a few metadata elements, but the
 * geometry elements are identical, so one reader handles both and notes the
 * version as a warning-level detail rather than branching everywhere.
 *
 * Fidelity rules that shape this code:
 *
 * - Coordinates, elevations and times are preserved exactly as written. No
 *   rounding, no re-sampling, no interpolation.
 * - A missing value becomes `null`, never `0`.
 * - Extension namespaces have no columns, so they are preserved verbatim in
 *   `metadata` and reported as unmapped. Dropping them silently would breach
 *   the import-fidelity rule.
 * - All text is treated as plain text. Nothing here is ever rendered as markup.
 */

/**
 * Elements that map onto real columns.
 *
 * Deliberately short. Anything absent from these lists is preserved in
 * `metadata` and named in the import report, because listing an element as
 * "known" when there is nowhere to put it is precisely how data gets silently
 * dropped. `<url>`, `<hdop>`, `<magvar>` and friends all land in metadata.
 *
 * `extensions` appears here because it is handled explicitly rather than by the
 * unknown-key sweep, and would otherwise be reported twice.
 */
const WPT_KNOWN = ['ele', 'time', 'name', 'desc', 'sym', 'cmt', 'extensions'];
const TRK_KNOWN = ['name', 'trkseg', 'extensions'];
const RTE_KNOWN = ['name', 'rtept', 'extensions'];

interface Collector {
  warnings: string[];
  unmapped: Set<string>;
}

/** Records an extension or unknown element without discarding its content. */
function collectMetadata(
  node: Record<string, unknown>,
  known: readonly string[],
  context: string,
  collector: Collector,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};

  const extensions = node.extensions;
  if (extensions !== undefined && extensions !== null) {
    metadata.extensions = extensions;
    for (const key of Object.keys(asRecord(extensions) ?? {})) {
      if (key.startsWith(ATTR) || key === '#text') continue;
      collector.unmapped.add(`${context} extension <${key}>`);
    }
  }

  for (const key of unknownKeys(node, known)) {
    metadata[key] = node[key];
    collector.unmapped.add(`${context} <${key}>`);
  }

  return metadata;
}

function readCoordinates(
  node: Record<string, unknown>,
  context: string,
  collector: Collector,
): { lat: number; lon: number } | null {
  const lat = num(node[`${ATTR}lat`]);
  const lon = num(node[`${ATTR}lon`]);

  if (lat === null || lon === null) {
    collector.warnings.push(`${context} skipped: missing lat or lon.`);
    return null;
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    collector.warnings.push(
      `${context} skipped: coordinates out of range (${lat}, ${lon}).`,
    );
    return null;
  }
  return { lat, lon };
}

function readWaypoint(
  node: Record<string, unknown>,
  index: number,
  collector: Collector,
): ParsedWaypoint | null {
  const position = readCoordinates(node, `Waypoint ${index + 1}`, collector);
  if (position === null) return null;

  return {
    name: text(node.name) ?? `Waypoint ${index + 1}`,
    lat: position.lat,
    lon: position.lon,
    ele: num(node.ele),
    description: text(node.desc),
    // Kept verbatim so export can write it back even if we have no icon.
    symbol: text(node.sym),
    notes: text(node.cmt),
    time: time(node.time),
    metadata: collectMetadata(node, WPT_KNOWN, 'Waypoint', collector),
  };
}

function readRoutePoint(
  node: Record<string, unknown>,
  index: number,
  collector: Collector,
): RoutePoint | null {
  const position = readCoordinates(node, `Route point ${index + 1}`, collector);
  if (position === null) return null;
  return {
    lat: position.lat,
    lon: position.lon,
    ele: num(node.ele),
    name: text(node.name),
    symbol: text(node.sym),
    notes: text(node.cmt),
  };
}

function readRoute(
  node: Record<string, unknown>,
  index: number,
  collector: Collector,
): ParsedRoute | null {
  const points: RoutePoint[] = [];
  for (const [pointIndex, raw] of asArray(node.rtept).entries()) {
    const record = asRecord(raw);
    if (record === null) continue;
    const point = readRoutePoint(record, pointIndex, collector);
    if (point !== null) points.push(point);
  }

  const name = text(node.name) ?? `Route ${index + 1}`;
  if (points.length === 0) {
    collector.warnings.push(`Route "${name}" has no usable points.`);
    return null;
  }

  return {
    name,
    points,
    metadata: collectMetadata(node, RTE_KNOWN, 'Route', collector),
  };
}

function readTrack(
  node: Record<string, unknown>,
  index: number,
  collector: Collector,
): ParsedTrack | null {
  const segments: { points: ParsedTrackPoint[] }[] = [];

  for (const rawSegment of asArray(node.trkseg)) {
    const segmentRecord = asRecord(rawSegment);
    if (segmentRecord === null) continue;

    const points: ParsedTrackPoint[] = [];
    for (const [pointIndex, raw] of asArray(segmentRecord.trkpt).entries()) {
      const record = asRecord(raw);
      if (record === null) continue;
      const position = readCoordinates(
        record,
        `Track point ${pointIndex + 1}`,
        collector,
      );
      if (position === null) continue;
      points.push({
        lat: position.lat,
        lon: position.lon,
        ele: num(record.ele),
        time: time(record.time),
      });
    }

    // An empty segment carries no information, but its existence does not
    // either — skip it rather than storing a hole.
    if (points.length > 0) segments.push({ points });
  }

  const name = text(node.name) ?? `Track ${index + 1}`;
  if (segments.length === 0) {
    collector.warnings.push(`Track "${name}" has no usable points.`);
    return null;
  }

  return {
    name,
    segments,
    metadata: collectMetadata(node, TRK_KNOWN, 'Track', collector),
  };
}

export function readGpx(content: string, sourcePath: string): ParsedFile {
  const file = emptyParsedFile('gpx', basename(sourcePath));
  const parsed = parseXml(content, 'gpx');

  const gpx = asRecord(parsed.gpx);
  if (gpx === null) {
    throw new ParseError(
      'gpx',
      'This file has no <gpx> root element, so it is not a GPX file.',
    );
  }

  const version = text(gpx[`${ATTR}version`]);
  if (version !== null && version !== '1.0' && version !== '1.1') {
    file.warnings.push(
      `GPX version ${version} is not one this build knows; read as 1.1.`,
    );
  }

  const collector: Collector = { warnings: [], unmapped: new Set() };

  for (const [index, raw] of asArray(gpx.wpt).entries()) {
    const record = asRecord(raw);
    if (record === null) continue;
    const waypoint = readWaypoint(record, index, collector);
    if (waypoint === null) {
      file.skipped.push({
        kind: 'waypoint',
        name: `Waypoint ${index + 1}`,
        reason: 'Missing or out-of-range coordinates.',
      });
      continue;
    }
    file.waypoints.push(waypoint);
  }

  for (const [index, raw] of asArray(gpx.rte).entries()) {
    const record = asRecord(raw);
    if (record === null) continue;
    const route = readRoute(record, index, collector);
    if (route === null) {
      file.skipped.push({
        kind: 'route',
        name: text(record.name) ?? `Route ${index + 1}`,
        reason: 'No usable points.',
      });
      continue;
    }
    file.routes.push(route);
  }

  for (const [index, raw] of asArray(gpx.trk).entries()) {
    const record = asRecord(raw);
    if (record === null) continue;
    const track = readTrack(record, index, collector);
    if (track === null) {
      file.skipped.push({
        kind: 'track',
        name: text(record.name) ?? `Track ${index + 1}`,
        reason: 'No usable points.',
      });
      continue;
    }
    file.tracks.push(track);
  }

  file.warnings.push(...collector.warnings);
  file.unmappedMetadata.push(...collector.unmapped);

  return file;
}
