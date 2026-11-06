import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { applyMigrations, type MigrationResult } from './migrate';
import * as schema from './schema';

/**
 * SQLite client construction.
 *
 * Deliberately takes a file path rather than reaching for Electron's app paths,
 * so unit tests can point it at a temporary file (or `:memory:`) with no
 * Electron in the loop. Path resolution lives in `main/paths.ts`.
 */

export type Db = BetterSQLite3Database<typeof schema>;

export interface DbHandle {
  db: Db;
  sqlite: Database.Database;
  migration: MigrationResult;
  close(): void;
}

export interface CreateDbOptions {
  /** A file path, or ':memory:' for tests. */
  file: string;
  /** Skip migrations; only used when opening a candidate file for validation. */
  skipMigrations?: boolean;
  readonly?: boolean;
}

export function createDatabase(options: CreateDbOptions): DbHandle {
  const sqlite = new Database(options.file, {
    readonly: options.readonly ?? false,
    fileMustExist: options.readonly ?? false,
  });

  // WAL gives concurrent readers and a crash-consistent log. `synchronous` at
  // NORMAL is the usual WAL pairing: a power loss can cost the last commits but
  // cannot corrupt the file.
  if (!options.readonly) {
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('synchronous = NORMAL');
  }
  // Off by default in SQLite, and the schema leans on cascade deletes.
  sqlite.pragma('foreign_keys = ON');
  // Fail fast rather than hang if another process holds a write lock.
  sqlite.pragma('busy_timeout = 5000');

  const migration = options.skipMigrations
    ? { applied: [], alreadyCurrent: true, schemaVersion: 0 }
    : applyMigrations(sqlite);

  const db = drizzle(sqlite, { schema });

  return {
    db,
    sqlite,
    migration,
    close: () => {
      try {
        // Fold the WAL back into the main file so a copied database file is
        // complete on its own.
        sqlite.pragma('wal_checkpoint(TRUNCATE)');
      } catch {
        // A checkpoint failure on shutdown is not worth blocking quit over.
      }
      sqlite.close();
    },
  };
}

export { schema };
