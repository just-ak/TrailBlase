import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

/**
 * Filesystem layout, all under the macOS application support directory.
 *
 * The only module that knows these locations. Everything else is handed a path,
 * which is what lets the database and backup code be unit-tested against a temp
 * directory with no Electron in the loop.
 *
 * TRAILRT_USER_DATA overrides the root. End-to-end tests set it so they never
 * touch a real user's collection (Requirement 13.4).
 */

/**
 * Applies the TRAILRT_USER_DATA override.
 *
 * Must run before `app.requestSingleInstanceLock()` and before the app is
 * ready. Two reasons, both learned the hard way:
 *
 * - The single-instance lock is scoped to the user data directory. Setting the
 *   path afterwards means every instance locks the *default* directory, so two
 *   runs with different data directories still fight over one lock.
 * - Chromium creates its own caches under the user data path during startup.
 *   Moving the path later leaves those directories behind in the wrong place
 *   and logs "Failed to create directory" errors.
 */
export function configureUserDataPath(): void {
  const override = process.env.TRAILRT_USER_DATA;
  if (override !== undefined && override.length > 0) {
    mkdirSync(override, { recursive: true });
    app.setPath('userData', override);
  }
}

export interface AppPaths {
  userData: string;
  databaseFile: string;
  backupsDir: string;
  attachmentsDir: string;
}

let cached: AppPaths | null = null;

export function appPaths(): AppPaths {
  if (cached !== null) return cached;

  const userData = app.getPath('userData');
  const paths: AppPaths = {
    userData,
    databaseFile: join(userData, 'trailrt.db'),
    backupsDir: join(userData, 'backups'),
    attachmentsDir: join(userData, 'attachments'),
  };

  mkdirSync(paths.userData, { recursive: true });
  mkdirSync(paths.backupsDir, { recursive: true });
  mkdirSync(paths.attachmentsDir, { recursive: true });

  cached = paths;
  return paths;
}

/** Only for tests, which may need to re-resolve after changing the override. */
export function resetAppPathsCache(): void {
  cached = null;
}
