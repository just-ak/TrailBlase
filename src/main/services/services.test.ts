import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/domain/defaults';
import { createDatabase, type Db, type DbHandle } from '../db/client';
import { ServiceError } from './errors';
import * as folderService from './folderService';
import * as libraryService from './libraryService';
import * as settingsService from './settingsService';
import * as tripService from './tripService';

let dir: string;
let handle: DbHandle;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailrt-svc-'));
  handle = createDatabase({ file: join(dir, 'test.db') });
  db = handle.db;
});

afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

const DEFAULT_LIST = {
  includeArchived: false,
  sortKey: 'updatedAt',
  sortDirection: 'desc',
} as const;

// ------------------------------------------------------------------ folders

describe('folderService', () => {
  it('creates a folder at the root', () => {
    const { result } = folderService.create(db, { name: 'Europe', parentId: null });
    expect(result.name).toBe('Europe');
    expect(result.parentId).toBeNull();
    expect(folderService.list(db)).toHaveLength(1);
  });

  it('creates a nested folder', () => {
    const parent = folderService.create(db, { name: 'Europe', parentId: null }).result;
    const child = folderService.create(db, { name: 'Alps', parentId: parent.id }).result;
    expect(child.parentId).toBe(parent.id);
  });

  it('rejects a folder under a parent that does not exist', () => {
    expect(() =>
      folderService.create(db, {
        name: 'Orphan',
        parentId: '0190c3ae-1f2b-7c4d-9e8f-1a2b3c4d5e6f',
      }),
    ).toThrow(ServiceError);
  });

  it('renames a folder and reports the inverse', () => {
    const folder = folderService.create(db, { name: 'Old', parentId: null }).result;
    const { result, inverse } = folderService.rename(db, { id: folder.id, name: 'New' });
    expect(result.name).toBe('New');
    expect(inverse).toEqual({
      kind: 'folder:rename',
      payload: { id: folder.id, name: 'Old' },
    });
  });

  it('moves a folder to another parent', () => {
    const a = folderService.create(db, { name: 'A', parentId: null }).result;
    const b = folderService.create(db, { name: 'B', parentId: null }).result;
    const moved = folderService.move(db, { id: b.id, parentId: a.id }).result;
    expect(moved.parentId).toBe(a.id);
  });

  it('moves a folder back to the root', () => {
    const a = folderService.create(db, { name: 'A', parentId: null }).result;
    const b = folderService.create(db, { name: 'B', parentId: a.id }).result;
    expect(folderService.move(db, { id: b.id, parentId: null }).result.parentId).toBeNull();
  });

  it('refuses to move a folder into itself', () => {
    const a = folderService.create(db, { name: 'A', parentId: null }).result;
    expect(() => folderService.move(db, { id: a.id, parentId: a.id })).toThrow(/inside itself/i);
  });

  it('refuses to move a folder into its direct child', () => {
    const parent = folderService.create(db, { name: 'P', parentId: null }).result;
    const child = folderService.create(db, { name: 'C', parentId: parent.id }).result;
    expect(() => folderService.move(db, { id: parent.id, parentId: child.id })).toThrow(
      /own subfolders/i,
    );
  });

  it('refuses to move a folder into a deep descendant', () => {
    const a = folderService.create(db, { name: 'A', parentId: null }).result;
    const b = folderService.create(db, { name: 'B', parentId: a.id }).result;
    const c = folderService.create(db, { name: 'C', parentId: b.id }).result;
    const d = folderService.create(db, { name: 'D', parentId: c.id }).result;
    expect(() => folderService.move(db, { id: a.id, parentId: d.id })).toThrow(/own subfolders/i);
    // And the hierarchy is unchanged after the rejection.
    expect(folderService.get(db, a.id).parentId).toBeNull();
  });

  it('allows moving a sibling subtree, which is not a cycle', () => {
    const a = folderService.create(db, { name: 'A', parentId: null }).result;
    const b = folderService.create(db, { name: 'B', parentId: null }).result;
    const bChild = folderService.create(db, { name: 'B1', parentId: b.id }).result;
    expect(folderService.move(db, { id: bChild.id, parentId: a.id }).result.parentId).toBe(a.id);
  });

  it('reports child counts before a delete', () => {
    const folder = folderService.create(db, { name: 'F', parentId: null }).result;
    folderService.create(db, { name: 'Sub', parentId: folder.id });
    tripService.create(db, {
      name: 'T',
      folderId: folder.id,
      description: null,
      notes: null,
    });
    expect(folderService.childCounts(db, folder.id)).toEqual({
      tripCount: 1,
      folderCount: 1,
    });
  });

  it('cascades to child folders but detaches trips on delete', () => {
    const folder = folderService.create(db, { name: 'F', parentId: null }).result;
    folderService.create(db, { name: 'Sub', parentId: folder.id });
    const trip = tripService.create(db, {
      name: 'T',
      folderId: folder.id,
      description: null,
      notes: null,
    }).result;

    folderService.remove(db, folder.id);

    expect(folderService.list(db)).toHaveLength(0);
    // The trip survives, detached to the root. Less surprising than destroying
    // a user's trip because they tidied a folder.
    expect(tripService.get(db, trip.id).folderId).toBeNull();
  });

  it('throws NOT_FOUND for an unknown folder', () => {
    expect(() => folderService.get(db, '0190c3ae-1f2b-7c4d-9e8f-1a2b3c4d5e6f')).toThrow(
      ServiceError,
    );
  });
});

// -------------------------------------------------------------------- trips

const newTrip = (name: string, folderId: string | null = null) =>
  tripService.create(db, { name, folderId, description: null, notes: null })
    .result;

describe('tripService', () => {
  it('creates a trip with timestamps and active status', () => {
    const trip = newTrip('Dolomites');
    expect(trip.name).toBe('Dolomites');
    expect(trip.status).toBe('active');
    expect(trip.createdAt).toBeGreaterThan(0);
    expect(trip.updatedAt).toBe(trip.createdAt);
  });

  it('allows duplicate names, as BaseCamp does', () => {
    newTrip('Same');
    expect(() => newTrip('Same')).not.toThrow();
    expect(tripService.list(db, DEFAULT_LIST)).toHaveLength(2);
  });

  it('rejects creation into a folder that does not exist', () => {
    expect(() => newTrip('X', '0190c3ae-1f2b-7c4d-9e8f-1a2b3c4d5e6f')).toThrow(ServiceError);
  });

  it('renames a trip and reports the inverse', () => {
    const trip = newTrip('Before');
    const { result, inverse } = tripService.update(db, { id: trip.id, name: 'After' });
    expect(result.name).toBe('After');
    expect(inverse.kind).toBe('trip:update');
    expect(inverse.payload.name).toBe('Before');
  });

  it('updates description and notes, and allows clearing them', () => {
    const trip = newTrip('T');
    tripService.update(db, { id: trip.id, description: 'Via ferrata', notes: 'Bring helmet' });
    let fetched = tripService.get(db, trip.id);
    expect(fetched.description).toBe('Via ferrata');
    expect(fetched.notes).toBe('Bring helmet');

    tripService.update(db, { id: trip.id, description: null });
    fetched = tripService.get(db, trip.id);
    expect(fetched.description).toBeNull();
    expect(fetched.notes).toBe('Bring helmet');
  });

  it('moves a trip between folders', () => {
    const folder = folderService.create(db, { name: 'F', parentId: null }).result;
    const trip = newTrip('T');
    expect(tripService.move(db, { id: trip.id, folderId: folder.id }).result.folderId).toBe(
      folder.id,
    );
    expect(tripService.move(db, { id: trip.id, folderId: null }).result.folderId).toBeNull();
  });

  it('archives a trip and hides it from the default listing', () => {
    const trip = newTrip('T');
    tripService.setStatus(db, { id: trip.id, status: 'archived' });

    expect(tripService.list(db, DEFAULT_LIST)).toHaveLength(0);
    expect(
      tripService.list(db, { ...DEFAULT_LIST, includeArchived: true }),
    ).toHaveLength(1);
    // Still reachable directly.
    expect(tripService.get(db, trip.id).status).toBe('archived');
  });

  it('duplicates a trip into an independent copy with a distinct name', () => {
    const trip = newTrip('Original');
    tripService.update(db, { id: trip.id, notes: 'shared note' });

    const copy = tripService.duplicate(db, trip.id).result;
    expect(copy.id).not.toBe(trip.id);
    expect(copy.name).toBe('Original copy');
    expect(copy.notes).toBe('shared note');

    // Editing the copy must not touch the original.
    tripService.update(db, { id: copy.id, name: 'Changed' });
    expect(tripService.get(db, trip.id).name).toBe('Original');
  });

  it('deletes a trip and reports what went with it', () => {
    const trip = newTrip('T');
    const { result } = tripService.remove(db, trip.id);
    expect(result).toEqual({
      id: trip.id,
      routeCount: 0,
      trackCount: 0,
      waypointCount: 0,
    });
    expect(tripService.list(db, DEFAULT_LIST)).toHaveLength(0);
  });

  it('refuses to delete a trip twice', () => {
    const trip = newTrip('T');
    tripService.remove(db, trip.id);
    expect(() => tripService.remove(db, trip.id)).toThrow(ServiceError);
  });

  it('sorts by name and by date in both directions', () => {
    const b = newTrip('Bravo');
    const a = newTrip('Alpha');

    const byNameAsc = tripService.list(db, {
      ...DEFAULT_LIST,
      sortKey: 'name',
      sortDirection: 'asc',
    });
    expect(byNameAsc.map((t) => t.name)).toEqual(['Alpha', 'Bravo']);

    const byNameDesc = tripService.list(db, {
      ...DEFAULT_LIST,
      sortKey: 'name',
      sortDirection: 'desc',
    });
    expect(byNameDesc.map((t) => t.name)).toEqual(['Bravo', 'Alpha']);

    const byCreated = tripService.list(db, {
      ...DEFAULT_LIST,
      sortKey: 'createdAt',
      sortDirection: 'asc',
    });
    expect(byCreated.map((t) => t.id)).toEqual([b.id, a.id]);
  });

  it('filters by folder, including the unfiled root', () => {
    const folder = folderService.create(db, { name: 'F', parentId: null }).result;
    newTrip('InFolder', folder.id);
    newTrip('AtRoot');

    expect(
      tripService.list(db, { ...DEFAULT_LIST, folderId: folder.id }).map((t) => t.name),
    ).toEqual(['InFolder']);
    expect(
      tripService.list(db, { ...DEFAULT_LIST, folderId: null }).map((t) => t.name),
    ).toEqual(['AtRoot']);
  });

  it('searches case-insensitively and treats wildcards literally', () => {
    newTrip('Dolomites Traverse');
    newTrip('Pyrenees');
    newTrip('100% Scrambling');

    expect(tripService.search(db, 'dolo').map((t) => t.name)).toEqual([
      'Dolomites Traverse',
    ]);
    expect(tripService.search(db, 'TRAVERSE')).toHaveLength(1);
    // A literal '%' must not behave as a wildcard matching everything.
    expect(tripService.search(db, '%').map((t) => t.name)).toEqual([
      '100% Scrambling',
    ]);
    expect(tripService.search(db, '')).toEqual([]);
  });

  it('reports zero child counts for an empty trip', () => {
    // Non-zero counts are covered in routesWaypoints.test.ts. Asserting only
    // the empty case here would pass even if the count query were broken —
    // which it was, until the correlated subquery was fixed.
    const trip = newTrip('T');
    expect(tripService.get(db, trip.id).routeCount).toBe(0);
    expect(tripService.get(db, trip.id).trackCount).toBe(0);
    expect(tripService.get(db, trip.id).waypointCount).toBe(0);
  });
});

// ----------------------------------------------------------------- settings

describe('settingsService', () => {
  it('returns defaults for a fresh database', () => {
    expect(settingsService.all(db)).toEqual(DEFAULT_SETTINGS);
  });

  it('persists a single setting and returns the full object', () => {
    const updated = settingsService.set(db, 'theme', 'dark');
    expect(updated.theme).toBe('dark');
    expect(updated.units).toBe(DEFAULT_SETTINGS.units);
    expect(settingsService.all(db).theme).toBe('dark');
  });

  it('overwrites rather than duplicating on repeated writes', () => {
    settingsService.set(db, 'units', 'imperial');
    settingsService.set(db, 'units', 'metric');
    expect(settingsService.all(db).units).toBe('metric');
  });

  it('round-trips structured values', () => {
    const layout = {
      libraryWidth: 320,
      propertiesWidth: 400,
      libraryVisible: false,
      propertiesVisible: true,
    };
    expect(settingsService.set(db, 'panelLayout', layout).panelLayout).toEqual(layout);
  });

  it('round-trips null for window geometry', () => {
    settingsService.set(db, 'windowGeometry', { x: 1, y: 2, width: 1280, height: 800 });
    expect(settingsService.set(db, 'windowGeometry', null).windowGeometry).toBeNull();
  });

  it('writes several settings atomically', () => {
    const updated = settingsService.setMany(db, [
      { key: 'theme', value: 'light' },
      { key: 'units', value: 'imperial' },
    ]);
    expect(updated.theme).toBe('light');
    expect(updated.units).toBe('imperial');
  });

  it('falls back to a default and reports a corrupt stored value', () => {
    handle.sqlite
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
      .run('theme', '{not json');
    expect(settingsService.all(db).theme).toBe(DEFAULT_SETTINGS.theme);
    expect(settingsService.corruptKeys(db)).toContain('theme');
  });

  it('ignores a stale key left by an older build', () => {
    handle.sqlite
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
      .run('someRemovedSetting', '"x"');
    expect(() => settingsService.all(db)).not.toThrow();
    expect(settingsService.all(db)).toEqual(DEFAULT_SETTINGS);
  });
});

// ------------------------------------------------------------------ library

describe('libraryService.tree', () => {
  it('roots at My Collection with the specified view branches', () => {
    const root = libraryService.tree(db, { includeArchived: false });
    expect(root.kind).toBe('root');
    expect(root.name).toBe('My Collection');
    expect(root.children.map((c) => c.name)).toEqual([
      'Trips',
      'Routes',
      'Tracks',
      'Waypoints',
      'Imported Data',
      'Recently Used',
    ]);
  });

  it('marks later-phase views unavailable rather than showing empty branches', () => {
    const root = libraryService.tree(db, { includeArchived: false });
    const byId = new Map(root.children.map((c) => [c.viewId, c]));

    // Implemented as of Phase 2.
    expect(byId.get('trips')?.available).toBe(true);
    expect(byId.get('routes')?.available).toBe(true);
    expect(byId.get('waypoints')?.available).toBe(true);

    // Still to come: tracks and imports are Phase 3.
    expect(byId.get('tracks')?.available).toBe(false);
    expect(byId.get('imported')?.available).toBe(false);
    expect(byId.get('recent')?.available).toBe(false);
  });

  it('nests folders and places trips inside them', () => {
    const europe = folderService.create(db, { name: 'Europe', parentId: null }).result;
    const alps = folderService.create(db, { name: 'Alps', parentId: europe.id }).result;
    tripService.create(db, {
      name: 'Haute Route',
      folderId: alps.id,
      description: null,
      notes: null,
    });
    tripService.create(db, { name: 'Unfiled', folderId: null, description: null, notes: null });

    const trips = libraryService
      .tree(db, { includeArchived: false })
      .children.find((c) => c.viewId === 'trips');

    const europeNode = trips?.children.find((c) => c.name === 'Europe');
    const alpsNode = europeNode?.children.find((c) => c.name === 'Alps');
    expect(alpsNode?.children.map((c) => c.name)).toEqual(['Haute Route']);
    expect(trips?.children.map((c) => c.name)).toContain('Unfiled');
  });

  it('honours the archived filter', () => {
    const trip = tripService.create(db, {
      name: 'Old',
      folderId: null,
      description: null,
      notes: null,
    }).result;
    tripService.setStatus(db, { id: trip.id, status: 'archived' });

    const hidden = libraryService
      .tree(db, { includeArchived: false })
      .children.find((c) => c.viewId === 'trips');
    expect(hidden?.children).toHaveLength(0);

    const shown = libraryService
      .tree(db, { includeArchived: true })
      .children.find((c) => c.viewId === 'trips');
    expect(shown?.children.map((c) => c.name)).toEqual(['Old']);
  });

  it('terminates on a deep folder chain', () => {
    let parentId: string | null = null;
    for (let i = 0; i < 25; i += 1) {
      parentId = folderService.create(db, { name: `L${i}`, parentId }).result.id;
    }
    expect(() => libraryService.tree(db, { includeArchived: false })).not.toThrow();
  });
});
