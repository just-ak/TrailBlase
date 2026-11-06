import { copyFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import Database from 'better-sqlite3';
import type { BackupEntry } from '@shared/ipc/api';
import type { DbHandle } from '../db/client';
import { expectedSchemaVersion } from '../db/migrate';
import { ServiceError } from './errors';

/**
 * Backup and restore.
 *
 * Uses SQLite's own backup API rather than copying the file. Under WAL the main
 * database file alone is not a consistent snapshot — recent commits live in the
 * `-wal` sidecar — so `cp` can produce a backup that silently loses data or
 * refuses to open.
 */

const PREFIX = 'trailrt-backup-';
const SUFFIX = '.db';

/** Tables a candidate file must have before we will restore over live data. */
const REQUIRED_TABLES = ['trips', 'folders', 'settings', 'schema_migrations'];

function backupFileName(at: Date): string {
  // Sortable, filesystem-safe, no colons.
  const stamp = at.toISOString().replace(/[:.]/g, '-');
  return `${PREFIX}${stamp}${SUFFIX}`;
}

export function listBackups(backupsDir: string): BackupEntry[] {
  let names: string[];
  try {
    names = readdirSync(backupsDir);
  } catch {
    return [];
  }

  return names
    .filter((n) => n.startsWith(PREFIX) && n.endsWith(SUFFIX))
    .map((fileName) => {
      const stat = statSync(join(backupsDir, fileName));
      return {
        fileName,
        createdAt: stat.mtimeMs,
        byteSize: stat.size,
      };
    })
    .toSorted((a, b) => b.createdAt - a.createdAt);
}

/**
 * Writes a consistent snapshot. `backup()` is async in better-sqlite3 because
 * it yields between pages rather than blocking the event loop on a large file.
 */
export async function createBackup(
  handle: DbHandle,
  backupsDir: string,
  retention: number,
): Promise<BackupEntry> {
  const fileName = backupFileName(new Date());
  const target = join(backupsDir, fileName);

  await handle.sqlite.backup(target);
  pruneBackups(backupsDir, retention);

  const stat = statSync(target);
  return { fileName, createdAt: stat.mtimeMs, byteSize: stat.size };
}

/** Writes a snapshot to an arbitrary path the user chose. */
export async function createBackupAt(
  handle: DbHandle,
  targetPath: string,
): Promise<void> {
  await handle.sqlite.backup(targetPath);
}

/** Keeps the newest `retention` generations and removes the rest. */
export function pruneBackups(backupsDir: string, retention: number): string[] {
  const keep = Math.max(1, retention);
  const removed: string[] = [];
  for (const entry of listBackups(backupsDir).slice(keep)) {
    try {
      rmSync(join(backupsDir, entry.fileName), { force: true });
      removed.push(entry.fileName);
    } catch {
      // A backup that will not delete is not worth failing the operation over;
      // the next prune will try again.
    }
  }
  return removed;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  schemaVersion?: number;
}

/**
 * Opens a candidate read-only and checks it looks like a TrailRT database
 * before anything destructive happens. Requirement 9.4.
 */
export function validateBackupFile(filePath: string): ValidationResult {
  let probe: Database.Database | undefined;
  try {
    probe = new Database(filePath, { readonly: true, fileMustExist: true });

    const tables = new Set(
      (
        probe
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as { name: string }[]
      ).map((r) => r.name),
    );

    const missing = REQUIRED_TABLES.filter((t) => !tables.has(t));
    if (missing.length > 0) {
      return {
        valid: false,
        reason: `This file is not a TrailRT backup. Missing: ${missing.join(', ')}.`,
      };
    }

    const row = probe
      .prepare('SELECT max(version) AS v FROM schema_migrations')
      .get() as { v: number | null };
    const version = row.v ?? 0;

    if (version > expectedSchemaVersion()) {
      return {
        valid: false,
        reason: `This backup was made by a newer version of TrailRT (schema ${version}, this build understands ${expectedSchemaVersion()}). Update the app before restoring.`,
        schemaVersion: version,
      };
    }

    return { valid: true, schemaVersion: version };
  } catch (cause) {
    return {
      valid: false,
      reason: `That file could not be opened as a database: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    };
  } finally {
    probe?.close();
  }
}

export interface RestoreOutcome {
  /** Snapshot of the pre-restore database, so the user can undo the restore. */
  safetyBackup: string;
}

/**
 * Restores a backup over the live database.
 *
 * Order matters: validate, snapshot the current database, close it, then swap.
 * A failure at any step leaves the current database untouched.
 *
 * The caller must reopen the database afterwards; this function deliberately
 * leaves it closed rather than returning a half-live handle.
 */
export async function restoreBackup(options: {
  handle: DbHandle;
  databaseFile: string;
  backupsDir: string;
  fileName: string;
  retention: number;
}): Promise<RestoreOutcome> {
  const source = join(options.backupsDir, basename(options.fileName));

  const validation = validateBackupFile(source);
  if (!validation.valid) {
    throw new ServiceError(
      'INVALID_REQUEST',
      validation.reason ?? 'That backup file is not valid.',
    );
  }

  // Snapshot first. If anything below fails the user still has this.
  const safety = await createBackup(
    options.handle,
    options.backupsDir,
    options.retention + 1,
  );

  options.handle.close();

  try {
    copyFileSync(source, options.databaseFile);
    // The old WAL and shared-memory sidecars describe the replaced file and
    // would corrupt the restored one if SQLite found them.
    rmSync(`${options.databaseFile}-wal`, { force: true });
    rmSync(`${options.databaseFile}-shm`, { force: true });
  } catch (cause) {
    throw new ServiceError(
      'IO_ERROR',
      'The backup could not be written over the current database. Your previous data is still in the backups folder.',
      cause instanceof Error ? cause.message : String(cause),
    );
  }

  return { safetyBackup: safety.fileName };
}
