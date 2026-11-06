import type { Waypoint, WaypointGroup } from '@shared/domain/types';
import type { WaypointWithTrip } from '@shared/ipc/api';
import { isValidLat, isValidLon } from '@shared/geo/distance';
import { DEFAULT_SYMBOL_ID } from '@shared/domain/symbols';
import type { Db } from '../db/client';
import * as tripRepo from '../db/repositories/trips';
import * as repo from '../db/repositories/waypoints';
import { notFound, ServiceError } from './errors';
import type { Mutation } from './folderService';

/**
 * Waypoint use cases.
 *
 * Coordinates are validated here as well as at the IPC schema, because this
 * layer is also reached by the Phase 3 import pipeline, which does not go
 * through an IPC schema.
 */

function assertTripExists(db: Db, tripId: string): void {
  if (tripRepo.findTrip(db, tripId) === null) throw notFound('That trip');
}

function assertCoordinates(lat: number, lon: number): void {
  if (!isValidLat(lat)) {
    throw new ServiceError(
      'INVALID_REQUEST',
      `Latitude must be between -90 and 90 (got ${lat}).`,
    );
  }
  if (!isValidLon(lon)) {
    throw new ServiceError(
      'INVALID_REQUEST',
      `Longitude must be between -180 and 180 (got ${lon}).`,
    );
  }
}

function requireWaypoint(db: Db, id: string): Waypoint {
  const waypoint = repo.findWaypoint(db, id);
  if (waypoint === null) throw notFound('That waypoint');
  return waypoint;
}

export function listForTrip(db: Db, tripId: string): Waypoint[] {
  assertTripExists(db, tripId);
  return repo.listWaypointsForTrip(db, tripId);
}

export function listAll(db: Db): WaypointWithTrip[] {
  return repo.listAllWaypoints(db);
}

export function get(db: Db, id: string): Waypoint {
  return requireWaypoint(db, id);
}

export function search(db: Db, query: string): WaypointWithTrip[] {
  if (query.length === 0) return [];
  return repo.searchWaypoints(db, query);
}

export function create(
  db: Db,
  input: {
    id?: string;
    tripId: string;
    name: string;
    lat: number;
    lon: number;
    eleM: number | null;
    description: string | null;
    symbol: string;
    notes: string | null;
    groupId: string | null;
    source?: 'user' | 'import';
    /** Imported fields with no column of their own. See db/metadata.ts. */
    metadata?: Record<string, unknown> | undefined;
  },
): Mutation<Waypoint> {
  assertTripExists(db, input.tripId);
  assertCoordinates(input.lat, input.lon);

  const created = repo.insertWaypoint(db, {
    ...(input.id === undefined ? {} : { id: input.id }),
    tripId: input.tripId,
    groupId: input.groupId,
    name: input.name,
    lat: input.lat,
    lon: input.lon,
    // Absent elevation stays absent. Never a sentinel zero.
    eleM: input.eleM,
    description: input.description,
    symbol: input.symbol.length === 0 ? DEFAULT_SYMBOL_ID : input.symbol,
    notes: input.notes,
    source: input.source ?? 'user',
    metadata: input.metadata,
    now: Date.now(),
  });

  return {
    result: created,
    inverse: { kind: 'waypoint:delete', payload: { id: created.id } },
  };
}

function snapshotPayload(waypoint: Waypoint): Record<string, unknown> {
  return {
    id: waypoint.id,
    name: waypoint.name,
    lat: waypoint.lat,
    lon: waypoint.lon,
    eleM: waypoint.eleM,
    description: waypoint.description,
    symbol: waypoint.symbol ?? DEFAULT_SYMBOL_ID,
    notes: waypoint.notes,
    groupId: waypoint.groupId,
  };
}

export function update(
  db: Db,
  input: {
    id: string;
    name?: string | undefined;
    lat?: number | undefined;
    lon?: number | undefined;
    eleM?: number | null | undefined;
    description?: string | null | undefined;
    symbol?: string | undefined;
    notes?: string | null | undefined;
    groupId?: string | null | undefined;
  },
): Mutation<Waypoint> {
  const before = requireWaypoint(db, input.id);

  // Validate the resulting position, not just the supplied half: a partial
  // update of latitude alone still has to land somewhere real.
  const nextLat = input.lat ?? before.lat;
  const nextLon = input.lon ?? before.lon;
  assertCoordinates(nextLat, nextLon);

  const patch: repo.WaypointPatch = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.lat !== undefined) patch.lat = input.lat;
  if (input.lon !== undefined) patch.lon = input.lon;
  if (input.eleM !== undefined) patch.eleM = input.eleM;
  if (input.description !== undefined) patch.description = input.description;
  if (input.symbol !== undefined) patch.symbol = input.symbol;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.groupId !== undefined) patch.groupId = input.groupId;

  repo.updateWaypoint(db, input.id, patch, Date.now());

  return {
    result: requireWaypoint(db, input.id),
    // The whole prior state, so undo restores every field rather than only the
    // ones this call happened to touch.
    inverse: { kind: 'waypoint:update', payload: snapshotPayload(before) },
  };
}

/** Marker drag. Separate from `update` so the undo label can say "Move". */
export function move(
  db: Db,
  input: { id: string; lat: number; lon: number },
): Mutation<Waypoint> {
  const before = requireWaypoint(db, input.id);
  assertCoordinates(input.lat, input.lon);

  repo.updateWaypoint(
    db,
    input.id,
    // Elevation described the old position, so it is no longer known. Keeping
    // it would be inventing data for somewhere else.
    { lat: input.lat, lon: input.lon, eleM: null },
    Date.now(),
  );

  return {
    result: requireWaypoint(db, input.id),
    inverse: {
      kind: 'waypoint:restorePosition',
      payload: {
        id: before.id,
        lat: before.lat,
        lon: before.lon,
        eleM: before.eleM,
      },
    },
  };
}

/** Only reached through undo of a move: restores position and elevation. */
export function restorePosition(
  db: Db,
  input: { id: string; lat: number; lon: number; eleM: number | null },
): Mutation<Waypoint> {
  const before = requireWaypoint(db, input.id);
  assertCoordinates(input.lat, input.lon);
  repo.updateWaypoint(
    db,
    input.id,
    { lat: input.lat, lon: input.lon, eleM: input.eleM },
    Date.now(),
  );
  return {
    result: requireWaypoint(db, input.id),
    inverse: {
      kind: 'waypoint:restorePosition',
      payload: {
        id: before.id,
        lat: before.lat,
        lon: before.lon,
        eleM: before.eleM,
      },
    },
  };
}

export function duplicate(db: Db, id: string): Mutation<Waypoint> {
  const source = requireWaypoint(db, id);
  return create(db, {
    tripId: source.tripId,
    name: `${source.name} copy`,
    lat: source.lat,
    lon: source.lon,
    eleM: source.eleM,
    description: source.description,
    symbol: source.symbol ?? DEFAULT_SYMBOL_ID,
    notes: source.notes,
    groupId: source.groupId,
    source: source.source,
  });
}

export function moveToTrip(
  db: Db,
  input: { id: string; tripId: string },
): Mutation<Waypoint> {
  const before = requireWaypoint(db, input.id);
  assertTripExists(db, input.tripId);
  // A group belongs to the old trip, so it cannot follow the waypoint across.
  repo.updateWaypoint(
    db,
    input.id,
    { tripId: input.tripId, groupId: null },
    Date.now(),
  );
  return {
    result: requireWaypoint(db, input.id),
    inverse: {
      kind: 'waypoint:moveBack',
      payload: {
        id: before.id,
        tripId: before.tripId,
        groupId: before.groupId,
      },
    },
  };
}

export function moveBack(
  db: Db,
  input: { id: string; tripId: string; groupId: string | null },
): Mutation<Waypoint> {
  const before = requireWaypoint(db, input.id);
  assertTripExists(db, input.tripId);
  repo.updateWaypoint(
    db,
    input.id,
    { tripId: input.tripId, groupId: input.groupId },
    Date.now(),
  );
  return {
    result: requireWaypoint(db, input.id),
    inverse: {
      kind: 'waypoint:moveBack',
      payload: {
        id: before.id,
        tripId: before.tripId,
        groupId: before.groupId,
      },
    },
  };
}

export function remove(db: Db, id: string): Mutation<{ id: string }> {
  const snapshot = requireWaypoint(db, id);
  repo.deleteWaypoint(db, id);
  return {
    result: { id },
    inverse: {
      kind: 'waypoint:restore',
      payload: {
        ...snapshotPayload(snapshot),
        tripId: snapshot.tripId,
        source: snapshot.source,
      },
    },
  };
}

export function restore(
  db: Db,
  input: {
    id: string;
    tripId: string;
    name: string;
    lat: number;
    lon: number;
    eleM: number | null;
    description: string | null;
    symbol: string;
    notes: string | null;
    groupId: string | null;
    source: 'user' | 'import';
  },
): Mutation<Waypoint> {
  if (repo.findWaypoint(db, input.id) !== null) {
    throw new ServiceError(
      'CONFLICT',
      'That waypoint already exists and cannot be restored over.',
    );
  }
  return create(db, input);
}

// --------------------------------------------------------------- groups

export function groups(db: Db, tripId: string): WaypointGroup[] {
  assertTripExists(db, tripId);
  return repo.listGroups(db, tripId);
}

export function createGroup(
  db: Db,
  input: { tripId: string; name: string },
): Mutation<WaypointGroup> {
  assertTripExists(db, input.tripId);
  const group = repo.insertGroup(db, {
    tripId: input.tripId,
    name: input.name,
    now: Date.now(),
  });
  return {
    result: group,
    // Group deletion is not exposed in Phase 2, so there is no inverse to
    // record. Declaring 'none' is honest; inventing one would not be.
    inverse: { kind: 'none', payload: {} },
  };
}
