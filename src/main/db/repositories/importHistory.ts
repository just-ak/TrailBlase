import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import type { ImportHistoryEntry, ImportReport } from '@shared/io/types';
import type { Db } from '../client';
import { importHistory } from '../schema';

/**
 * Data access for the import audit trail.
 *
 * Every import is recorded, including the ones that fail. A user who imported
 * a file last week and cannot find the data needs to be able to see what the
 * app actually did with it — "it was refused, and here is why" is the answer
 * the history exists to give.
 *
 * The report is stored as JSON rather than normalised into columns. It is a
 * display artefact, not something we query by, and the alternative is five
 * tables that only ever get read back together.
 */

function decodeReport(value: string, fallback: Partial<ImportReport>): ImportReport {
  try {
    const parsed: unknown = JSON.parse(value);
    if (isReport(parsed)) return parsed;
  } catch {
    // A row written by a future version, or corrupted. The surrounding entry
    // is still useful, so a placeholder beats hiding the import entirely.
  }
  return {
    sourceName: fallback.sourceName ?? 'unknown',
    format: fallback.format ?? 'gpx',
    status: fallback.status ?? 'failed',
    imported: { routes: 0, tracks: 0, waypoints: 0, points: 0 },
    skipped: [],
    warnings: ['This import record could not be read.'],
    unmappedMetadata: [],
    destinationTripId: null,
    destinationTripName: null,
  };
}

/** Guards against a row whose JSON parses but is not an `ImportReport`. */
function isReport(value: unknown): value is ImportReport {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<ImportReport>;
  return (
    typeof candidate.imported === 'object' &&
    Array.isArray(candidate.warnings) &&
    Array.isArray(candidate.skipped)
  );
}

function rowToEntry(
  row: typeof importHistory.$inferSelect,
): ImportHistoryEntry {
  return {
    id: row.id,
    sourceName: row.sourceName,
    sourceFormat: row.sourceFormat,
    status: row.status as ImportHistoryEntry['status'],
    report: decodeReport(row.report, {
      sourceName: row.sourceName,
      status: row.status as ImportReport['status'],
    }),
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? null,
    destinationTripId: row.destinationTripId ?? null,
  };
}

/**
 * Opens a record before the work starts.
 *
 * Written first so a crash mid-import still leaves evidence that it was
 * attempted, with `finishedAt` null. A record written only on success would
 * lose exactly the cases a user needs to investigate.
 */
export function begin(
  db: Db,
  values: {
    sourceName: string;
    sourceFormat: string;
    startedAt: number;
  },
): string {
  const id = randomUUID();

  // A complete `ImportReport`, not a `{ pending: true }` marker: every reader
  // of this table expects the full shape, and a half-filled row would make the
  // in-progress and crashed cases the ones that break the history view.
  const pending: ImportReport = {
    sourceName: values.sourceName,
    format: values.sourceFormat as ImportReport['format'],
    status: 'failed',
    imported: { routes: 0, tracks: 0, waypoints: 0, points: 0 },
    skipped: [],
    warnings: ['This import did not finish.'],
    unmappedMetadata: [],
    destinationTripId: null,
    destinationTripName: null,
  };

  db.insert(importHistory)
    .values({
      id,
      sourceName: values.sourceName,
      sourceFormat: values.sourceFormat,
      destinationTripId: null,
      // Pessimistic until `finish` says otherwise, so a crash mid-import reads
      // as a failure rather than a success that never happened.
      status: 'failed',
      report: JSON.stringify(pending),
      startedAt: values.startedAt,
      finishedAt: null,
    })
    .run();
  return id;
}

export function finish(
  db: Db,
  id: string,
  values: {
    status: ImportReport['status'];
    report: ImportReport;
    destinationTripId: string | null;
    finishedAt: number;
  },
): void {
  db.update(importHistory)
    .set({
      status: values.status,
      report: JSON.stringify(values.report),
      destinationTripId: values.destinationTripId,
      finishedAt: values.finishedAt,
    })
    .where(eq(importHistory.id, id))
    .run();
}

export function list(db: Db, limit = 100): ImportHistoryEntry[] {
  return db
    .select()
    .from(importHistory)
    .orderBy(desc(importHistory.startedAt))
    .limit(limit)
    .all()
    .map(rowToEntry);
}

export function find(db: Db, id: string): ImportHistoryEntry | null {
  const row = db
    .select()
    .from(importHistory)
    .where(eq(importHistory.id, id))
    .get();
  return row === undefined ? null : rowToEntry(row);
}

export function clear(db: Db): number {
  const before = db.select().from(importHistory).all().length;
  db.delete(importHistory).run();
  return before;
}
