import { createDatabase, type DbHandle } from './db/client';
import { appPaths, type AppPaths } from './paths';

/**
 * The main process's mutable state, in one place.
 *
 * The database handle is replaceable because restoring a backup closes the live
 * database and opens a different file. Handlers therefore read `ctx.handle` at
 * call time rather than capturing it, otherwise they would hold a closed
 * connection after a restore.
 */
export interface AppContext {
  paths: AppPaths;
  handle: DbHandle;
  /** Set once the window exists, for pushing events to the renderer. */
  notifyLibraryChanged: () => void;
}

let context: AppContext | null = null;

export function initContext(): AppContext {
  const paths = appPaths();
  const handle = createDatabase({ file: paths.databaseFile });
  context = {
    paths,
    handle,
    notifyLibraryChanged: () => {},
  };
  return context;
}

export function ctx(): AppContext {
  if (context === null) {
    throw new Error('Application context used before initialisation');
  }
  return context;
}

/** Used after a restore to point the application at the replaced file. */
export function reopenDatabase(): DbHandle {
  const current = ctx();
  current.handle = createDatabase({ file: current.paths.databaseFile });
  return current.handle;
}

export function closeContext(): void {
  if (context === null) return;
  context.handle.close();
  context = null;
}
