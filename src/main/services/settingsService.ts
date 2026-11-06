import type { AppSettings, SettingsKey } from '@shared/domain/types';
import type { Db } from '../db/client';
import * as repo from '../db/repositories/settings';

/**
 * Settings use cases.
 *
 * Values arrive already validated by the IPC layer's discriminated-union
 * schema, so this layer's job is persistence plus returning the full settings
 * object — the renderer keeps a mirror and needs the canonical state back after
 * every write.
 */

export function all(db: Db): AppSettings {
  return repo.loadSettings(db).settings;
}

/** Keys whose stored JSON was unreadable and fell back to a default. */
export function corruptKeys(db: Db): SettingsKey[] {
  return repo.loadSettings(db).corruptKeys;
}

export function set(
  db: Db,
  key: SettingsKey,
  value: unknown,
): AppSettings {
  repo.writeSetting(db, key, value, Date.now());
  return all(db);
}

/** Used by the window and map modules to persist UI state as it changes. */
export function setMany(
  db: Db,
  entries: readonly { key: SettingsKey; value: unknown }[],
): AppSettings {
  const now = Date.now();
  db.transaction(() => {
    for (const entry of entries) {
      repo.writeSetting(db, entry.key, entry.value, now);
    }
  });
  return all(db);
}
