import { eq } from 'drizzle-orm';
import { DEFAULT_SETTINGS } from '@shared/domain/defaults';
import type { AppSettings, SettingsKey } from '@shared/domain/types';
import type { Db } from '../client';
import { settings } from '../schema';

/**
 * Settings are stored as one row per key with a JSON-encoded value, so adding a
 * setting needs no migration.
 *
 * Reads merge over `DEFAULT_SETTINGS`, which means a missing or corrupt row
 * degrades to the default rather than crashing the app on launch. A corrupt row
 * is reported to the caller rather than swallowed silently.
 */

export interface LoadSettingsResult {
  settings: AppSettings;
  /** Keys whose stored JSON could not be parsed and fell back to defaults. */
  corruptKeys: SettingsKey[];
}

export function loadSettings(db: Db): LoadSettingsResult {
  const rows = db.select().from(settings).all();
  const result: AppSettings = structuredClone(DEFAULT_SETTINGS);
  const corruptKeys: SettingsKey[] = [];

  for (const row of rows) {
    if (!(row.key in DEFAULT_SETTINGS)) continue; // stale key from an older build
    const key = row.key as SettingsKey;
    try {
      // Validated against its zod schema on write, so a parse failure here
      // means the file was edited or damaged outside the app.
      (result as unknown as Record<string, unknown>)[key] = JSON.parse(
        row.value,
      );
    } catch {
      corruptKeys.push(key);
    }
  }

  return { settings: result, corruptKeys };
}

export function writeSetting(
  db: Db,
  key: SettingsKey,
  value: unknown,
  now: number,
): void {
  db.insert(settings)
    .values({ key, value: JSON.stringify(value), updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: JSON.stringify(value), updatedAt: now },
    })
    .run();
}

export function deleteSetting(db: Db, key: SettingsKey): void {
  db.delete(settings).where(eq(settings.key, key)).run();
}
