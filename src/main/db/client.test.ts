import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type DbHandle } from './client';
import { applyMigrations, expectedSchemaVersion } from './migrate';

let dir: string;
let handle: DbHandle;

beforeEach(() => {
  // Tests never touch the real application support directory.
  dir = mkdtempSync(join(tmpdir(), 'trailrt-db-'));
  handle = createDatabase({ file: join(dir, 'test.db') });
});

afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Columns added by a later migration, asserted separately from table names. */
const EXPECTED_METADATA_COLUMNS = ['routes', 'tracks', 'waypoints'];

const EXPECTED_TABLES = [
  'attachments',
  'folders',
  'import_history',
  'recent_items',
  'route_points',
  'routes',
  'settings',
  'track_points',
  'track_sources',
  'tracks',
  'trips',
  'waypoint_groups',
  'waypoints',
];

function tableNames(h: DbHandle): string[] {
  const rows = h.sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}

describe('migrations', () => {
  it('creates every table from the specification', () => {
    const names = tableNames(handle);
    for (const table of EXPECTED_TABLES) {
      expect(names).toContain(table);
    }
  });

  it('records every applied version', () => {
    // Grows as migrations are added; compared against the build's own notion
    // of current rather than a hardcoded list.
    expect(handle.migration.applied).toEqual([1, 2]);
    expect(handle.migration.schemaVersion).toBe(expectedSchemaVersion());
  });

  it('is idempotent on a second run', () => {
    const second = applyMigrations(handle.sqlite);
    expect(second.applied).toEqual([]);
    expect(second.alreadyCurrent).toBe(true);
  });

  it('adds the metadata columns from migration 2', () => {
    for (const table of EXPECTED_METADATA_COLUMNS) {
      const columns = (
        handle.sqlite.prepare(`PRAGMA table_info(${table})`).all() as {
          name: string;
        }[]
      ).map((c) => c.name);
      expect(columns).toContain('metadata');
    }
  });

  it('applies nothing new when reopening an existing database', () => {
    const file = join(dir, 'reopen.db');
    const first = createDatabase({ file });
    expect(first.migration.applied).toEqual([1, 2]);
    first.close();

    const second = createDatabase({ file });
    expect(second.migration.applied).toEqual([]);
    expect(tableNames(second)).toContain('trips');
    second.close();
  });
});

describe('pragmas', () => {
  it('enables WAL and foreign keys', () => {
    expect(handle.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(handle.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});

describe('referential integrity', () => {
  it('rejects a trip pointing at a folder that does not exist', () => {
    expect(() =>
      handle.sqlite
        .prepare('INSERT INTO trips (id, folder_id, name) VALUES (?, ?, ?)')
        .run('t1', 'missing-folder', 'Orphan'),
    ).toThrow(/FOREIGN KEY/i);
  });

  it('cascades a folder delete to its child folders', () => {
    handle.sqlite
      .prepare('INSERT INTO folders (id, parent_id, name) VALUES (?, ?, ?)')
      .run('f1', null, 'Europe');
    handle.sqlite
      .prepare('INSERT INTO folders (id, parent_id, name) VALUES (?, ?, ?)')
      .run('f2', 'f1', 'Alps');

    handle.sqlite.prepare('DELETE FROM folders WHERE id = ?').run('f1');
    const remaining = handle.sqlite
      .prepare('SELECT count(*) AS n FROM folders')
      .get() as { n: number };
    expect(remaining.n).toBe(0);
  });

  it('detaches trips rather than deleting them when their folder goes', () => {
    handle.sqlite
      .prepare('INSERT INTO folders (id, parent_id, name) VALUES (?, ?, ?)')
      .run('f1', null, 'Europe');
    handle.sqlite
      .prepare('INSERT INTO trips (id, folder_id, name) VALUES (?, ?, ?)')
      .run('t1', 'f1', 'Trip');

    handle.sqlite.prepare('DELETE FROM folders WHERE id = ?').run('f1');
    const trip = handle.sqlite
      .prepare('SELECT folder_id FROM trips WHERE id = ?')
      .get('t1') as { folder_id: string | null };
    expect(trip.folder_id).toBeNull();
  });

  it('cascades a trip delete to its routes and their points', () => {
    handle.sqlite
      .prepare('INSERT INTO trips (id, name) VALUES (?, ?)')
      .run('t1', 'Trip');
    handle.sqlite
      .prepare('INSERT INTO routes (id, trip_id, name) VALUES (?, ?, ?)')
      .run('r1', 't1', 'Route');
    handle.sqlite
      .prepare(
        'INSERT INTO route_points (id, route_id, seq, lat, lon) VALUES (?, ?, ?, ?, ?)',
      )
      .run('p1', 'r1', 0, 46.8, 8.2);

    handle.sqlite.prepare('DELETE FROM trips WHERE id = ?').run('t1');
    const points = handle.sqlite
      .prepare('SELECT count(*) AS n FROM route_points')
      .get() as { n: number };
    expect(points.n).toBe(0);
  });
});

describe('constraints', () => {
  it('rejects an invalid trip status', () => {
    expect(() =>
      handle.sqlite
        .prepare('INSERT INTO trips (id, name, status) VALUES (?, ?, ?)')
        .run('t1', 'Trip', 'deleted'),
    ).toThrow(/CHECK/i);
  });

  it('rejects duplicate route point sequence numbers', () => {
    handle.sqlite.prepare('INSERT INTO trips (id, name) VALUES (?, ?)').run('t1', 'T');
    handle.sqlite
      .prepare('INSERT INTO routes (id, trip_id, name) VALUES (?, ?, ?)')
      .run('r1', 't1', 'R');
    const insert = handle.sqlite.prepare(
      'INSERT INTO route_points (id, route_id, seq, lat, lon) VALUES (?, ?, ?, ?, ?)',
    );
    insert.run('p1', 'r1', 0, 1, 1);
    expect(() => insert.run('p2', 'r1', 0, 2, 2)).toThrow(/UNIQUE/i);
  });
});

describe('absent data stays absent', () => {
  it('stores missing elevation as NULL, not zero', () => {
    handle.sqlite.prepare('INSERT INTO trips (id, name) VALUES (?, ?)').run('t1', 'T');
    handle.sqlite
      .prepare('INSERT INTO routes (id, trip_id, name) VALUES (?, ?, ?)')
      .run('r1', 't1', 'R');
    handle.sqlite
      .prepare(
        'INSERT INTO route_points (id, route_id, seq, lat, lon) VALUES (?, ?, ?, ?, ?)',
      )
      .run('p1', 'r1', 0, 46.8, 8.2);

    const point = handle.sqlite
      .prepare('SELECT ele_m FROM route_points WHERE id = ?')
      .get('p1') as { ele_m: number | null };
    expect(point.ele_m).toBeNull();
    expect(point.ele_m).not.toBe(0);
  });

  it('leaves derived elevation stats NULL on a new route', () => {
    handle.sqlite.prepare('INSERT INTO trips (id, name) VALUES (?, ?)').run('t1', 'T');
    handle.sqlite
      .prepare('INSERT INTO routes (id, trip_id, name) VALUES (?, ?, ?)')
      .run('r1', 't1', 'R');
    const route = handle.sqlite
      .prepare('SELECT distance_m, elev_gain_m, elev_loss_m, point_count FROM routes WHERE id = ?')
      .get('r1') as {
      distance_m: number | null;
      elev_gain_m: number | null;
      elev_loss_m: number | null;
      point_count: number;
    };
    expect(route.elev_gain_m).toBeNull();
    expect(route.elev_loss_m).toBeNull();
    expect(route.distance_m).toBeNull();
    // A count, unlike a measurement, is legitimately zero.
    expect(route.point_count).toBe(0);
  });
});

describe('timestamps', () => {
  it('defaults to epoch milliseconds, not seconds', () => {
    handle.sqlite.prepare('INSERT INTO trips (id, name) VALUES (?, ?)').run('t1', 'T');
    const row = handle.sqlite
      .prepare('SELECT created_at FROM trips WHERE id = ?')
      .get('t1') as { created_at: number };
    // Seconds-based values would be ~1.7e9; milliseconds are ~1.7e12.
    expect(row.created_at).toBeGreaterThan(1_600_000_000_000);
    expect(Math.abs(row.created_at - Date.now())).toBeLessThan(10_000);
  });
});
