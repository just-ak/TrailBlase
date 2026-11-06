import type { TrailRtApi } from '@shared/ipc/api';

declare global {
  interface Window {
    /**
     * Exposed by the preload script. The only route from the renderer to the
     * system — there is no filesystem or database access here by design.
     */
    readonly trailrt: TrailRtApi;
  }
}
