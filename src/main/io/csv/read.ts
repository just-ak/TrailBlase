import { basename } from 'node:path';
import {
  emptyParsedFile,
  ParseError,
  type ParsedFile,
  type ParsedWaypoint,
} from '@shared/io/types';

/**
 * CSV waypoint reader.
 *
 * In-house rather than a library, for two reasons. The tokeniser below is about
 * forty lines and handles the whole of RFC 4180, and a dependency would still
 * leave the interesting part — deciding which column is a latitude — to us.
 *
 * Three behaviours are deliberate:
 *
 * - **Header mapping rather than refusal.** A spreadsheet exported from
 *   anywhere plausible has columns called `Lat`, `Y`, `latitude` or
 *   `Breitengrad`. Refusing a file because its header is not ours would be
 *   unhelpful when the intent is obvious. Unrecognised headers are reported so
 *   the user can see what was guessed.
 * - **Delimiter sniffing.** Comma, semicolon and tab are all in use;
 *   semicolon is what a European Excel writes. The delimiter is counted
 *   outside quotes in the header row, which is where it is least ambiguous.
 * - **An empty elevation cell is `null`, not 0.** This is the single most
 *   likely place for a fabricated sea-level reading to creep in.
 */

const DELIMITERS = [',', ';', '\t'] as const;

/**
 * Splits delimited text into rows of fields.
 *
 * Full RFC 4180: double quotes around a field, `""` for a literal quote, and
 * delimiters and newlines inside quotes. CRLF, LF and CR all end a row.
 */
export function parseDelimited(
  content: string,
  delimiter: string,
): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let index = 0;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (index < content.length) {
    const char = content[index] as string;

    if (quoted) {
      if (char === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"' && field.length === 0) {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === delimiter) {
      endField();
      index += 1;
      continue;
    }
    if (char === '\r' || char === '\n') {
      endRow();
      // Treat CRLF as one terminator rather than an empty row.
      index += char === '\r' && content[index + 1] === '\n' ? 2 : 1;
      continue;
    }

    field += char;
    index += 1;
  }

  // A file with no trailing newline still has a final row.
  if (field.length > 0 || row.length > 0) endRow();

  // A trailing newline produces one empty row, which is not data.
  return rows.filter(
    (candidate) => !(candidate.length === 1 && candidate[0] === ''),
  );
}

/** Counts a candidate delimiter outside quoted sections. */
function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && char === delimiter) count += 1;
  }
  return count;
}

export function detectDelimiter(content: string): string {
  const header = content.split(/\r?\n/, 1)[0] ?? '';
  let best = ',';
  let bestCount = 0;
  for (const candidate of DELIMITERS) {
    const count = countOutsideQuotes(header, candidate);
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Header aliases, lower-cased and stripped of anything but letters.
 *
 * `Alt (m)` becomes `altm`, `Lat.` becomes `lat`, so punctuation and units in
 * a spreadsheet header do not defeat the match.
 */
const HEADER_ALIASES: Record<string, readonly string[]> = {
  name: ['name', 'title', 'label', 'waypoint', 'wpt', 'ident', 'identifier'],
  lat: ['lat', 'latitude', 'y', 'ycoord', 'breitengrad'],
  lon: [
    'lon',
    'long',
    'lng',
    'longitude',
    'x',
    'xcoord',
    'laengengrad',
    'längengrad',
  ],
  ele: [
    'ele',
    'elev',
    'elevation',
    'alt',
    'altm',
    'altitude',
    'altitudem',
    'height',
    'heightm',
    'z',
    'elevationm',
  ],
  description: ['description', 'desc', 'notes', 'note', 'comment', 'remarks'],
  symbol: ['symbol', 'sym', 'icon', 'type', 'marker'],
  time: ['time', 'timestamp', 'date', 'datetime', 'when'],
};

function canonicalise(header: string): string {
  return header.toLowerCase().replaceAll(/[^a-z\u00C0-\u024F]/g, '');
}

export interface ColumnMap {
  name: number | null;
  lat: number | null;
  lon: number | null;
  ele: number | null;
  description: number | null;
  symbol: number | null;
  time: number | null;
  /** Header text keyed by column index, for columns with no field. */
  extra: Record<number, string>;
}

export function mapHeaders(headers: readonly string[]): ColumnMap {
  const map: ColumnMap = {
    name: null,
    lat: null,
    lon: null,
    ele: null,
    description: null,
    symbol: null,
    time: null,
    extra: {},
  };

  for (const [index, raw] of headers.entries()) {
    const key = canonicalise(raw);
    if (key.length === 0) continue;

    const field = (
      Object.keys(HEADER_ALIASES) as (keyof typeof HEADER_ALIASES)[]
    ).find(
      (candidate) =>
        map[candidate as keyof ColumnMap] === null &&
        HEADER_ALIASES[candidate]?.includes(key) === true,
    );

    if (field === undefined) {
      map.extra[index] = raw.trim();
      continue;
    }
    (map as unknown as Record<string, number>)[field] = index;
  }

  return map;
}

function cell(row: readonly string[], index: number | null): string | null {
  if (index === null) return null;
  const value = row[index];
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * A numeric cell, or null.
 *
 * `commaDecimal` is only ever true for semicolon- and tab-delimited files.
 * Rewriting `,` to `.` in a comma-delimited file would corrupt a quoted
 * thousands separator, so the substitution is gated on the delimiter rather
 * than applied hopefully.
 */
function numberCell(
  row: readonly string[],
  index: number | null,
  commaDecimal: boolean,
): number | null {
  const raw = cell(row, index);
  if (raw === null) return null;
  const normalised = commaDecimal ? raw.replace(',', '.') : raw;
  const parsed = Number(normalised);
  return Number.isFinite(parsed) ? parsed : null;
}

export function readCsv(content: string, sourcePath: string): ParsedFile {
  const file = emptyParsedFile('csv', basename(sourcePath));

  const delimiter = detectDelimiter(content);
  const rows = parseDelimited(content, delimiter);

  const headers = rows[0];
  if (headers === undefined) {
    throw new ParseError('csv', 'This CSV file is empty.');
  }

  const columns = mapHeaders(headers);
  const commaDecimal = delimiter !== ',';

  if (columns.lat === null || columns.lon === null) {
    throw new ParseError(
      'csv',
      'This CSV file has no latitude and longitude columns, so there are no waypoints to import.',
      `Header: ${headers.join(delimiter)}`,
    );
  }

  if (columns.name === null) {
    file.warnings.push(
      'No name column was found; waypoints were numbered instead.',
    );
  }

  for (const header of Object.values(columns.extra)) {
    file.unmappedMetadata.push(`CSV column "${header}"`);
  }

  for (const [offset, row] of rows.slice(1).entries()) {
    const lineNumber = offset + 2;
    const lat = numberCell(row, columns.lat, commaDecimal);
    const lon = numberCell(row, columns.lon, commaDecimal);

    if (lat === null || lon === null) {
      file.skipped.push({
        kind: 'waypoint',
        name: cell(row, columns.name) ?? `Line ${lineNumber}`,
        reason: 'Latitude or longitude was missing or not a number.',
      });
      continue;
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      file.skipped.push({
        kind: 'waypoint',
        name: cell(row, columns.name) ?? `Line ${lineNumber}`,
        reason: `Coordinates out of range (${lat}, ${lon}).`,
      });
      continue;
    }

    const metadata: Record<string, string> = {};
    for (const [index, header] of Object.entries(columns.extra)) {
      const value = cell(row, Number(index));
      if (value !== null) metadata[header] = value;
    }

    const timeText = cell(row, columns.time);
    const parsedTime = timeText === null ? null : Date.parse(timeText);

    const waypoint: ParsedWaypoint = {
      name: cell(row, columns.name) ?? `Waypoint ${offset + 1}`,
      lat,
      lon,
      // An empty elevation cell means unknown, which is null.
      ele: numberCell(row, columns.ele, commaDecimal),
      description: cell(row, columns.description),
      symbol: cell(row, columns.symbol),
      notes: null,
      time:
        parsedTime === null || Number.isNaN(parsedTime) ? null : parsedTime,
      metadata,
    };

    if (timeText !== null && waypoint.time === null) {
      file.warnings.push(
        `Line ${lineNumber}: "${timeText}" is not a date this build can read; the time was left empty.`,
      );
    }

    file.waypoints.push(waypoint);
  }

  if (file.waypoints.length === 0 && file.skipped.length === 0) {
    file.warnings.push('This CSV file has a header but no rows.');
  }

  return file;
}
