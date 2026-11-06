import initial from './0000_initial.sql?raw';

export interface Migration {
  /** Monotonic. Recorded in `schema_migrations` once applied. */
  version: number;
  name: string;
  sql: string;
}

/**
 * Ordered migration list. Append only — never edit an applied migration, since
 * existing installations will not re-run it.
 *
 * Regenerate SQL with `npm run db:generate` after changing `schema.ts`, then
 * add the new file here.
 */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: '0000_initial', sql: initial },
];

/** drizzle-kit's statement separator. */
export const STATEMENT_SEPARATOR = '--> statement-breakpoint';

export function splitStatements(sql: string): string[] {
  return sql
    .split(STATEMENT_SEPARATOR)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
