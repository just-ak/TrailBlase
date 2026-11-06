import { create } from 'zustand';
import type { Folder, ObjectRef, TripWithCounts } from '@shared/domain/types';
import { api, callOr } from '../lib/client';

/**
 * What is currently selected, and the loaded detail for it.
 *
 * Selection is a reference plus separately-fetched detail rather than a copy of
 * the object, so the properties panel always reflects canonical state after a
 * mutation.
 */

interface SelectionState {
  selected: ObjectRef | null;
  trip: TripWithCounts | null;
  folder: Folder | null;
  loading: boolean;

  select(ref: ObjectRef | null): Promise<void>;
  reload(): Promise<void>;
  clear(): void;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selected: null,
  trip: null,
  folder: null,
  loading: false,

  select: async (ref) => {
    set({ selected: ref, trip: null, folder: null });
    if (ref === null) return;
    await get().reload();
  },

  reload: async () => {
    const ref = get().selected;
    if (ref === null) return;

    set({ loading: true });
    if (ref.kind === 'trip') {
      const trip = await callOr(api().trips.get({ id: ref.id }), null);
      // A deleted object clears the selection rather than showing stale detail.
      set({ trip, folder: null, loading: false, ...(trip === null ? { selected: null } : {}) });
      return;
    }
    if (ref.kind === 'folder') {
      const folder = await callOr(api().folders.get({ id: ref.id }), null);
      set({ folder, trip: null, loading: false, ...(folder === null ? { selected: null } : {}) });
      return;
    }
    // Routes, tracks and waypoints are Phases 2 and 3.
    set({ loading: false });
  },

  clear: () => set({ selected: null, trip: null, folder: null }),
}));
