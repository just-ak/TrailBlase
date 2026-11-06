import { create } from 'zustand';
import type { SpeedDistribution } from '@shared/geo/speedBands';
import type { MatchedEdge } from '@shared/routing/RoutingProvider';
import type {
  AttributeOwnerType,
  AttributeStatus,
  Profile,
  RouteProvenance,
  RoutingStatus,
} from '@shared/routing/results';
import { api, callOr } from '../lib/client';

/**
 * Routing and road-attribute state.
 *
 * Separate from `geometryStore` because none of it is geometry and all of it is
 * optional: with no provider configured every field here stays empty and the
 * rest of the application is unaffected. That is the shape the no-cloud policy
 * requires — the routing feature is additive, not load-bearing.
 *
 * Nothing in this store calls the provider on its own. Every network-touching
 * fetch is started by an explicit user action, so selecting a route does not
 * quietly issue a request.
 */

/** A profile or distribution keyed by the geometry it describes. */
type OwnerKey = `${AttributeOwnerType}:${string}`;

const keyOf = (ownerType: AttributeOwnerType, ownerId: string): OwnerKey =>
  `${ownerType}:${ownerId}`;

export interface DistributionEntry {
  distribution: SpeedDistribution;
  status: AttributeStatus | null;
}

interface RoutingState {
  status: RoutingStatus | null;
  /** True while a snap or match is in flight, keyed by owner. */
  busy: Record<string, boolean>;

  profiles: Partial<Record<OwnerKey, Profile>>;
  posted: Partial<Record<OwnerKey, DistributionEntry | null>>;
  recorded: Partial<Record<OwnerKey, DistributionEntry | null>>;
  attributes: Partial<
    Record<OwnerKey, { status: AttributeStatus; edges: MatchedEdge[] } | null>
  >;
  /**
   * Snap provenance by route id.
   *
   * Loaded on selection, unlike everything else in this store, because it is a
   * purely local database read — it cannot cause a request. The map needs it to
   * draw unmatched legs, and waiting for a user gesture to show a warning about
   * the route they are already looking at would defeat the point.
   */
  provenance: Record<string, RouteProvenance>;

  loadStatus(): Promise<RoutingStatus | null>;
  loadProvenance(routeId: string): Promise<void>;
  loadProfile(
    ownerType: AttributeOwnerType,
    ownerId: string,
  ): Promise<Profile | null>;
  loadAttributes(
    ownerType: AttributeOwnerType,
    ownerId: string,
  ): Promise<void>;
  loadDistribution(
    ownerType: AttributeOwnerType,
    ownerId: string,
    source: 'posted' | 'recorded',
  ): Promise<void>;
  setBusy(ownerType: AttributeOwnerType, ownerId: string, busy: boolean): void;
  isBusy(ownerType: AttributeOwnerType, ownerId: string): boolean;
  /** Drops everything cached for one geometry, after it changes. */
  invalidate(ownerType: AttributeOwnerType, ownerId: string): void;
  clear(): void;
}

export const useRoutingStore = create<RoutingState>((set, get) => ({
  status: null,
  busy: {},
  profiles: {},
  posted: {},
  recorded: {},
  attributes: {},
  provenance: {},

  loadStatus: async () => {
    const status = await callOr(api().routing.status(), null);
    set({ status });
    return status;
  },

  loadProvenance: async (routeId) => {
    const entry = await callOr(api().routing.provenance({ routeId }), null);
    if (entry === null) return;
    set({ provenance: { ...get().provenance, [routeId]: entry } });
  },

  loadProfile: async (ownerType, ownerId) => {
    const profile = await callOr(
      api().routing.profile({ ownerType, ownerId }),
      null,
    );
    if (profile === null) return null;
    set({ profiles: { ...get().profiles, [keyOf(ownerType, ownerId)]: profile } });
    return profile;
  },

  loadAttributes: async (ownerType, ownerId) => {
    const entry = await callOr(
      api().routing.attributes({ ownerType, ownerId }),
      null,
    );
    set({
      attributes: {
        ...get().attributes,
        [keyOf(ownerType, ownerId)]: entry,
      },
    });
  },

  loadDistribution: async (ownerType, ownerId, source) => {
    const entry = await callOr(
      api().routing.speedDistribution({ ownerType, ownerId, source }),
      null,
    );
    const key = keyOf(ownerType, ownerId);
    if (source === 'posted') {
      set({ posted: { ...get().posted, [key]: entry } });
    } else {
      set({ recorded: { ...get().recorded, [key]: entry } });
    }
  },

  setBusy: (ownerType, ownerId, busy) =>
    set({ busy: { ...get().busy, [keyOf(ownerType, ownerId)]: busy } }),

  isBusy: (ownerType, ownerId) =>
    get().busy[keyOf(ownerType, ownerId)] === true,

  invalidate: (ownerType, ownerId) => {
    const key = keyOf(ownerType, ownerId);
    const drop = <T,>(record: Partial<Record<OwnerKey, T>>): Partial<
      Record<OwnerKey, T>
    > => {
      const next = { ...record };
      delete next[key];
      return next;
    };
    const provenance = { ...get().provenance };
    if (ownerType === 'route') delete provenance[ownerId];

    set({
      profiles: drop(get().profiles),
      posted: drop(get().posted),
      recorded: drop(get().recorded),
      attributes: drop(get().attributes),
      provenance,
    });
  },

  clear: () =>
    set({
      profiles: {},
      posted: {},
      recorded: {},
      attributes: {},
      provenance: {},
      busy: {},
    }),
}));

export const routingKey = keyOf;
