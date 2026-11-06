import { randomUUID } from 'node:crypto';
import type {
  SortDirection,
  Trip,
  TripSortKey,
  TripStatus,
  TripWithCounts,
} from '@shared/domain/types';
import type { DeleteTripResult } from '@shared/ipc/api';
import type { Db } from '../db/client';
import * as folderRepo from '../db/repositories/folders';
import * as repo from '../db/repositories/trips';
import { notFound } from './errors';
import type { Mutation } from './folderService';

/**
 * Trip use cases. Transactional, and each mutation reports its inverse for the
 * Phase 2 undo stack.
 */

export interface ListOptions {
  folderId?: string | null | undefined;
  includeArchived: boolean;
  sortKey: TripSortKey;
  sortDirection: SortDirection;
}

export function list(db: Db, options: ListOptions): TripWithCounts[] {
  return repo.listTrips(db, options);
}

export function get(db: Db, id: string): TripWithCounts {
  const trip = repo.findTripWithCounts(db, id);
  if (trip === null) throw notFound('That trip');
  return trip;
}

export function search(db: Db, query: string): TripWithCounts[] {
  if (query.length === 0) return [];
  return repo.searchTrips(db, query);
}

function assertFolderExists(db: Db, folderId: string | null): void {
  if (folderId !== null && folderRepo.findFolder(db, folderId) === null) {
    throw notFound('The destination folder');
  }
}

export function create(
  db: Db,
  input: {
    name: string;
    folderId: string | null;
    description: string | null;
    notes: string | null;
  },
): Mutation<Trip> {
  assertFolderExists(db, input.folderId);

  const trip = repo.insertTrip(db, {
    id: randomUUID(),
    folderId: input.folderId,
    name: input.name,
    description: input.description,
    notes: input.notes,
    now: Date.now(),
  });

  return {
    result: trip,
    inverse: { kind: 'trip:delete', payload: { id: trip.id } },
  };
}

export function update(
  db: Db,
  input: {
    id: string;
    name?: string | undefined;
    description?: string | null | undefined;
    notes?: string | null | undefined;
  },
): Mutation<Trip> {
  const before = get(db, input.id);

  const patch: repo.TripPatch = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.notes !== undefined) patch.notes = input.notes;

  repo.updateTrip(db, input.id, patch, Date.now());

  return {
    result: get(db, input.id),
    inverse: {
      kind: 'trip:update',
      payload: {
        id: before.id,
        name: before.name,
        description: before.description,
        notes: before.notes,
      },
    },
  };
}

export function move(
  db: Db,
  input: { id: string; folderId: string | null },
): Mutation<Trip> {
  const before = get(db, input.id);
  assertFolderExists(db, input.folderId);
  repo.updateTrip(db, input.id, { folderId: input.folderId }, Date.now());
  return {
    result: get(db, input.id),
    inverse: {
      kind: 'trip:move',
      payload: { id: before.id, folderId: before.folderId },
    },
  };
}

export function setStatus(
  db: Db,
  input: { id: string; status: TripStatus },
): Mutation<Trip> {
  const before = get(db, input.id);
  repo.updateTrip(db, input.id, { status: input.status }, Date.now());
  return {
    result: get(db, input.id),
    inverse: {
      kind: 'trip:setStatus',
      payload: { id: before.id, status: before.status },
    },
  };
}

/**
 * Duplicates a trip.
 *
 * Phase 1 trips have no children yet, but the copy runs in a transaction and is
 * written so Phases 2 and 3 extend it by copying rows rather than restructuring
 * it. The duplicate is named distinctly, as Requirement 5.3 asks.
 */
export function duplicate(db: Db, id: string): Mutation<Trip> {
  const source = get(db, id);

  const created = db.transaction((): Trip => {
    const copy = repo.insertTrip(db, {
      id: randomUUID(),
      folderId: source.folderId,
      name: `${source.name} copy`,
      description: source.description,
      notes: source.notes,
      status: source.status,
      now: Date.now(),
    });
    // Phase 2 and 3: copy routes, route points, tracks, track points,
    // waypoints and attachments here, inside this same transaction.
    return copy;
  });

  return {
    result: created,
    inverse: { kind: 'trip:delete', payload: { id: created.id } },
  };
}

/**
 * Deletes a trip and, by cascade, everything it owns.
 *
 * The returned counts are what the confirmation dialog states. This is
 * confirmation-gated rather than undoable: the cascade spans several tables and
 * a reliable inverse would mean snapshotting them. ADR 0001.
 */
export function remove(db: Db, id: string): Mutation<DeleteTripResult> {
  const counts = repo.tripChildCounts(db, id);
  const existing = repo.findTrip(db, id);
  if (existing === null) throw notFound('That trip');

  repo.deleteTrip(db, id);

  return {
    result: { id, ...counts },
    inverse: { kind: 'none', payload: {} },
  };
}

export function childCounts(
  db: Db,
  id: string,
): { routeCount: number; trackCount: number; waypointCount: number } {
  get(db, id);
  return repo.tripChildCounts(db, id);
}
