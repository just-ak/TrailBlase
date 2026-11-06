import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RoutePoint } from '@shared/domain/types';
import {
  appendPoint,
  deletePoint,
  insertPointAt,
  movePoint,
} from '@shared/geo/routeEdit';
import { createDatabase, type Db, type DbHandle } from '../db/client';
import { ServiceError } from './errors';
import * as geometryService from './geometryService';
import * as routeService from './routeService';
import * as tripService from './tripService';
import * as undoService from './undoService';
import * as waypointService from './waypointService';

let dir: string;
let handle: DbHandle;
let db: Db;
let tripId: string;

const p = (lat: number, lon: number, ele: number | null = null): RoutePoint => ({
  lat,
  lon,
  ele,
  name: null,
  symbol: null,
  notes: null,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailrt-p2-'));
  handle = createDatabase({ file: join(dir, 'test.db') });
  db = handle.db;
  undoService.clear();
  tripId = tripService.create(db, {
    name: 'Trip',
    folderId: null,
    description: null,
    notes: null,
  }).result.id;
});

afterEach(() => {
  undoService.clear();
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

const newRoute = (points: RoutePoint[] = [], name = 'Route') =>
  routeService.create(db, { tripId, name, colour: null, points }).result;

const newWaypoint = (overrides: Partial<{ name: string; lat: number; lon: number }> = {}) =>
  waypointService.create(db, {
    tripId,
    name: overrides.name ?? 'Hut',
    lat: overrides.lat ?? 46.8,
    lon: overrides.lon ?? 8.2,
    eleM: null,
    description: null,
    symbol: 'pin',
    notes: null,
    groupId: null,
  }).result;

// ------------------------------------------------------------------- routes

describe('routeService', () => {
  it('creates an empty route, which is valid while being drawn', () => {
    const route = newRoute([]);
    expect(route.pointCount).toBe(0);
    // No points means no measurable distance, which is not the same as zero.
    expect(route.distanceM).toBeNull();
  });

  it('computes distance from geometry', () => {
    const route = newRoute([p(0, 0), p(0, 1)]);
    expect(route.pointCount).toBe(2);
    expect(route.distanceM).toBeGreaterThan(111_000);
    expect(route.distanceM).toBeLessThan(111_400);
  });

  it('leaves elevation null when no point carries any', () => {
    const route = newRoute([p(0, 0), p(0, 1)]);
    expect(route.elevGainM).toBeNull();
    expect(route.elevLossM).toBeNull();
  });

  it('reports zero gain for genuinely flat elevation data', () => {
    const route = newRoute([p(0, 0, 100), p(0, 1, 100)]);
    // Distinct from null: we know the elevation and it does not change.
    expect(route.elevGainM).toBe(0);
    expect(route.elevLossM).toBe(0);
  });

  it('accumulates ascent and descent', () => {
    const route = newRoute([p(0, 0, 100), p(0, 1, 300), p(0, 2, 250)]);
    expect(route.elevGainM).toBe(200);
    expect(route.elevLossM).toBe(50);
  });

  it('keeps a degenerate one-point route valid', () => {
    const route = newRoute([p(1, 1)]);
    expect(route.pointCount).toBe(1);
    expect(route.distanceM).toBe(0);
  });

  it('stores points in order and round-trips them exactly', () => {
    const points = [p(46.1, 8.1, 500), p(46.2, 8.2, 650), p(46.3, 8.3, null)];
    const route = newRoute(points);
    expect(routeService.get(db, route.id).points).toEqual(points);
  });

  it('keeps seq dense after replacing geometry with fewer points', () => {
    const route = newRoute([p(0, 0), p(0, 1), p(0, 2)]);
    routeService.setGeometry(db, { id: route.id, points: [p(0, 5)] });

    const rows = handle.sqlite
      .prepare('SELECT seq FROM route_points WHERE route_id = ? ORDER BY seq')
      .all(route.id) as { seq: number }[];
    expect(rows.map((r) => r.seq)).toEqual([0]);
  });

  it('recomputes statistics on every geometry change', () => {
    const route = newRoute([p(0, 0), p(0, 1)]);
    const longer = routeService.setGeometry(db, {
      id: route.id,
      points: [p(0, 0), p(0, 2)],
    }).result;
    expect(longer.distanceM).toBeGreaterThan(route.distanceM!);
    expect(longer.pointCount).toBe(2);
  });

  it('reverses geometry', () => {
    const route = newRoute([p(0, 0), p(0, 1), p(0, 2)]);
    routeService.reverse(db, route.id);
    expect(routeService.get(db, route.id).points.map((q) => q.lon)).toEqual([
      2, 1, 0,
    ]);
  });

  it('duplicates into an independent copy', () => {
    const route = newRoute([p(0, 0), p(0, 1)]);
    const copy = routeService.duplicate(db, route.id).result;

    expect(copy.id).not.toBe(route.id);
    expect(copy.name).toBe('Route copy');

    routeService.setGeometry(db, { id: copy.id, points: [p(5, 5)] });
    // The original is untouched.
    expect(routeService.get(db, route.id).points).toHaveLength(2);
  });

  it('moves a route to another trip as a reparent', () => {
    const route = newRoute([p(0, 0)]);
    const other = tripService.create(db, {
      name: 'Other',
      folderId: null,
      description: null,
      notes: null,
    }).result;

    routeService.moveToTrip(db, { id: route.id, tripId: other.id });
    expect(routeService.get(db, route.id).tripId).toBe(other.id);
    expect(routeService.listForTrip(db, tripId)).toHaveLength(0);
    expect(routeService.listForTrip(db, other.id)).toHaveLength(1);
  });

  it('refuses a route in a trip that does not exist', () => {
    expect(() =>
      routeService.create(db, {
        tripId: '0190c3ae-1f2b-7c4d-9e8f-1a2b3c4d5e6f',
        name: 'Orphan',
        colour: null,
        points: [],
      }),
    ).toThrow(ServiceError);
  });

  it('deletes a route and its points', () => {
    const route = newRoute([p(0, 0), p(0, 1)]);
    routeService.remove(db, route.id);
    expect(() => routeService.get(db, route.id)).toThrow(ServiceError);
    const remaining = handle.sqlite
      .prepare('SELECT count(*) AS n FROM route_points')
      .get() as { n: number };
    expect(remaining.n).toBe(0);
  });

  it('marks user-drawn routes as such, keeping imports distinguishable', () => {
    expect(newRoute([p(0, 0)]).source).toBe('user');
  });

  it('lists routes across trips with their trip name', () => {
    newRoute([p(0, 0)], 'Alpha');
    const all = routeService.listAll(db);
    expect(all).toHaveLength(1);
    expect(all[0]?.tripName).toBe('Trip');
  });
});

// -------------------------------------------- geometry editing round trips

describe('geometry editing via shared helpers', () => {
  it('appends a point as drawing does', () => {
    const route = newRoute([p(0, 0)]);
    const next = appendPoint(routeService.get(db, route.id).points, p(0, 1));
    const updated = routeService.setGeometry(db, { id: route.id, points: next }).result;
    expect(updated.pointCount).toBe(2);
  });

  it('moves a vertex and clears its stale elevation', () => {
    const route = newRoute([p(0, 0, 100), p(0, 1, 200)]);
    const next = movePoint(routeService.get(db, route.id).points, 1, 0, 3);
    routeService.setGeometry(db, { id: route.id, points: next });

    const after = routeService.get(db, route.id);
    expect(after.points[1]?.lon).toBe(3);
    expect(after.points[1]?.ele).toBeNull();
  });

  it('inserts a point mid-route', () => {
    const route = newRoute([p(0, 0), p(0, 2)]);
    const next = insertPointAt(routeService.get(db, route.id).points, 1, p(0, 1));
    routeService.setGeometry(db, { id: route.id, points: next });
    expect(routeService.get(db, route.id).points.map((q) => q.lon)).toEqual([
      0, 1, 2,
    ]);
  });

  it('deletes a point', () => {
    const route = newRoute([p(0, 0), p(0, 1), p(0, 2)]);
    const next = deletePoint(routeService.get(db, route.id).points, 1);
    routeService.setGeometry(db, { id: route.id, points: next });
    expect(routeService.get(db, route.id).points.map((q) => q.lon)).toEqual([0, 2]);
  });
});

// ---------------------------------------------------------------- waypoints

describe('waypointService', () => {
  it('creates a waypoint with the given coordinates', () => {
    const waypoint = newWaypoint({ lat: 46.5, lon: 8.1 });
    expect(waypoint.lat).toBe(46.5);
    expect(waypoint.lon).toBe(8.1);
    expect(waypoint.symbol).toBe('pin');
    expect(waypoint.source).toBe('user');
  });

  it('stores unknown elevation as null rather than zero', () => {
    expect(newWaypoint().eleM).toBeNull();
  });

  it('rejects out-of-range coordinates with a message naming the problem', () => {
    expect(() =>
      waypointService.create(db, {
        tripId,
        name: 'Bad',
        lat: 95,
        lon: 0,
        eleM: null,
        description: null,
        symbol: 'pin',
        notes: null,
        groupId: null,
      }),
    ).toThrow(/Latitude/);
  });

  it('range-checks the resulting position on a partial update', () => {
    const waypoint = newWaypoint();
    // Only longitude supplied, but the combined position must still be valid.
    expect(() =>
      waypointService.update(db, { id: waypoint.id, lon: 999 }),
    ).toThrow(/Longitude/);
  });

  it('updates editable fields', () => {
    const waypoint = newWaypoint();
    const updated = waypointService.update(db, {
      id: waypoint.id,
      name: 'Refuge',
      description: 'Booked',
      symbol: 'lodging',
      eleM: 2100,
    }).result;
    expect(updated.name).toBe('Refuge');
    expect(updated.description).toBe('Booked');
    expect(updated.symbol).toBe('lodging');
    expect(updated.eleM).toBe(2100);
  });

  it('preserves an unrecognised imported symbol', () => {
    const waypoint = newWaypoint();
    const updated = waypointService.update(db, {
      id: waypoint.id,
      symbol: 'Geocache Found',
    }).result;
    // Phase 3 export has to write this back unchanged.
    expect(updated.symbol).toBe('Geocache Found');
  });

  it('clears elevation when the marker is dragged', () => {
    const waypoint = waypointService.create(db, {
      tripId,
      name: 'Hut',
      lat: 46.8,
      lon: 8.2,
      eleM: 1800,
      description: null,
      symbol: 'pin',
      notes: null,
      groupId: null,
    }).result;

    const moved = waypointService.move(db, {
      id: waypoint.id,
      lat: 46.9,
      lon: 8.3,
    }).result;
    // 1800 m described the old spot; keeping it would be inventing data.
    expect(moved.eleM).toBeNull();
  });

  it('groups waypoints', () => {
    const group = waypointService.createGroup(db, { tripId, name: 'Huts' }).result;
    const waypoint = newWaypoint();
    const updated = waypointService.update(db, {
      id: waypoint.id,
      groupId: group.id,
    }).result;
    expect(updated.groupId).toBe(group.id);
    expect(waypointService.groups(db, tripId)).toHaveLength(1);
  });

  it('searches case-insensitively and treats wildcards literally', () => {
    newWaypoint({ name: 'Monte Rosa' });
    newWaypoint({ name: '100% full' });
    expect(waypointService.search(db, 'monte')).toHaveLength(1);
    expect(waypointService.search(db, '%').map((w) => w.name)).toEqual(['100% full']);
    expect(waypointService.search(db, '')).toEqual([]);
  });

  it('drops the group when moved to another trip', () => {
    const group = waypointService.createGroup(db, { tripId, name: 'Huts' }).result;
    const waypoint = newWaypoint();
    waypointService.update(db, { id: waypoint.id, groupId: group.id });

    const other = tripService.create(db, {
      name: 'Other',
      folderId: null,
      description: null,
      notes: null,
    }).result;
    const moved = waypointService.moveToTrip(db, {
      id: waypoint.id,
      tripId: other.id,
    }).result;

    expect(moved.tripId).toBe(other.id);
    // The group belongs to the old trip and cannot follow.
    expect(moved.groupId).toBeNull();
  });

  it('cascades when its trip is deleted', () => {
    newWaypoint();
    newRoute([p(0, 0)]);
    tripService.remove(db, tripId);
    expect(waypointService.listAll(db)).toHaveLength(0);
    expect(routeService.listAll(db)).toHaveLength(0);
  });

  it('counts towards its trip\u2019s contents', () => {
    newWaypoint();
    newRoute([p(0, 0)]);
    const trip = tripService.get(db, tripId);
    expect(trip.waypointCount).toBe(1);
    expect(trip.routeCount).toBe(1);
  });
});

// ----------------------------------------------------------------- geometry

describe('geometryService.forTrip', () => {
  it('returns routes with points, waypoints, and bounds in one call', () => {
    newRoute([p(46.0, 8.0), p(46.5, 8.5)]);
    newWaypoint({ lat: 47.0, lon: 9.0 });

    const geometry = geometryService.forTrip(db, tripId);
    expect(geometry.routes).toHaveLength(1);
    expect(geometry.routes[0]?.points).toHaveLength(2);
    expect(geometry.waypoints).toHaveLength(1);
    expect(geometry.bounds).toEqual({
      minLat: 46.0,
      maxLat: 47.0,
      minLon: 8.0,
      maxLon: 9.0,
    });
  });

  it('has null bounds for an empty trip, since an empty box is not a thing', () => {
    expect(geometryService.forTrip(db, tripId).bounds).toBeNull();
  });
});

// --------------------------------------------------------------------- undo

describe('undoService', () => {
  it('starts empty', () => {
    expect(undoService.state()).toEqual({
      canUndo: false,
      canRedo: false,
      undoLabel: null,
      redoLabel: null,
    });
  });

  it('refuses to undo or redo nothing', () => {
    expect(() => undoService.undo(db)).toThrow(/nothing to undo/i);
    expect(() => undoService.redo(db)).toThrow(/nothing to redo/i);
  });

  it('undoes a geometry edit back to the exact previous array', () => {
    const original = [p(0, 0, 100), p(0, 1, 200)];
    const route = newRoute(original);

    const mutation = routeService.setGeometry(db, {
      id: route.id,
      points: [p(5, 5)],
    });
    undoService.record(mutation.inverse);
    expect(undoService.state().canUndo).toBe(true);

    undoService.undo(db);
    expect(routeService.get(db, route.id).points).toEqual(original);
  });

  it('redoes a geometry edit', () => {
    const route = newRoute([p(0, 0)]);
    undoService.record(
      routeService.setGeometry(db, { id: route.id, points: [p(9, 9)] }).inverse,
    );

    undoService.undo(db);
    expect(routeService.get(db, route.id).points.map((q) => q.lat)).toEqual([0]);

    undoService.redo(db);
    expect(routeService.get(db, route.id).points.map((q) => q.lat)).toEqual([9]);
  });

  it('restores a deleted route with its original id and geometry', () => {
    const points = [p(1, 1, 10), p(2, 2, 20)];
    const route = newRoute(points, 'Doomed');

    undoService.record(routeService.remove(db, route.id).inverse);
    undoService.undo(db);

    const restored = routeService.get(db, route.id);
    // The id matters: selection and later attachments refer to it.
    expect(restored.id).toBe(route.id);
    expect(restored.name).toBe('Doomed');
    expect(restored.points).toEqual(points);
  });

  it('restores a deleted waypoint with all of its fields', () => {
    const waypoint = waypointService.create(db, {
      tripId,
      name: 'Spring',
      lat: 46.4,
      lon: 8.4,
      eleM: 1500,
      description: 'Reliable',
      symbol: 'water',
      notes: 'filter',
      groupId: null,
    }).result;

    undoService.record(waypointService.remove(db, waypoint.id).inverse);
    undoService.undo(db);

    const restored = waypointService.get(db, waypoint.id);
    expect(restored).toMatchObject({
      id: waypoint.id,
      name: 'Spring',
      eleM: 1500,
      description: 'Reliable',
      symbol: 'water',
      notes: 'filter',
    });
  });

  it('undoes a waypoint move, restoring its elevation too', () => {
    const waypoint = waypointService.create(db, {
      tripId,
      name: 'Hut',
      lat: 46.8,
      lon: 8.2,
      eleM: 1800,
      description: null,
      symbol: 'pin',
      notes: null,
      groupId: null,
    }).result;

    undoService.record(
      waypointService.move(db, { id: waypoint.id, lat: 47, lon: 9 }).inverse,
    );
    undoService.undo(db);

    const restored = waypointService.get(db, waypoint.id);
    expect(restored.lat).toBe(46.8);
    expect(restored.lon).toBe(8.2);
    expect(restored.eleM).toBe(1800);
  });

  it('undoes a waypoint edit across every field, not only the changed one', () => {
    const waypoint = newWaypoint({ name: 'Before' });
    undoService.record(
      waypointService.update(db, { id: waypoint.id, name: 'After', symbol: 'summit' })
        .inverse,
    );
    undoService.undo(db);

    const restored = waypointService.get(db, waypoint.id);
    expect(restored.name).toBe('Before');
    expect(restored.symbol).toBe('pin');
  });

  it('clears the redo stack when a new action happens', () => {
    const route = newRoute([p(0, 0)]);
    undoService.record(
      routeService.setGeometry(db, { id: route.id, points: [p(1, 1)] }).inverse,
    );
    undoService.undo(db);
    expect(undoService.state().canRedo).toBe(true);

    undoService.record(
      routeService.setGeometry(db, { id: route.id, points: [p(2, 2)] }).inverse,
    );
    // Branching history would be more confusing than useful.
    expect(undoService.state().canRedo).toBe(false);
  });

  it('does not record trip deletion, which is confirmation-gated instead', () => {
    const trip = tripService.create(db, {
      name: 'Gone',
      folderId: null,
      description: null,
      notes: null,
    }).result;
    undoService.record(tripService.remove(db, trip.id).inverse);
    // ADR 0001: the cascade spans tables, so there is no reliable inverse.
    expect(undoService.state().canUndo).toBe(false);
  });

  it('does not record trip creation either', () => {
    undoService.record(
      tripService.create(db, {
        name: 'New',
        folderId: null,
        description: null,
        notes: null,
      }).inverse,
    );
    expect(undoService.state().canUndo).toBe(false);
  });

  it('records a trip rename, which is safely invertible', () => {
    undoService.record(tripService.update(db, { id: tripId, name: 'Renamed' }).inverse);
    expect(undoService.state().canUndo).toBe(true);
    undoService.undo(db);
    expect(tripService.get(db, tripId).name).toBe('Trip');
  });

  it('labels entries so the Edit menu can say what it will undo', () => {
    const waypoint = newWaypoint();
    undoService.record(
      waypointService.move(db, { id: waypoint.id, lat: 47, lon: 9 }).inverse,
    );
    expect(undoService.state().undoLabel).toBe('waypoint move');
  });

  it('enforces the depth bound', () => {
    const route = newRoute([p(0, 0)]);
    for (let i = 0; i < undoService.MAX_UNDO_DEPTH + 10; i += 1) {
      undoService.record(
        routeService.setGeometry(db, { id: route.id, points: [p(0, i)] }).inverse,
      );
    }
    // Draining the stack must terminate at the bound, not grow forever.
    let steps = 0;
    while (undoService.state().canUndo) {
      undoService.undo(db);
      steps += 1;
      if (steps > undoService.MAX_UNDO_DEPTH + 5) break;
    }
    expect(steps).toBe(undoService.MAX_UNDO_DEPTH);
  });

  it('clear() discards both stacks', () => {
    const route = newRoute([p(0, 0)]);
    undoService.record(
      routeService.setGeometry(db, { id: route.id, points: [p(1, 1)] }).inverse,
    );
    undoService.clear();
    expect(undoService.state()).toMatchObject({ canUndo: false, canRedo: false });
  });

  it('survives undoing a long chain of mixed edits', () => {
    const route = newRoute([p(0, 0)]);
    const waypoint = newWaypoint({ name: 'W0' });

    undoService.record(
      routeService.setGeometry(db, { id: route.id, points: [p(0, 0), p(0, 1)] }).inverse,
    );
    undoService.record(
      waypointService.update(db, { id: waypoint.id, name: 'W1' }).inverse,
    );
    undoService.record(routeService.reverse(db, route.id).inverse);

    undoService.undo(db);
    undoService.undo(db);
    undoService.undo(db);

    expect(routeService.get(db, route.id).points).toHaveLength(1);
    expect(waypointService.get(db, waypoint.id).name).toBe('W0');
    expect(undoService.state().canUndo).toBe(false);
  });
});
