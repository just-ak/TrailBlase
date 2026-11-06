import type { RoutePoint } from '@shared/domain/types';
import type { Db } from '../db/client';
import { ServiceError } from './errors';
import * as folderService from './folderService';
import type { Mutation } from './folderService';
import * as routeService from './routeService';
import * as tripService from './tripService';
import * as waypointService from './waypointService';

/**
 * The command registry: a `kind` string to the service call that applies it.
 *
 * This is what makes undo work without hand-written inverses. Every service
 * mutation returns `{ result, inverse: { kind, payload } }`, and because
 * applying a command here itself returns a `Mutation`, the inverse of the
 * inverse comes back for free. See the Phase 2 design.
 *
 * Payloads are produced by our own services and never arrive from the renderer
 * — undo and redo take no arguments — so they are trusted internal data rather
 * than user input. They are still shape-checked below, because a malformed
 * payload would otherwise corrupt data silently rather than failing loudly.
 */

export type CommandKind =
  | 'none'
  | 'trip:update'
  | 'trip:move'
  | 'trip:setStatus'
  | 'folder:rename'
  | 'folder:move'
  | 'route:update'
  | 'route:setGeometry'
  | 'route:reverse'
  | 'route:move'
  | 'route:delete'
  | 'route:restore'
  | 'waypoint:update'
  | 'waypoint:restorePosition'
  | 'waypoint:moveBack'
  | 'waypoint:delete'
  | 'waypoint:restore';

export interface Command {
  kind: string;
  payload: Record<string, unknown>;
}

type Handler = (db: Db, payload: Record<string, unknown>) => Mutation<unknown>;

/** Human labels for the Edit menu: "Undo move waypoint". */
const LABELS: Record<CommandKind, string> = {
  none: 'change',
  'trip:update': 'trip edit',
  'trip:move': 'trip move',
  'trip:setStatus': 'trip archive',
  'folder:rename': 'folder rename',
  'folder:move': 'folder move',
  'route:update': 'route edit',
  'route:setGeometry': 'route edit',
  'route:reverse': 'route reverse',
  'route:move': 'route move',
  'route:delete': 'route delete',
  'route:restore': 'route delete',
  'waypoint:update': 'waypoint edit',
  'waypoint:restorePosition': 'waypoint move',
  'waypoint:moveBack': 'waypoint move',
  'waypoint:delete': 'waypoint delete',
  'waypoint:restore': 'waypoint delete',
};

export function labelFor(kind: string): string {
  return LABELS[kind as CommandKind] ?? 'change';
}

// ---------------------------------------------------------- payload readers

function str(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string') {
    throw new ServiceError(
      'UNKNOWN',
      'An undo step was malformed and was not applied.',
      `expected string at "${key}", got ${typeof value}`,
    );
  }
  return value;
}

function strOrNull(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new ServiceError(
      'UNKNOWN',
      'An undo step was malformed and was not applied.',
      `expected string or null at "${key}"`,
    );
  }
  return value;
}

function num(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ServiceError(
      'UNKNOWN',
      'An undo step was malformed and was not applied.',
      `expected finite number at "${key}"`,
    );
  }
  return value;
}

function numOrNull(
  payload: Record<string, unknown>,
  key: string,
): number | null {
  const value = payload[key];
  if (value === null || value === undefined) return null;
  return num(payload, key);
}

function points(payload: Record<string, unknown>): RoutePoint[] {
  const value = payload.points;
  if (!Array.isArray(value)) {
    throw new ServiceError(
      'UNKNOWN',
      'An undo step was malformed and was not applied.',
      'expected a points array',
    );
  }
  return value as RoutePoint[];
}

function source(payload: Record<string, unknown>): 'user' | 'import' {
  return payload.source === 'import' ? 'import' : 'user';
}

// --------------------------------------------------------------- registry

const HANDLERS: Record<CommandKind, Handler> = {
  none: () => ({ result: null, inverse: { kind: 'none', payload: {} } }),

  'trip:update': (db, p) =>
    tripService.update(db, {
      id: str(p, 'id'),
      name: str(p, 'name'),
      description: strOrNull(p, 'description'),
      notes: strOrNull(p, 'notes'),
    }),

  'trip:move': (db, p) =>
    tripService.move(db, { id: str(p, 'id'), folderId: strOrNull(p, 'folderId') }),

  'trip:setStatus': (db, p) =>
    tripService.setStatus(db, {
      id: str(p, 'id'),
      status: p.status === 'archived' ? 'archived' : 'active',
    }),

  'folder:rename': (db, p) =>
    folderService.rename(db, { id: str(p, 'id'), name: str(p, 'name') }),

  'folder:move': (db, p) =>
    folderService.move(db, {
      id: str(p, 'id'),
      parentId: strOrNull(p, 'parentId'),
    }),

  'route:update': (db, p) =>
    routeService.update(db, {
      id: str(p, 'id'),
      name: str(p, 'name'),
      colour: strOrNull(p, 'colour'),
    }),

  'route:setGeometry': (db, p) =>
    routeService.setGeometry(db, { id: str(p, 'id'), points: points(p) }),

  'route:reverse': (db, p) => routeService.reverse(db, str(p, 'id')),

  'route:move': (db, p) =>
    routeService.moveToTrip(db, { id: str(p, 'id'), tripId: str(p, 'tripId') }),

  'route:delete': (db, p) => routeService.remove(db, str(p, 'id')),

  'route:restore': (db, p) =>
    routeService.restore(db, {
      id: str(p, 'id'),
      tripId: str(p, 'tripId'),
      name: str(p, 'name'),
      colour: strOrNull(p, 'colour'),
      source: source(p),
      points: points(p),
    }),

  'waypoint:update': (db, p) =>
    waypointService.update(db, {
      id: str(p, 'id'),
      name: str(p, 'name'),
      lat: num(p, 'lat'),
      lon: num(p, 'lon'),
      eleM: numOrNull(p, 'eleM'),
      description: strOrNull(p, 'description'),
      symbol: str(p, 'symbol'),
      notes: strOrNull(p, 'notes'),
      groupId: strOrNull(p, 'groupId'),
    }),

  'waypoint:restorePosition': (db, p) =>
    waypointService.restorePosition(db, {
      id: str(p, 'id'),
      lat: num(p, 'lat'),
      lon: num(p, 'lon'),
      eleM: numOrNull(p, 'eleM'),
    }),

  'waypoint:moveBack': (db, p) =>
    waypointService.moveBack(db, {
      id: str(p, 'id'),
      tripId: str(p, 'tripId'),
      groupId: strOrNull(p, 'groupId'),
    }),

  'waypoint:delete': (db, p) => waypointService.remove(db, str(p, 'id')),

  'waypoint:restore': (db, p) =>
    waypointService.restore(db, {
      id: str(p, 'id'),
      tripId: str(p, 'tripId'),
      name: str(p, 'name'),
      lat: num(p, 'lat'),
      lon: num(p, 'lon'),
      eleM: numOrNull(p, 'eleM'),
      description: strOrNull(p, 'description'),
      symbol: str(p, 'symbol'),
      notes: strOrNull(p, 'notes'),
      groupId: strOrNull(p, 'groupId'),
      source: source(p),
    }),
};

export function isUndoable(kind: string): boolean {
  return kind !== 'none' && kind in HANDLERS;
}

export function applyCommand(db: Db, command: Command): Mutation<unknown> {
  const handler = HANDLERS[command.kind as CommandKind];
  if (handler === undefined) {
    throw new ServiceError(
      'UNKNOWN',
      'That change cannot be undone.',
      `no handler for command "${command.kind}"`,
    );
  }
  return handler(db, command.payload);
}
