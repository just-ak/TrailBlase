import { randomUUID } from 'node:crypto';
import type { Folder } from '@shared/domain/types';
import type { DeleteFolderResult } from '@shared/ipc/api';
import type { Db } from '../db/client';
import * as repo from '../db/repositories/folders';
import { cycle, notFound, ServiceError } from './errors';

/**
 * Folder use cases.
 *
 * Every mutation returns the canonical object plus enough information to invert
 * it, so the Phase 2 undo stack can record commands without call sites
 * changing. See ADR 0001.
 */

export interface Mutation<T> {
  result: T;
  /** Describes the inverse for a future undo stack. */
  inverse: { kind: string; payload: Record<string, unknown> };
}

export function list(db: Db): Folder[] {
  return repo.listFolders(db);
}

export function get(db: Db, id: string): Folder {
  const folder = repo.findFolder(db, id);
  if (folder === null) throw notFound('That folder');
  return folder;
}

export function create(
  db: Db,
  input: { name: string; parentId: string | null },
): Mutation<Folder> {
  if (input.parentId !== null && repo.findFolder(db, input.parentId) === null) {
    throw notFound('The parent folder');
  }

  const folder = repo.insertFolder(db, {
    id: randomUUID(),
    parentId: input.parentId,
    name: input.name,
    now: Date.now(),
  });

  return {
    result: folder,
    inverse: { kind: 'folder:delete', payload: { id: folder.id } },
  };
}

export function rename(
  db: Db,
  input: { id: string; name: string },
): Mutation<Folder> {
  const existing = get(db, input.id);
  repo.updateFolder(db, input.id, { name: input.name }, Date.now());
  return {
    result: get(db, input.id),
    inverse: {
      kind: 'folder:rename',
      payload: { id: existing.id, name: existing.name },
    },
  };
}

/**
 * Moves a folder.
 *
 * Rejects a move into the folder's own descendant, and a move into itself.
 * Without this the hierarchy becomes a detached cycle that no tree walk can
 * terminate on. Requirement 5.6.
 */
export function move(
  db: Db,
  input: { id: string; parentId: string | null },
): Mutation<Folder> {
  const existing = get(db, input.id);

  if (input.parentId !== null) {
    if (input.parentId === input.id) {
      throw cycle('A folder cannot be moved inside itself.');
    }
    if (repo.findFolder(db, input.parentId) === null) {
      throw notFound('The destination folder');
    }
    const descendants = repo.descendantFolderIds(db, input.id);
    if (descendants.includes(input.parentId)) {
      throw cycle(
        'A folder cannot be moved inside one of its own subfolders.',
      );
    }
  }

  repo.updateFolder(db, input.id, { parentId: input.parentId }, Date.now());
  return {
    result: get(db, input.id),
    inverse: {
      kind: 'folder:move',
      payload: { id: existing.id, parentId: existing.parentId },
    },
  };
}

/**
 * Deletes a folder. Child folders cascade; trips inside are detached to the
 * root rather than destroyed, which matches the schema's ON DELETE SET NULL and
 * is the less surprising behaviour.
 *
 * The returned counts are what the confirmation dialog shows, and the caller is
 * expected to have confirmed already.
 */
export function remove(db: Db, id: string): Mutation<DeleteFolderResult> {
  get(db, id);
  const counts = repo.folderChildCounts(db, id);
  repo.deleteFolder(db, id);

  return {
    result: { id, tripCount: counts.tripCount, folderCount: counts.folderCount },
    // Folder deletion is confirmation-gated rather than undoable, because the
    // cascade spans tables. ADR 0001.
    inverse: { kind: 'none', payload: {} },
  };
}

/** Counts for a delete confirmation, without performing the delete. */
export function childCounts(
  db: Db,
  id: string,
): { tripCount: number; folderCount: number } {
  get(db, id);
  return repo.folderChildCounts(db, id);
}

export { ServiceError };
