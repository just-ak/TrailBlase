import type { AppSettings, SettingsKey } from '@shared/domain/types';
import { routingConnectOrigin } from '@shared/net/origin';
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

/**
 * Consent is per-host, so pointing the app at a different routing service
 * withdraws it.
 *
 * Without this, a user who agreed to send coordinates to their own
 * `localhost:8002` would still be consenting, silently, after the endpoint was
 * changed to someone else's server. Consent to one host is not consent to the
 * next one.
 *
 * Returns the extra writes a batch needs, so both `set` and `setMany` get the
 * invariant from the same place and one of them cannot drift out of it. An
 * endpoint edit that leaves the origin unchanged — adding a path, fixing the
 * case of the host — keeps consent, because the user is not being asked to
 * trust anyone new.
 */
function consentWithdrawals(
  db: Db,
  entries: readonly { key: SettingsKey; value: unknown }[],
): { key: SettingsKey; value: unknown }[] {
  const endpointEntry = entries.find((entry) => entry.key === 'routingEndpoint');
  if (endpointEntry === undefined || typeof endpointEntry.value !== 'string') {
    return [];
  }

  // An explicit consent value in the same batch wins: that is the user
  // accepting the prompt for the endpoint they just typed.
  if (entries.some((entry) => entry.key === 'routingConsentAccepted')) return [];

  const current = all(db);
  const changed =
    routingConnectOrigin(endpointEntry.value) !==
    routingConnectOrigin(current.routingEndpoint);

  return changed ? [{ key: 'routingConsentAccepted', value: false }] : [];
}

export function set(
  db: Db,
  key: SettingsKey,
  value: unknown,
): AppSettings {
  return setMany(db, [{ key, value }]);
}

/** Used by the window and map modules to persist UI state as it changes. */
export function setMany(
  db: Db,
  entries: readonly { key: SettingsKey; value: unknown }[],
): AppSettings {
  const now = Date.now();
  const writes = [...entries, ...consentWithdrawals(db, entries)];

  db.transaction(() => {
    for (const entry of writes) {
      repo.writeSetting(db, entry.key, entry.value, now);
    }
  });
  return all(db);
}
