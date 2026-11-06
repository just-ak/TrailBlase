import type { RoutePoint, TrackSegment } from '@shared/domain/types';

/**
 * KML 2.2 writer.
 *
 * Hand-written for the same reason as the GPX writer: an XML builder formats
 * numbers through its own code path, and any rounding there corrupts a round
 * trip. `String(value)` is exact for a double, so that is the only numeric
 * formatting here.
 *
 * Coordinates are emitted `lon,lat,ele` — KML's order, the reverse of GPX.
 * That single fact is the most common source of silently wrong KML, so it is
 * confined to `coordinate()` and tested directly.
 *
 * Elevation is omitted rather than written as 0 when absent, and
 * `altitudeMode` is only emitted when there is an altitude to interpret. A
 * `clampToGround` path with no elevation is honest; one with a fabricated 0 is
 * not.
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

function numberText(value: number): string {
  return String(value);
}

/** One KML coordinate tuple: `lon,lat[,ele]`. */
function coordinate(point: {
  lat: number;
  lon: number;
  ele: number | null;
}): string {
  const base = `${numberText(point.lon)},${numberText(point.lat)}`;
  return point.ele === null ? base : `${base},${numberText(point.ele)}`;
}

function element(
  name: string,
  value: string | null,
  indent: string,
): string {
  if (value === null) return '';
  return `${indent}<${name}>${escapeXml(value)}</${name}>\n`;
}

/** `<description>` is written as escaped plain text, never as markup. */
function describe(value: string | null, indent: string): string {
  return element('description', value, indent);
}

function extendedData(
  data: Record<string, string> | undefined,
  indent: string,
): string {
  if (data === undefined) return '';
  const keys = Object.keys(data);
  if (keys.length === 0) return '';

  const parts = [`${indent}<ExtendedData>\n`];
  for (const key of keys) {
    parts.push(
      `${indent}  <Data name="${escapeXml(key)}"><value>${escapeXml(
        data[key] ?? '',
      )}</value></Data>\n`,
    );
  }
  parts.push(`${indent}</ExtendedData>\n`);
  return parts.join('');
}

export interface KmlWaypointInput {
  name: string;
  lat: number;
  lon: number;
  eleM: number | null;
  description: string | null;
  /**
   * Round-tripped from an import; TrailRT does not interpret KML styling.
   *
   * Explicitly `| undefined` because the project runs with
   * `exactOptionalPropertyTypes`, and callers mapping over parsed objects
   * naturally produce `undefined` here.
   */
  extendedData?: Record<string, string> | undefined;
}

export interface KmlPathInput {
  name: string;
  description?: string | null | undefined;
  segments: readonly TrackSegment[];
  extendedData?: Record<string, string> | undefined;
}

export interface WriteKmlInput {
  /** Document-level name, usually the trip. */
  name?: string;
  waypoints?: readonly KmlWaypointInput[];
  /** Routes and tracks alike: KML has one path type. */
  paths?: readonly KmlPathInput[];
}

/** A route's points as a single-segment path, so one writer covers both. */
export function routeToKmlPath(
  name: string,
  points: readonly RoutePoint[],
  description: string | null = null,
): KmlPathInput {
  return {
    name,
    description,
    segments: [
      {
        points: points.map((p) => ({
          lat: p.lat,
          lon: p.lon,
          ele: p.ele,
          time: null,
        })),
      },
    ],
  };
}

function writePath(path: KmlPathInput): string {
  const parts = ['    <Placemark>\n'];
  parts.push(element('name', path.name, '      '));
  parts.push(describe(path.description ?? null, '      '));
  parts.push(extendedData(path.extendedData, '      '));

  const segments = path.segments.filter((s) => s.points.length > 0);

  // A multi-segment track becomes a MultiGeometry of LineStrings. Flattening
  // into one LineString would invent a leg across the recording break.
  const wrap = segments.length > 1;
  const indent = wrap ? '        ' : '      ';
  if (wrap) parts.push('      <MultiGeometry>\n');

  for (const segment of segments) {
    const hasElevation = segment.points.some((p) => p.ele !== null);
    parts.push(`${indent}<LineString>\n`);
    parts.push(`${indent}  <tessellate>1</tessellate>\n`);
    if (hasElevation) {
      parts.push(`${indent}  <altitudeMode>absolute</altitudeMode>\n`);
    }
    parts.push(
      `${indent}  <coordinates>${segment.points
        .map((p) => coordinate({ lat: p.lat, lon: p.lon, ele: p.ele }))
        .join(' ')}</coordinates>\n`,
    );
    parts.push(`${indent}</LineString>\n`);
  }

  if (wrap) parts.push('      </MultiGeometry>\n');
  parts.push('    </Placemark>\n');
  return parts.join('');
}

export function writeKml(input: WriteKmlInput): string {
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>\n',
    '<kml xmlns="http://www.opengis.net/kml/2.2">\n',
    '  <Document>\n',
  ];

  if (input.name !== undefined) {
    parts.push(element('name', input.name, '    '));
  }

  for (const waypoint of input.waypoints ?? []) {
    parts.push('    <Placemark>\n');
    parts.push(element('name', waypoint.name, '      '));
    parts.push(describe(waypoint.description, '      '));
    parts.push(extendedData(waypoint.extendedData, '      '));
    parts.push('      <Point>\n');
    if (waypoint.eleM !== null) {
      parts.push('        <altitudeMode>absolute</altitudeMode>\n');
    }
    parts.push(
      `        <coordinates>${coordinate({
        lat: waypoint.lat,
        lon: waypoint.lon,
        ele: waypoint.eleM,
      })}</coordinates>\n`,
    );
    parts.push('      </Point>\n');
    parts.push('    </Placemark>\n');
  }

  for (const path of input.paths ?? []) {
    parts.push(writePath(path));
  }

  parts.push('  </Document>\n');
  parts.push('</kml>\n');
  return parts.join('');
}
