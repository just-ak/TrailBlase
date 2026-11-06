import type {
  RoutePoint,
  TrackSegment,
  Waypoint,
} from '@shared/domain/types';
import { isKnownSymbol, resolveSymbol } from '@shared/domain/symbols';

/**
 * GPX 1.1 writer.
 *
 * Written by hand rather than with an XML builder, for one reason: **numeric
 * precision**. A builder serialises numbers through its own formatting, and any
 * rounding there silently corrupts a round trip. Here the only number
 * formatting is `String(value)`, which is exact for a double.
 *
 * Text is escaped for XML, which is the inverse of the reader treating
 * everything as plain text. Nothing round-trips as markup.
 */

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);
}

/**
 * Exact numeric serialisation.
 *
 * `String(46.5197)` is `"46.5197"`, and `String` round-trips every double
 * exactly. `toFixed` would not: it would quietly drop or invent digits.
 */
function numberText(value: number): string {
  return String(value);
}

function isoTime(ms: number): string {
  return new Date(ms).toISOString();
}

function element(
  name: string,
  value: string | number | null,
  indent: string,
): string {
  if (value === null) return '';
  const text = typeof value === 'number' ? numberText(value) : escapeXml(value);
  return `${indent}<${name}>${text}</${name}>\n`;
}

export interface GpxWaypointInput {
  name: string;
  lat: number;
  lon: number;
  eleM: number | null;
  description: string | null;
  symbol: string | null;
  notes: string | null;
  time?: number | null;
}

export interface GpxRouteInput {
  name: string;
  points: readonly RoutePoint[];
}

export interface GpxTrackInput {
  name: string;
  segments: readonly TrackSegment[];
}

export interface WriteGpxInput {
  waypoints?: readonly GpxWaypointInput[];
  routes?: readonly GpxRouteInput[];
  tracks?: readonly GpxTrackInput[];
  /** Document-level name, usually the trip. */
  name?: string;
}

/**
 * Maps an internal symbol id to its Garmin `<sym>` name.
 *
 * An unrecognised id is written back unchanged: it almost certainly came from
 * an imported file, and substituting our own default would corrupt a round
 * trip through TrailRT.
 */
function symbolName(symbol: string | null): string | null {
  if (symbol === null) return null;
  // A symbol from our vocabulary is written as its Garmin name, so devices and
  // BaseCamp show the right icon.
  if (isKnownSymbol(symbol)) return resolveSymbol(symbol).garminName;
  // Anything else came from an imported file. Substituting our own default
  // would corrupt the round trip, so it passes through untouched.
  return symbol;
}

export function writeGpx(input: WriteGpxInput): string {
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>\n',
    '<gpx version="1.1" creator="TrailRT"\n',
    '     xmlns="http://www.topografix.com/GPX/1/1"\n',
    '     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n',
    '     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">\n',
  ];

  if (input.name !== undefined) {
    parts.push('  <metadata>\n');
    parts.push(element('name', input.name, '    '));
    parts.push('  </metadata>\n');
  }

  for (const waypoint of input.waypoints ?? []) {
    parts.push(
      `  <wpt lat="${numberText(waypoint.lat)}" lon="${numberText(waypoint.lon)}">\n`,
    );
    parts.push(element('ele', waypoint.eleM, '    '));
    parts.push(
      element('time', waypoint.time == null ? null : isoTime(waypoint.time), '    '),
    );
    parts.push(element('name', waypoint.name, '    '));
    parts.push(element('desc', waypoint.description, '    '));
    parts.push(element('cmt', waypoint.notes, '    '));
    parts.push(element('sym', symbolName(waypoint.symbol), '    '));
    parts.push('  </wpt>\n');
  }

  for (const route of input.routes ?? []) {
    parts.push('  <rte>\n');
    parts.push(element('name', route.name, '    '));
    for (const point of route.points) {
      parts.push(
        `    <rtept lat="${numberText(point.lat)}" lon="${numberText(point.lon)}">\n`,
      );
      parts.push(element('ele', point.ele, '      '));
      parts.push(element('name', point.name, '      '));
      parts.push(element('cmt', point.notes, '      '));
      parts.push(element('sym', symbolName(point.symbol), '      '));
      parts.push('    </rtept>\n');
    }
    parts.push('  </rte>\n');
  }

  for (const track of input.tracks ?? []) {
    parts.push('  <trk>\n');
    parts.push(element('name', track.name, '    '));
    for (const segment of track.segments) {
      parts.push('    <trkseg>\n');
      for (const point of segment.points) {
        parts.push(
          `      <trkpt lat="${numberText(point.lat)}" lon="${numberText(point.lon)}">\n`,
        );
        parts.push(element('ele', point.ele, '        '));
        parts.push(
          element('time', point.time === null ? null : isoTime(point.time), '        '),
        );
        parts.push('      </trkpt>\n');
      }
      parts.push('    </trkseg>\n');
    }
    parts.push('  </trk>\n');
  }

  parts.push('</gpx>\n');
  return parts.join('');
}

/** Convenience for exporting a stored waypoint without field juggling. */
export function waypointToGpx(waypoint: Waypoint): GpxWaypointInput {
  return {
    name: waypoint.name,
    lat: waypoint.lat,
    lon: waypoint.lon,
    eleM: waypoint.eleM,
    description: waypoint.description,
    symbol: waypoint.symbol,
    notes: waypoint.notes,
  };
}
