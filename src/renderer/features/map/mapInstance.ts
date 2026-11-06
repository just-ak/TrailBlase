import { useSyncExternalStore } from 'react';
import type L from 'leaflet';

/**
 * A tiny external store holding the live Leaflet instance.
 *
 * Layer hooks need the map inside effects, but the instance is imperative
 * state that must not be read during render. `useSyncExternalStore` is exactly
 * the React primitive for subscribing to an external mutable source: it avoids
 * both reading a ref during render and setting state from an effect, which are
 * the two ways this is usually got wrong.
 */

let instance: L.Map | null = null;
const listeners = new Set<() => void>();

export function setMapInstance(next: L.Map | null): void {
  instance = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): L.Map | null {
  return instance;
}

export function useMapInstance(): L.Map | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

/** For imperative callers outside React, such as menu action handlers. */
export function getMapInstance(): L.Map | null {
  return instance;
}
