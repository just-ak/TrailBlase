import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { ImportProgress, ImportReport } from '@shared/io/types';
import type { ImportFileSelection } from '@shared/ipc/schemas';
import type { Db } from '../db/client';
import { ServiceError } from '../services/errors';
import {
  importFiles,
  parseFile,
  previewOf,
  type FilePreview,
  type ParseResult,
} from './importService';

/**
 * Staging for files the user has chosen but not yet confirmed.
 *
 * This exists for one reason: **the renderer never holds a filesystem path.**
 * A path stays here, keyed by an opaque token, and the renderer confirms the
 * import by token. Without this, "preview then commit" would mean handing the
 * renderer a path and trusting it to send back the same one, which turns the
 * narrow preload surface into a general file-read primitive.
 *
 * State lives in the main process module rather than the database: a staged
 * file is session scope, and a half-finished import dialog should not outlive
 * the window.
 */

interface StagedFile {
  token: string;
  sourcePath: string;
  parsed: ParseResult;
  stagedAt: number;
  /** Set when the file could not be parsed, so the dialog can still show it. */
  error?: { message: string; detail?: string };
}

const staged = new Map<string, StagedFile>();

/** Bounded so a user who drops a directory of files cannot exhaust memory. */
const MAX_STAGED = 200;

/** Staging is abandoned more often than completed; stale entries are dropped. */
const STALE_MS = 60 * 60 * 1000;

export interface StagedResult {
  token: string;
  /** Basename only. The renderer needs a label, not a location. */
  sourceName: string;
  preview: FilePreview | null;
  error: { message: string; detail?: string } | null;
}

function evictStale(now: number): void {
  for (const [token, entry] of staged) {
    if (now - entry.stagedAt > STALE_MS) staged.delete(token);
  }
}

/**
 * Parses and stages files, returning previews.
 *
 * A file that fails to parse is still staged with its error rather than
 * dropped, so the dialog can list it alongside the good ones and explain why
 * it will not import. Silently showing fewer files than the user chose is
 * exactly the kind of quiet loss the fidelity rule forbids.
 */
export async function stageFiles(
  paths: readonly string[],
): Promise<StagedResult[]> {
  const now = Date.now();
  evictStale(now);

  if (staged.size + paths.length > MAX_STAGED) {
    throw new ServiceError(
      'INVALID_REQUEST',
      `Only ${MAX_STAGED} files can be staged for import at once.`,
    );
  }

  const results: StagedResult[] = [];

  for (const sourcePath of paths) {
    const token = randomUUID();
    const sourceName = basename(sourcePath);

    try {
      // Sequential: parsing a 22 MB GPX is CPU-bound in the main process, and
      // running several at once would block the UI for longer, not less.
      const parsed = await parseFile(sourcePath);
      staged.set(token, { token, sourcePath, parsed, stagedAt: now });
      results.push({
        token,
        sourceName,
        preview: previewOf(parsed),
        error: null,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const detail =
        cause instanceof ServiceError ? cause.detail : undefined;
      results.push({
        token,
        sourceName,
        preview: null,
        error: detail === undefined ? { message } : { message, detail },
      });
    }
  }

  return results;
}

export function take(token: string): StagedFile {
  const entry = staged.get(token);
  if (entry === undefined) {
    throw new ServiceError(
      'INVALID_REQUEST',
      'That file is no longer staged for import. Choose it again.',
    );
  }
  return entry;
}

export function discard(tokens: readonly string[]): void {
  if (tokens.length === 0) {
    staged.clear();
    return;
  }
  for (const token of tokens) staged.delete(token);
}

export function stagedCount(): number {
  return staged.size;
}

/** Test seam: resets module state between cases. */
export function reset(): void {
  staged.clear();
}

/**
 * Commits staged files.
 *
 * The staged selections are translated into `importFiles` requests, so the
 * transaction-per-file guarantee and the history recording come from one place
 * rather than being reimplemented for the IPC path.
 *
 * Tokens are consumed whether or not their file imported: a failed attempt
 * should not silently remain stageable, because a user clicking Import twice
 * would then get a duplicate of the half they did not expect.
 */
export async function commitStaged(
  db: Db,
  selections: readonly ImportFileSelection[],
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportReport[]> {
  const requests = selections.map((selection) => {
    const entry = take(selection.token);
    return {
      sourcePath: entry.sourcePath,
      destinationTripId: selection.destinationTripId,
      ...(selection.routeIndices === undefined
        ? {}
        : { routeIndices: selection.routeIndices }),
      ...(selection.trackIndices === undefined
        ? {}
        : { trackIndices: selection.trackIndices }),
      ...(selection.waypointIndices === undefined
        ? {}
        : { waypointIndices: selection.waypointIndices }),
      retainOriginal: selection.retainOriginal,
    };
  });

  try {
    const result = await importFiles(db, requests, onProgress);
    return result.reports;
  } finally {
    discard(selections.map((selection) => selection.token));
  }
}
