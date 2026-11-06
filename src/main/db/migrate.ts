import type { Database as SqliteDatabase } from 'better-sqlite3';
import { MIGRATIONS, splitStatements, type Migration } from './migrations/index';

/**
 * Migration runner.
 *
 * Applies pending migrations inside a transaction and records them in
 * `schema_migrations`. Idempotent: running twice applies nothing the second
 * time.
 *
 * Failure is loud by design (Requirement 6.3). A half-migrated database is far
 * worse than a refusal to start, so the transaction rolls back and the caller
 * is expected to surface an actionable message rather than continue.
 */

export class MigrationError extends Error {
  readonly version: number;
  readonly statement: string | undefined;

  constructor(message: string, version: number, statement?: string) {
    super(message);
    this.name = 'MigrationError';
    this.version = version;
    this.statement = statement;
  }
}

export interface MigrationResult {
  applied: number[];
  alreadyCurrent: boolean;
  schemaVersion: number;
}

function ensureMigrationTable(sqlite: SqliteDatabase): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);
}

function appliedVersions(sqlite: SqliteDatabase): Set<number> {
  const rows = sqlite
    .prepare('SELECT version FROM schema_migrations')
    .all() as { version: number }[];
  return new Set(rows.map((r) => r.version));
}

function applyOne(sqlite: SqliteDatabase, migration: Migration): void {
  const statements = splitStatements(migration.sql);
  if (statements.length === 0) {
    throw new MigrationError(
      `Migration ${migration.name} contains no statements. The SQL was probably not bundled correctly.`,
      migration.version,
    );
  }

  let current: string | undefined;
  const run = sqlite.transaction(() => {
    for (const statement of statements) {
      current = statement;
      sqlite.exec(statement);
    }
    sqlite
      .prepare(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
      )
      .run(migration.version, migration.name, Date.now());
  });

  try {
    run();
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new MigrationError(
      `Migration ${migration.name} failed and was rolled back: ${reason}`,
      migration.version,
      current,
    );
  }
}

export function applyMigrations(sqlite: SqliteDatabase): MigrationResult {
  ensureMigrationTable(sqlite);
  const done = appliedVersions(sqlite);

  const pending = MIGRATIONS.toSorted((a, b) => a.version - b.version).filter(
    (m) => !done.has(m.version),
  );

  for (const migration of pending) {
    applyOne(sqlite, migration);
  }

  return {
    applied: pending.map((m) => m.version),
    alreadyCurrent: pending.length === 0,
    schemaVersion: expectedSchemaVersion(),
  };
}

/** Highest migration version this build knows about. */
export function expectedSchemaVersion(): number {
  const versions = [...MIGRATIONS].map((m) => m.version);
  return versions.length > 0 ? Math.max(...versions) : 0;
}
