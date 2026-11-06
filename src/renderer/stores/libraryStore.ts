import { create } from 'zustand';
import { DEFAULT_SETTINGS } from '@shared/domain/defaults';
import type {
  AppSettings,
  SortDirection,
  TreeNode,
  TripSortKey,
  TripWithCounts,
} from '@shared/domain/types';
import type { WaypointWithTrip } from '@shared/ipc/api';
import { api, call, callOr } from '../lib/client';

/**
 * The library tree, its expansion state, sorting and search.
 *
 * The main process is the single source of truth; this store is a cache of it.
 * Mutations call the bridge and then refresh from the canonical result, with no
 * optimistic writes — correctness over perceived speed while the foundation
 * settles. ADR 0001.
 */

interface LibraryState {
  tree: TreeNode | null;
  loading: boolean;
  error: string | null;

  expanded: Set<string>;
  sortKey: TripSortKey;
  sortDirection: SortDirection;
  showArchived: boolean;

  search: string;
  searchResults: TripWithCounts[] | null;
  waypointResults: WaypointWithTrip[] | null;

  hydrate(settings: AppSettings): void;
  refresh(): Promise<void>;
  toggleExpanded(id: string): void;
  setExpanded(id: string, expanded: boolean): void;
  isExpanded(id: string): boolean;
  setSort(key: TripSortKey, direction: SortDirection): void;
  setShowArchived(show: boolean): void;
  setSearch(query: string): Promise<void>;
}

let expandedTimer: ReturnType<typeof setTimeout> | undefined;

function persistExpanded(ids: Set<string>): void {
  clearTimeout(expandedTimer);
  expandedTimer = setTimeout(() => {
    void callOr(
      api().settings.set({ key: 'expandedNodeIds', value: [...ids] }),
      null,
    );
  }, 300);
}

let searchSeq = 0;

export const useLibraryStore = create<LibraryState>((set, get) => ({
  tree: null,
  loading: false,
  error: null,

  expanded: new Set(DEFAULT_SETTINGS.expandedNodeIds),
  sortKey: DEFAULT_SETTINGS.tripSortKey,
  sortDirection: DEFAULT_SETTINGS.tripSortDirection,
  showArchived: DEFAULT_SETTINGS.showArchivedTrips,

  search: '',
  searchResults: null,
  waypointResults: null,

  hydrate: (settings) => {
    set({
      expanded: new Set(settings.expandedNodeIds),
      sortKey: settings.tripSortKey,
      sortDirection: settings.tripSortDirection,
      showArchived: settings.showArchivedTrips,
    });
  },

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const tree = await call(
        api().library.tree({ includeArchived: get().showArchived }),
      );
      set({ tree, loading: false });
    } catch (cause) {
      set({
        loading: false,
        error:
          cause instanceof Error
            ? cause.message
            : 'The library could not be loaded.',
      });
    }
  },

  toggleExpanded: (id) => get().setExpanded(id, !get().expanded.has(id)),

  setExpanded: (id, expanded) => {
    const next = new Set(get().expanded);
    if (expanded) next.add(id);
    else next.delete(id);
    set({ expanded: next });
    persistExpanded(next);
  },

  isExpanded: (id) => get().expanded.has(id),

  setSort: (sortKey, sortDirection) => {
    set({ sortKey, sortDirection });
    void callOr(api().settings.set({ key: 'tripSortKey', value: sortKey }), null);
    void callOr(
      api().settings.set({ key: 'tripSortDirection', value: sortDirection }),
      null,
    );
  },

  setShowArchived: (showArchived) => {
    set({ showArchived });
    void callOr(
      api().settings.set({ key: 'showArchivedTrips', value: showArchived }),
      null,
    );
    void get().refresh();
  },

  setSearch: async (query) => {
    set({ search: query });
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      set({ searchResults: null, waypointResults: null });
      return;
    }
    // Guard against an earlier request resolving after a later one.
    const seq = ++searchSeq;
    const [trips, waypoints] = await Promise.all([
      callOr(api().trips.search({ query: trimmed }), []),
      callOr(api().waypoints.search({ query: trimmed }), []),
    ]);
    if (seq === searchSeq) {
      set({ searchResults: trips, waypointResults: waypoints });
    }
  },
}));
