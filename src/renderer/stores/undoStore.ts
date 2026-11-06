import { create } from 'zustand';
import type { UndoState } from '@shared/domain/types';
import { api, callOr } from '../lib/client';

/**
 * Mirror of the main process's undo history.
 *
 * The stack itself lives beside the database (see the Phase 2 design); this is
 * only what the Edit menu and keyboard shortcuts need to know — whether
 * anything is available and what it is called.
 */
interface UndoStoreState extends UndoState {
  load(): Promise<void>;
  apply(state: UndoState): void;
}

export const useUndoStore = create<UndoStoreState>((set) => ({
  canUndo: false,
  canRedo: false,
  undoLabel: null,
  redoLabel: null,

  load: async () => {
    const state = await callOr(api().undo.state(), null);
    if (state !== null) set(state);
  },

  apply: (state) => set(state),
}));
