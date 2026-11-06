import type { AppSettings } from './types';

/**
 * Defaults for every setting, so a fresh database requires no seeding and a
 * missing key is never a crash.
 *
 * Units default to metric with a user preference, since storage is SI and the
 * conversion is display-only. The owner had not specified a default at the time
 * this was written.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  units: 'metric',
  mapProviderId: 'osm',
  mapOverlayId: '',
  customTileUrl: '',
  customOverlayUrl: '',
  // No routing service by default. This is the setting that keeps the
  // application fully functional with no network at all.
  routingEndpoint: '',
  routingConsentAccepted: false,
  transportMode: 'auto',
  showScaleBar: true,
  layerVisibility: { routes: true, tracks: true, waypoints: true },
  backupIntervalHours: 24,
  backupRetention: 7,
  planningSpeedKmh: 4.5,
  tripSortKey: 'updatedAt',
  tripSortDirection: 'desc',
  panelLayout: {
    libraryWidth: 280,
    propertiesWidth: 320,
    libraryVisible: true,
    propertiesVisible: true,
  },
  windowGeometry: null,
  // Centred on the Alps at a zoom that shows useful terrain rather than ocean.
  mapPosition: { lat: 46.8, lon: 8.2, zoom: 8 },
  expandedNodeIds: ['root', 'view:trips'],
  showArchivedTrips: false,
};

export const PANEL_LIMITS = {
  libraryMin: 200,
  libraryMax: 560,
  propertiesMin: 240,
  propertiesMax: 600,
} as const;
