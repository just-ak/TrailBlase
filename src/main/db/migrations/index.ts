import initial from './0000_initial.sql?raw';
import addObjectMetadata from './0001_add_object_metadata.sql?raw';
import routingAndAttributes from './0002_routing_and_attributes.sql?raw';

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
  // Phase 3: routes, tracks and waypoints gain a metadata column so imported
  // fields with no column of their own are preserved rather than dropped.
  { version: 2, name: '0001_add_object_metadata', sql: addObjectMetadata },
  // Phase 4: snap-to-road provenance on routes, the control points the user
  // placed, and the map-matched road-attribute cache.
  { version: 3, name: '0002_routing_and_attributes', sql: routingAndAttributes },
];

/** drizzle-kit's statement separator. */
export const STATEMENT_SEPARATOR = '--> statement-breakpoint';

export function splitStatements(sql: string): string[] {
  return sql
    .split(STATEMENT_SEPARATOR)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
