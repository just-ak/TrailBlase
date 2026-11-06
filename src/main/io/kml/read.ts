import { basename } from 'node:path';
import {
  emptyParsedFile,
  ParseError,
  type ImportFormat,
  type ParsedFile,
  type ParsedTrack,
  type ParsedTrackPoint,
  type ParsedWaypoint,
} from '@shared/io/types';
import { asArray, asRecord, ATTR, num, parseXml, text, time } from '../xml';

/**
 * KML reader.
 *
 * Three things make KML different from GPX and shape this module:
 *
 * 1. **Coordinate order is `lon,lat,ele`** — the opposite of GPX's attributes,
 *    and all three values live in one whitespace-or-comma separated text node.
 *    Getting this backwards is the classic silent KML bug, so parsing is
 *    isolated in `parseCoordinates` and tested directly.
 * 2. **Containers nest arbitrarily.** `Document` holds `Folder`s which hold
 *    `Folder`s. Rather than enumerate paths, the tree is walked recursively and
 *    folder names are carried down as a path, so a placemark's origin survives
 *    in its metadata.
 * 3. **`ExtendedData` is arbitrary user data** with no columns of its own. It
 *    is preserved verbatim in `metadata` and named in `unmappedMetadata`, per
 *    the import-fidelity rule.
 *
 * Geometry mapping, which is a judgement call rather than something KML states:
 *
 * | KML | TrailRT |
 * | --- | --- |
 * | `Point` | waypoint |
 * | `LineString` | track (one segment) |
 * | `MultiGeometry` of `LineString` | track (one segment each) |
 * | `gx:Track` | track with timestamps |
 *
 * A `LineString` becomes a track rather than a route because KML carries no
 * per-vertex names or symbols, which is what distinguishes a route in this
 * app. Importing one as a route would invent routing intent the file does not
 * express. BaseCamp makes the same choice.
 */

/** Everything in a `Placemark` that has somewhere to go. */
const PLACEMARK_KNOWN = new Set([
  'name',
  'description',
  'Point',
  'LineString',
  'MultiGeometry',
  'gx:Track',
  'ExtendedData',
  'styleUrl',
  'TimeStamp',
  'TimeSpan',
  'visibility',
  'open',
  'Style',
]);

interface Collector {
  warnings: string[];
  unmapped: Set<string>;
  skipped: { kind: string; name: string; reason: string }[];
}

export interface KmlCoordinate {
  lat: number;
  lon: number;
  ele: number | null;
}

/**
 * Parses a KML `<coordinates>` text node.
 *
 * Tuples are separated by whitespace and components by commas, but real files
 * are untidy: newlines and indentation between tuples, and a trailing comma on
 * a tuple with no altitude. Both are tolerated.
 *
 * Altitude is genuinely optional in KML. An absent third component is `null`,
 * never 0 — a point at an unknown height is not a point at sea level.
 */
export function parseCoordinates(value: unknown): KmlCoordinate[] {
  const raw = text(value);
  if (raw === null) return [];

  const coordinates: KmlCoordinate[] = [];

  for (const tuple of raw.split(/\s+/)) {
    if (tuple.length === 0) continue;
    const parts = tuple.split(',');
    // KML is lon,lat,ele. This line is the whole reason the function exists.
    const lon = num(parts[0]);
    const lat = num(parts[1]);
    if (lat === null || lon === null) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    coordinates.push({ lat, lon, ele: num(parts[2]) });
  }

  return coordinates;
}

/** `gx:coord` is space separated `lon lat ele`, not comma separated. */
function parseGxCoord(value: unknown): KmlCoordinate | null {
  const raw = text(value);
  if (raw === null) return null;
  const parts = raw.split(/\s+/);
  const lon = num(parts[0]);
  const lat = num(parts[1]);
  if (lat === null || lon === null) return null;
  return { lat, lon, ele: num(parts[2]) };
}

/**
 * `ExtendedData` as a plain object.
 *
 * Both schema-less `<Data name="…"><value>…</value></Data>` and typed
 * `<SchemaData><SimpleData name="…">` forms are handled; the latter is what
 * Google Earth writes when a `Schema` is declared.
 */
function readExtendedData(node: unknown): Record<string, string> {
  const record = asRecord(node);
  if (record === null) return {};

  const data: Record<string, string> = {};

  for (const raw of asArray(record.Data)) {
    const entry = asRecord(raw);
    if (entry === null) continue;
    const key = text(entry[`${ATTR}name`]);
    if (key === null) continue;
    data[key] = text(entry.value) ?? text(entry['#text']) ?? '';
  }

  for (const rawSchema of asArray(record.SchemaData)) {
    const schema = asRecord(rawSchema);
    if (schema === null) continue;
    for (const raw of asArray(schema.SimpleData)) {
      const entry = asRecord(raw);
      if (entry === null) continue;
      const key = text(entry[`${ATTR}name`]);
      if (key === null) continue;
      data[key] = text(entry['#text']) ?? '';
    }
  }

  return data;
}

function placemarkMetadata(
  node: Record<string, unknown>,
  folderPath: readonly string[],
  collector: Collector,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};

  const extended = readExtendedData(node.ExtendedData);
  if (Object.keys(extended).length > 0) {
    metadata.extendedData = extended;
    for (const key of Object.keys(extended)) {
      collector.unmapped.add(`KML ExtendedData "${key}"`);
    }
  }

  // The style reference is kept so an export can write it back, but TrailRT
  // does not render KML styling.
  const styleUrl = text(node.styleUrl);
  if (styleUrl !== null) metadata.styleUrl = styleUrl;

  // Folder structure is information. KML folders do not map onto TrailRT's
  // library folders (those organise trips, not objects), so the path is
  // preserved rather than discarded or wrongly translated.
  if (folderPath.length > 0) metadata.kmlFolderPath = [...folderPath];

  for (const key of Object.keys(node)) {
    if (PLACEMARK_KNOWN.has(key) || key.startsWith(ATTR) || key === '#text') {
      continue;
    }
    metadata[key] = node[key];
    collector.unmapped.add(`KML Placemark <${key}>`);
  }

  return metadata;
}

function readPoint(
  node: unknown,
  name: string,
  metadata: Record<string, unknown>,
  collector: Collector,
): ParsedWaypoint | null {
  const point = asRecord(node);
  if (point === null) return null;

  const coordinates = parseCoordinates(point.coordinates);
  const first = coordinates[0];
  if (first === undefined) {
    collector.warnings.push(
      `Placemark "${name}" has a Point with no usable coordinates.`,
    );
    return null;
  }
  if (coordinates.length > 1) {
    collector.warnings.push(
      `Placemark "${name}" has a Point with ${coordinates.length} coordinates; the first was used.`,
    );
  }

  return {
    name,
    lat: first.lat,
    lon: first.lon,
    ele: first.ele,
    description: null,
    // KML has no Garmin symbol vocabulary; styleUrl is preserved in metadata
    // instead of being guessed at.
    symbol: null,
    notes: null,
    time: null,
    metadata,
  };
}

function readGxTrack(
  node: unknown,
  name: string,
  collector: Collector,
): ParsedTrackPoint[] {
  const track = asRecord(node);
  if (track === null) return [];

  // gx:Track is two parallel sequences, not nested elements: all the <when>
  // values then all the <gx:coord> values. They are paired by position.
  const whens = asArray(track.when);
  const coords = asArray(track['gx:coord']);

  if (whens.length > 0 && whens.length !== coords.length) {
    collector.warnings.push(
      `Placemark "${name}" has ${whens.length} timestamps for ${coords.length} coordinates; the extra values were left untimed.`,
    );
  }

  const points: ParsedTrackPoint[] = [];
  for (const [index, raw] of coords.entries()) {
    const coordinate = parseGxCoord(raw);
    if (coordinate === null) continue;
    points.push({
      lat: coordinate.lat,
      lon: coordinate.lon,
      ele: coordinate.ele,
      time: whens.length === coords.length ? time(whens[index]) : null,
    });
  }
  return points;
}

function readPlacemark(
  node: Record<string, unknown>,
  index: number,
  folderPath: readonly string[],
  file: ParsedFile,
  collector: Collector,
): void {
  const name = text(node.name) ?? `Placemark ${index + 1}`;
  const description = text(node.description);
  const metadata = placemarkMetadata(node, folderPath, collector);

  let produced = false;

  for (const raw of asArray(node.Point)) {
    const waypoint = readPoint(raw, name, metadata, collector);
    if (waypoint === null) continue;
    // Description is plain text, always. KML descriptions commonly contain
    // HTML; it is never rendered as markup (architecture steering).
    waypoint.description = description;
    file.waypoints.push(waypoint);
    produced = true;
  }

  // A LineString directly on the Placemark, plus any inside a MultiGeometry,
  // become segments of one track — the Placemark is the object the user named.
  const lineStrings = [
    ...asArray(node.LineString),
    ...asArray(node.MultiGeometry).flatMap((raw) =>
      asArray(asRecord(raw)?.LineString),
    ),
  ];

  const segments: { points: ParsedTrackPoint[] }[] = [];
  for (const raw of lineStrings) {
    const line = asRecord(raw);
    if (line === null) continue;
    const coordinates = parseCoordinates(line.coordinates);
    if (coordinates.length === 0) continue;
    segments.push({
      points: coordinates.map((c) => ({
        lat: c.lat,
        lon: c.lon,
        ele: c.ele,
        // A LineString has no timestamps. Null, not a synthesised value.
        time: null,
      })),
    });
  }

  const gxPoints = readGxTrack(node['gx:Track'], name, collector);
  if (gxPoints.length > 0) segments.push({ points: gxPoints });

  if (segments.length > 0) {
    const track: ParsedTrack = {
      name,
      segments,
      metadata: description === null ? metadata : { ...metadata, description },
    };
    file.tracks.push(track);
    produced = true;
  }

  // MultiGeometry may also hold Points, which would otherwise vanish.
  for (const raw of asArray(node.MultiGeometry)) {
    const multi = asRecord(raw);
    if (multi === null) continue;
    for (const rawPoint of asArray(multi.Point)) {
      const waypoint = readPoint(rawPoint, name, metadata, collector);
      if (waypoint === null) continue;
      waypoint.description = description;
      file.waypoints.push(waypoint);
      produced = true;
    }
  }

  if (!produced) {
    const geometries = ['Polygon', 'Model', 'gx:MultiTrack']
      .filter((key) => node[key] !== undefined)
      .join(', ');
    collector.skipped.push({
      kind: 'placemark',
      name,
      reason:
        geometries.length > 0
          ? `Unsupported geometry (${geometries}). TrailRT reads points and paths.`
          : 'No point or path geometry.',
    });
  }
}

/** Walks `Document` and nested `Folder` containers, carrying the folder path. */
function walkContainer(
  node: Record<string, unknown>,
  folderPath: readonly string[],
  file: ParsedFile,
  collector: Collector,
  counter: { placemarks: number },
): void {
  for (const raw of asArray(node.Placemark)) {
    const placemark = asRecord(raw);
    if (placemark === null) continue;
    readPlacemark(placemark, counter.placemarks, folderPath, file, collector);
    counter.placemarks += 1;
  }

  // A Document's name is the document title, not a folder, so it does not
  // extend the path. A Folder's name does.
  for (const raw of asArray(node.Document)) {
    const child = asRecord(raw);
    if (child === null) continue;
    walkContainer(child, folderPath, file, collector, counter);
  }

  for (const raw of asArray(node.Folder)) {
    const child = asRecord(raw);
    if (child === null) continue;
    const name = text(child.name);
    walkContainer(
      child,
      name === null ? folderPath : [...folderPath, name],
      file,
      collector,
      counter,
    );
  }
}

export function readKml(
  content: string,
  sourcePath: string,
  format: ImportFormat = 'kml',
): ParsedFile {
  const file = emptyParsedFile(format, basename(sourcePath));
  const parsed = parseXml(content, format);

  const kml = asRecord(parsed.kml);
  if (kml === null) {
    throw new ParseError(
      format,
      'This file has no <kml> root element, so it is not a KML document.',
    );
  }

  const collector: Collector = {
    warnings: [],
    unmapped: new Set(),
    skipped: [],
  };

  // A Document is conventional but not required: Placemarks may sit directly
  // under <kml>. Both are walked, so a minimal file still imports.
  walkContainer(kml, [], file, collector, { placemarks: 0 });

  file.warnings.push(...collector.warnings);
  file.unmappedMetadata.push(...collector.unmapped);
  file.skipped.push(...collector.skipped);

  return file;
}
