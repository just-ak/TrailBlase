import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { ParseError } from '@shared/io/types';

/**
 * Shared XML parsing for GPX, KML and TCX.
 *
 * One parser configuration for all three, so their quirks are handled in the
 * same way and there is one place that decides how attributes, entities and
 * repeated elements are represented.
 *
 * Values are **not** auto-parsed into numbers. `parseTagValue: false` keeps
 * everything as strings so this module decides what a number is: auto-parsing
 * turns an elevation of `"0"` and a missing elevation into the same falsy
 * value, and silently mangles coordinates with leading zeros.
 */

const ARRAY_PATHS = new Set([
  // GPX
  'gpx.wpt',
  'gpx.rte',
  'gpx.rte.rtept',
  'gpx.trk',
  'gpx.trk.trkseg',
  'gpx.trk.trkseg.trkpt',
  // KML
  'kml.Document.Placemark',
  'kml.Document.Folder',
  'kml.Document.Folder.Placemark',
  'kml.Document.Placemark.MultiGeometry.LineString',
  'kml.Document.Placemark.ExtendedData.Data',
  'kml.Document.Placemark.gx:Track.when',
  'kml.Document.Placemark.gx:Track.gx:coord',
  // TCX
  'TrainingCenterDatabase.Activities.Activity',
  'TrainingCenterDatabase.Activities.Activity.Lap',
  'TrainingCenterDatabase.Activities.Activity.Lap.Track',
  'TrainingCenterDatabase.Activities.Activity.Lap.Track.Trackpoint',
]);

export const ATTR = '@_';

export function createParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ATTR,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    processEntities: true,
    // Elements that may legitimately appear once are still arrays, so callers
    // never have to handle "one" and "many" differently.
    //
    // The second argument is `string | MatcherView` depending on the `jPath`
    // option; both stringify to the dotted path, so coercing covers each.
    isArray: (_name, jpath) => ARRAY_PATHS.has(String(jpath)),
  });
}

/**
 * Validates then parses, so malformed input fails with a located message
 * rather than yielding a half-populated object (Requirement 1.6).
 */
export function parseXml(
  content: string,
  format: string,
): Record<string, unknown> {
  const validation = XMLValidator.validate(content, {
    allowBooleanAttributes: true,
  });
  if (validation !== true) {
    const { err } = validation;
    throw new ParseError(
      format,
      `This file is not valid XML: ${err.msg} (line ${err.line}, column ${err.col}).`,
      err.code,
    );
  }

  try {
    return createParser().parse(content) as Record<string, unknown>;
  } catch (cause) {
    throw new ParseError(
      format,
      'This file could not be read as XML.',
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}

// --------------------------------------------------------------- readers

/**
 * A finite number, or null.
 *
 * Empty strings and unparseable values become null rather than 0, because an
 * absent elevation and a sea-level elevation are different facts.
 */
export function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Trimmed text, or null. Never an empty string, which would be noise. */
export function text(value: unknown): string | null {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** ISO 8601 to epoch milliseconds, or null. */
export function time(value: unknown): number | null {
  const raw = text(value);
  if (raw === null) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Keys that are not in the known set, for the unmapped-metadata report.
 *
 * Attributes and text nodes are skipped: they are structure, not content the
 * user would recognise as a lost field.
 */
export function unknownKeys(
  node: Record<string, unknown>,
  known: readonly string[],
): string[] {
  const knownSet = new Set(known);
  return Object.keys(node).filter(
    (key) =>
      !knownSet.has(key) && !key.startsWith(ATTR) && key !== '#text',
  );
}
