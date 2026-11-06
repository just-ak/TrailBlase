import type { UndoState } from '@shared/domain/types';
import type { Db } from '../db/client';
import { applyCommand, isUndoable, labelFor, type Command } from './commands';
import { ServiceError } from './errors';

/**
 * The undo and redo history.
 *
 * Lives in the main process, beside the database, so it can never describe a
 * state the database was not in. A renderer-side stack would desynchronise the
 * moment a mutation arrived from a menu action or a backup restore.
 *
 * Entries hold command descriptors, not object snapshots, so the stack cannot
 * grow unboundedly with the size of the data.
 */

/** Deep enough for a work session, bounded so memory cannot run away. */
const MAX_DEPTH = 50;

interface Entry {
  command: Command;
  /** What the user did, for the menu label. */
  label: string;
}

const undoStack: Entry[] = [];
const redoStack: Entry[] = [];

export function state(): UndoState {
  const nextUndo = undoStack.at(-1);
  const nextRedo = redoStack.at(-1);
  return {
    canUndo: nextUndo !== undefined,
    canRedo: nextRedo !== undefined,
    undoLabel: nextUndo?.label ?? null,
    redoLabel: nextRedo?.label ?? null,
  };
}

/**
 * Records a completed mutation.
 *
 * `inverse` is the command that reverses what just happened. A kind of 'none'
 * means the action is deliberately not undoable — trip and folder deletion,
 * whose cascade spans several tables (ADR 0001) — and is skipped rather than
 * recorded as a no-op the user could click.
 */
export function record(inverse: Command, label?: string): UndoState {
  if (!isUndoable(inverse.kind)) return state();

  undoStack.push({ command: inverse, label: label ?? labelFor(inverse.kind) });
  if (undoStack.length > MAX_DEPTH) undoStack.shift();

  // A new action invalidates the redo branch. Branching history is not worth
  // the confusion it causes.
  redoStack.length = 0;

  return state();
}

export function undo(db: Db): UndoState {
  const entry = undoStack.pop();
  if (entry === undefined) {
    throw new ServiceError('BLOCKED', 'There is nothing to undo.');
  }

  // The entry is already popped, so a failure here discards it rather than
  // leaving a step that would fail again on every subsequent attempt and wedge
  // the Edit menu. The error propagates to the user.
  const mutation = applyCommand(db, entry.command);

  redoStack.push({ command: mutation.inverse, label: entry.label });
  if (redoStack.length > MAX_DEPTH) redoStack.shift();

  return state();
}

export function redo(db: Db): UndoState {
  const entry = redoStack.pop();
  if (entry === undefined) {
    throw new ServiceError('BLOCKED', 'There is nothing to redo.');
  }

  const mutation = applyCommand(db, entry.command);

  undoStack.push({ command: mutation.inverse, label: entry.label });
  if (undoStack.length > MAX_DEPTH) undoStack.shift();

  return state();
}

/**
 * Discards the history.
 *
 * Called after a backup restore: the stack describes a database that no longer
 * exists, and applying any of it would corrupt the restored data.
 */
export function clear(): UndoState {
  undoStack.length = 0;
  redoStack.length = 0;
  return state();
}

export const MAX_UNDO_DEPTH = MAX_DEPTH;
