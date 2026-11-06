import type { Waypoint } from '@shared/domain/types';

/**
 * CSV waypoint writer.
 *
 * The column format is fixed and documented, because a CSV export whose columns
 * move between releases is worse than no export:
 *
 * ```
 * name,latitude,longitude,elevation,description,symbol,time
 * ```
 *
 * Two rules worth stating:
 *
 * - **An unknown value is an empty cell**, never 0 and never the word "null".
 *   `readCsv` turns an empty cell back into `null`, so the round trip holds.
 * - **Numbers are written with `String`**, which is exact for a double. A
 *   `toFixed` here would silently truncate coordinate precision.
 *
 * Tracks and routes are not exported to CSV. A path flattened into rows loses
 * the distinction between objects and is not something any tool reads back, so
 * offering it would be a misleading control.
 */

export const CSV_COLUMNS = [
  'name',
  'latitude',
  'longitude',
  'elevation',
  'description',
  'symbol',
  'time',
] as const;

/**
 * Quotes a field when it needs it.
 *
 * The leading-separator case matters: a field beginning `=`, `+`, `-` or `@` is
 * interpreted as a formula by Excel and Sheets, which is a real injection
 * vector when the content came from an imported file. Prefixing a tab keeps the
 * text intact while stopping the evaluation, and `readCsv` trims it back off.
 */
function field(value: string | null): string {
  if (value === null) return '';

  const guarded = /^[=+\-@\t\r]/.test(value) ? `\t${value}` : value;

  return /["\n\r,;\t]/.test(guarded)
    ? `"${guarded.replaceAll('"', '""')}"`
    : guarded;
}

function numberField(value: number | null): string {
  // String() round-trips a double exactly; an empty cell means unknown.
  return value === null ? '' : String(value);
}

export interface CsvWaypointInput {
  name: string;
  lat: number;
  lon: number;
  eleM: number | null;
  description: string | null;
  symbol: string | null;
  time?: number | null;
}

export function writeCsv(
  waypoints: readonly CsvWaypointInput[],
): string {
  const lines: string[] = [CSV_COLUMNS.join(',')];

  for (const waypoint of waypoints) {
    lines.push(
      [
        field(waypoint.name),
        numberField(waypoint.lat),
        numberField(waypoint.lon),
        numberField(waypoint.eleM),
        field(waypoint.description),
        field(waypoint.symbol),
        field(
          waypoint.time == null ? null : new Date(waypoint.time).toISOString(),
        ),
      ].join(','),
    );
  }

  // CRLF, which is what RFC 4180 specifies and what Excel expects.
  return `${lines.join('\r\n')}\r\n`;
}

/** Convenience for exporting a stored waypoint without field juggling. */
export function waypointToCsv(waypoint: Waypoint): CsvWaypointInput {
  return {
    name: waypoint.name,
    lat: waypoint.lat,
    lon: waypoint.lon,
    eleM: waypoint.eleM,
    description: waypoint.description,
    symbol: waypoint.symbol,
  };
}
