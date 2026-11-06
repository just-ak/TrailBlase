import { basename } from 'node:path';
import {
  emptyParsedFile,
  ParseError,
  type ParsedFile,
  type ParsedTrackPoint,
} from '@shared/io/types';
import { asArray, asRecord, ATTR, num, parseXml, text, time } from '../xml';

/**
 * TCX reader. Read-only, deliberately.
 *
 * Writing TCX would mean inventing lap summaries, device identifiers, training
 * sessions and sport classifications that TrailRT does not hold. A file like
 * that would look like a Garmin activity export and not be one, which is worse
 * than not offering the format — see the honesty rule in
 * `.kiro/steering/architecture.md`.
 *
 * Structure: `Activities > Activity > Lap > Track > Trackpoint`. Each Activity
 * becomes one track, and each Lap becomes a **segment** of it. Laps are real
 * breaks in the recording, so flattening them would throw away information the
 * file states; joining their distances would invent travel.
 *
 * Heart rate, cadence, power and per-lap summaries have no columns here. They
 * are preserved in `metadata` and named in `unmappedMetadata` rather than
 * dropped, because an activity imported without its heart-rate data should say
 * so.
 */

/** Per-point fields TCX carries that we have no column for. */
const POINT_EXTRAS = [
  'HeartRateBpm',
  'Cadence',
  'SensorState',
  'Extensions',
  'DistanceMeters',
] as const;

interface Collector {
  warnings: string[];
  unmapped: Set<string>;
}

/** `<HeartRateBpm><Value>118</Value></HeartRateBpm>` and the plain form. */
function numericValue(node: unknown): number | null {
  const record = asRecord(node);
  if (record !== null) return num(record.Value ?? record['#text']);
  return num(node);
}

function readTrackpoint(
  node: Record<string, unknown>,
  collector: Collector,
): { point: ParsedTrackPoint; extras: Record<string, unknown> } | null {
  const position = asRecord(node.Position);
  const lat = position === null ? null : num(position.LatitudeDegrees);
  const lon = position === null ? null : num(position.LongitudeDegrees);

  // A Trackpoint with no Position is legal TCX — a treadmill sample, or a
  // moment with no GPS fix. It carries no geometry, so it is not a track point.
  if (lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    collector.warnings.push(
      `Trackpoint skipped: coordinates out of range (${lat}, ${lon}).`,
    );
    return null;
  }

  const extras: Record<string, unknown> = {};
  for (const key of POINT_EXTRAS) {
    const value = node[key];
    if (value === undefined || value === null) continue;
    const numeric = numericValue(value);
    extras[key] = numeric ?? value;
    collector.unmapped.add(`TCX Trackpoint <${key}>`);
  }

  return {
    point: {
      lat,
      lon,
      ele: num(node.AltitudeMeters),
      time: time(node.Time),
    },
    extras,
  };
}

export function readTcx(content: string, sourcePath: string): ParsedFile {
  const file = emptyParsedFile('tcx', basename(sourcePath));
  const parsed = parseXml(content, 'tcx');

  const root = asRecord(parsed.TrainingCenterDatabase);
  if (root === null) {
    throw new ParseError(
      'tcx',
      'This file has no <TrainingCenterDatabase> root element, so it is not a TCX file.',
    );
  }

  const collector: Collector = { warnings: [], unmapped: new Set() };

  const activities = asArray(asRecord(root.Activities)?.Activity);

  // Courses are a separate TCX concept — a planned route rather than a
  // recording — and are not read. Reported so the user is not left wondering.
  const courses = asArray(asRecord(root.Courses)?.Course);
  for (const raw of courses) {
    const course = asRecord(raw);
    file.skipped.push({
      kind: 'course',
      name: text(course?.Name) ?? 'Course',
      reason:
        'TCX Courses are planned routes rather than recordings; TrailRT reads activities. Export it as GPX instead.',
    });
  }

  if (activities.length === 0 && courses.length === 0) {
    file.warnings.push('This TCX file contains no activities.');
  }

  for (const [index, raw] of activities.entries()) {
    const activity = asRecord(raw);
    if (activity === null) continue;

    const sport = text(activity[`${ATTR}Sport`]);
    const id = text(activity.Id);

    const segments: { points: ParsedTrackPoint[] }[] = [];
    // Per-point extras are stored parallel to the geometry rather than mixed
    // into it, so the point arrays stay exactly the shape every other parser
    // produces.
    const pointExtras: Record<string, unknown>[][] = [];
    const laps: Record<string, unknown>[] = [];

    for (const rawLap of asArray(activity.Lap)) {
      const lap = asRecord(rawLap);
      if (lap === null) continue;

      laps.push({
        startTime: text(lap[`${ATTR}StartTime`]),
        totalTimeSeconds: num(lap.TotalTimeSeconds),
        distanceMeters: num(lap.DistanceMeters),
        calories: num(lap.Calories),
        intensity: text(lap.Intensity),
        triggerMethod: text(lap.TriggerMethod),
      });

      const points: ParsedTrackPoint[] = [];
      const extras: Record<string, unknown>[] = [];
      let positionless = 0;

      for (const rawTrack of asArray(lap.Track)) {
        const track = asRecord(rawTrack);
        if (track === null) continue;
        for (const rawPoint of asArray(track.Trackpoint)) {
          const record = asRecord(rawPoint);
          if (record === null) continue;
          const result = readTrackpoint(record, collector);
          if (result === null) {
            positionless += 1;
            continue;
          }
          points.push(result.point);
          extras.push(result.extras);
        }
      }

      if (positionless > 0) {
        file.warnings.push(
          `${positionless} trackpoint${positionless === 1 ? '' : 's'} had no position and carried no geometry.`,
        );
      }

      // Each Lap is a segment. An empty one is skipped rather than stored as a
      // hole.
      if (points.length > 0) {
        segments.push({ points });
        pointExtras.push(extras);
      }
    }

    const name =
      // The Id is an ISO timestamp in every file Garmin writes, which makes a
      // better name than "Activity 1".
      id ?? (sport === null ? `Activity ${index + 1}` : `${sport} activity`);

    if (segments.length === 0) {
      file.skipped.push({
        kind: 'activity',
        name,
        reason: 'No trackpoints with a position.',
      });
      continue;
    }

    const metadata: Record<string, unknown> = { laps, pointExtras };
    if (sport !== null) metadata.sport = sport;
    if (id !== null) metadata.activityId = id;

    const creator = asRecord(activity.Creator);
    if (creator !== null) {
      metadata.creator = creator;
      collector.unmapped.add('TCX Activity <Creator>');
    }

    collector.unmapped.add('TCX Lap summaries');
    if (sport !== null) collector.unmapped.add('TCX Activity Sport');

    file.tracks.push({ name, segments, metadata });
  }

  file.warnings.push(...collector.warnings);
  file.unmappedMetadata.push(...collector.unmapped);

  return file;
}
