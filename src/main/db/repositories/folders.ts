import { asc, eq, sql } from 'drizzle-orm';
import type { Folder } from '@shared/domain/types';
import type { Db } from '../client';
import { folders, trips } from '../schema';

/** Thin data access for folders. Invariants live in the service above this. */

export function rowToFolder(row: typeof folders.$inferSelect): Folder {
  return {
    id: row.id,
    parentId: row.parentId ?? null,
    name: row.name,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listFolders(db: Db): Folder[] {
  return db
    .select()
    .from(folders)
    .orderBy(asc(folders.sortOrder), asc(folders.name))
    .all()
    .map(rowToFolder);
}

export function findFolder(db: Db, id: string): Folder | null {
  const row = db.select().from(folders).where(eq(folders.id, id)).get();
  return row ? rowToFolder(row) : null;
}

export function insertFolder(
  db: Db,
  values: { id: string; parentId: string | null; name: string; now: number },
): Folder {
  db.insert(folders)
    .values({
      id: values.id,
      parentId: values.parentId,
      name: values.name,
      createdAt: values.now,
      updatedAt: values.now,
    })
    .run();
  const created = findFolder(db, values.id);
  if (created === null) {
    throw new Error(`Folder ${values.id} vanished immediately after insert`);
  }
  return created;
}

export function updateFolder(
  db: Db,
  id: string,
  patch: { name?: string; parentId?: string | null },
  now: number,
): void {
  const set: Record<string, unknown> = { updatedAt: now };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.parentId !== undefined) set.parentId = patch.parentId;
  db.update(folders).set(set).where(eq(folders.id, id)).run();
}

export function deleteFolder(db: Db, id: string): void {
  db.delete(folders).where(eq(folders.id, id)).run();
}

/**
 * Every descendant id of a folder, excluding the folder itself.
 *
 * Used to reject moves that would create a cycle. A recursive CTE does this in
 * one round trip, which matters because the check runs on every drag.
 */
export function descendantFolderIds(db: Db, id: string): string[] {
  const rows = db.all<{ id: string }>(sql`
    WITH RECURSIVE sub(id) AS (
      SELECT id FROM folders WHERE parent_id = ${id}
      UNION ALL
      SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id
    )
    SELECT id FROM sub
  `);
  return rows.map((r) => r.id);
}

/** Direct children only, for delete confirmations. */
export function folderChildCounts(
  db: Db,
  id: string,
): { tripCount: number; folderCount: number } {
  const tripRow = db
    .select({ n: sql<number>`count(*)` })
    .from(trips)
    .where(eq(trips.folderId, id))
    .get();
  const folderRow = db
    .select({ n: sql<number>`count(*)` })
    .from(folders)
    .where(eq(folders.parentId, id))
    .get();
  return {
    tripCount: tripRow?.n ?? 0,
    folderCount: folderRow?.n ?? 0,
  };
}
