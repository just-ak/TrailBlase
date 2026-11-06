import { sql } from 'drizzle-orm';
import {
  blob,
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  unique,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

/**
 * The full schema from section 12 of the source specification, created in one
 * migration rather than grown per phase.
 *
 * Phase 1 only wires repositories for folders, trips, settings and import
 * history. The remaining tables exist so Phases 2 and 3 add behaviour rather
 * than structure, which keeps migrations out of the critical path later.
 *
 * Conventions:
 * - Text UUID primary keys.
 * - Timestamps are INTEGER UTC epoch milliseconds.
 * - Distances and elevations are REAL metres (SI).
 * - Nullable means genuinely absent. Never a sentinel zero.
 * - Columns marked "cache" are derived and rebuildable from a source of truth.
 */

const now = sql`(unixepoch('subsec') * 1000)`;

export const folders = sqliteTable(
  'folders',
  {
    id: text('id').primaryKey(),
    parentId: text('parent_id').references((): AnySQLiteColumn => folders.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [index('idx_folders_parent').on(t.parentId)],
);

export const trips = sqliteTable(
  'trips',
  {
    id: text('id').primaryKey(),
    folderId: text('folder_id').references(() => folders.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    description: text('description'),
    notes: text('notes'),
    status: text('status').notNull().default('active'),
    /** Opaque JSON for format-specific metadata preserved on import. */
    metadata: text('metadata'),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [
    index('idx_trips_folder').on(t.folderId),
    index('idx_trips_status').on(t.status),
    index('idx_trips_updated').on(t.updatedAt),
    check('trips_status_valid', sql`${t.status} in ('active', 'archived')`),
  ],
);

/** Phase 2. */
export const routes = sqliteTable(
  'routes',
  {
    id: text('id').primaryKey(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    colour: text('colour'),
    source: text('source').notNull().default('user'),
    pointCount: integer('point_count').notNull().default(0), // cache
    distanceM: real('distance_m'), // cache
    elevGainM: real('elev_gain_m'), // cache; null when no elevation data
    elevLossM: real('elev_loss_m'), // cache
    /**
     * JSON for fields an imported format carried that have no column of their
     * own — GPX extensions, <url>, KML ExtendedData. Preserved so Phase 6 can
     * round-trip them, and reported to the user on import.
     *
     * Phase 4 also records `unmatchedLegs` here: control-point index pairs a
     * routing provider could not match to a road.
     */
    metadata: text('metadata'),
    /**
     * Phase 4. Which routing provider produced this geometry, so its origin is
     * auditable (Requirement 2.4).
     *
     * **Null means hand-drawn.** That is what keeps every pre-Phase-4 route
     * behaving exactly as before without a feature flag.
     */
    routingProvider: text('routing_provider'),
    /** The mode the snap was computed for; the same points snap differently. */
    transportMode: text('transport_mode'),
    snappedAt: integer('snapped_at'),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [
    index('idx_routes_trip').on(t.tripId),
    check('routes_source_valid', sql`${t.source} in ('user', 'import')`),
  ],
);

/**
 * Phase 4. The points the user placed, as distinct from the shape that is drawn.
 *
 * `route_points` holds the geometry — road shape after a snap, or the user's own
 * straight lines before one. This table holds intent, which is what makes a
 * re-snap of one leg possible instead of discarding and redrawing the whole
 * route. See Requirement 3.3 and the Phase 4 design.
 *
 * No rows for a route means it was hand-drawn and never snapped.
 */
export const routeControlPoints = sqliteTable(
  'route_control_points',
  {
    id: text('id').primaryKey(),
    routeId: text('route_id')
      .notNull()
      .references(() => routes.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    lat: real('lat').notNull(),
    lon: real('lon').notNull(),
  },
  (t) => [unique('uq_route_control_points_seq').on(t.routeId, t.seq)],
);

/**
 * Phase 4. Map-matched road attributes. A cache, never a source of truth.
 *
 * `geometryHash` is recomputed from the current geometry on read; a mismatch
 * means the cache is stale and is discarded. That is how the
 * invalidate-on-edit rule in `.kiro/steering/architecture.md` is enforced
 * without a trigger or a hook anyone could forget to call.
 *
 * `fetchedAt` is displayed with the data, so cached attributes shown while a
 * provider is unreachable carry their age rather than looking current.
 */
export const roadAttributes = sqliteTable(
  'road_attributes',
  {
    id: text('id').primaryKey(),
    /** 'route' or 'track'. Tracks are matched for reading only. */
    ownerType: text('owner_type').notNull(),
    ownerId: text('owner_id').notNull(),
    provider: text('provider').notNull(),
    geometryHash: text('geometry_hash').notNull(),
    fetchedAt: integer('fetched_at').notNull(),
    /** JSON: per-edge speed limit, road class and surface. */
    payload: text('payload').notNull(),
  },
  (t) => [
    unique('uq_road_attributes_owner').on(t.ownerType, t.ownerId),
    index('idx_road_attributes_fetched').on(t.fetchedAt),
  ],
);

/** Phase 2. Source of truth for route geometry. */
export const routePoints = sqliteTable(
  'route_points',
  {
    id: text('id').primaryKey(),
    routeId: text('route_id')
      .notNull()
      .references(() => routes.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    lat: real('lat').notNull(),
    lon: real('lon').notNull(),
    eleM: real('ele_m'),
    name: text('name'),
    symbol: text('symbol'),
    notes: text('notes'),
  },
  (t) => [unique('uq_route_points_seq').on(t.routeId, t.seq)],
);

/** Phase 3. */
export const tracks = sqliteTable(
  'tracks',
  {
    id: text('id').primaryKey(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    colour: text('colour'),
    width: integer('width'),
    source: text('source').notNull().default('import'),
    pointCount: integer('point_count').notNull().default(0), // cache
    distanceM: real('distance_m'), // cache
    elevGainM: real('elev_gain_m'), // cache
    elevLossM: real('elev_loss_m'), // cache
    startedAt: integer('started_at'),
    endedAt: integer('ended_at'),
    /**
     * Cache: simplified polyline for map rendering below a zoom threshold.
     * Rebuildable from track_points and invalidated on edit. Never the only
     * copy of the geometry. See ADR 0003.
     */
    renderGeometry: blob('render_geometry', { mode: 'buffer' }),
    renderToleranceM: real('render_tolerance_m'),
    /** As routes: imported fields with no column, preserved verbatim. */
    metadata: text('metadata'),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [index('idx_tracks_trip').on(t.tripId)],
);

/** Phase 3. Source of truth for track geometry. See ADR 0003. */
export const trackPoints = sqliteTable(
  'track_points',
  {
    id: text('id').primaryKey(),
    trackId: text('track_id')
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    segmentIndex: integer('segment_index').notNull().default(0),
    seq: integer('seq').notNull(),
    lat: real('lat').notNull(),
    lon: real('lon').notNull(),
    eleM: real('ele_m'),
    recordedAt: integer('recorded_at'),
  },
  (t) => [
    unique('uq_track_points_seq').on(t.trackId, t.segmentIndex, t.seq),
  ],
);

/**
 * Phase 3. The original imported bytes, retained so "preserve the original
 * data" is literally true and any edit can be rolled back to the import.
 */
export const trackSources = sqliteTable('track_sources', {
  id: text('id').primaryKey(),
  trackId: text('track_id')
    .notNull()
    .references(() => tracks.id, { onDelete: 'cascade' }),
  format: text('format').notNull(),
  contentHash: text('content_hash').notNull(),
  originalBytes: blob('original_bytes', { mode: 'buffer' }).notNull(),
  createdAt: integer('created_at').notNull().default(now),
});

/** Phase 2. */
export const waypointGroups = sqliteTable('waypoint_groups', {
  id: text('id').primaryKey(),
  tripId: text('trip_id')
    .notNull()
    .references(() => trips.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull().default(now),
});

/** Phase 2. */
export const waypoints = sqliteTable(
  'waypoints',
  {
    id: text('id').primaryKey(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    groupId: text('group_id').references(() => waypointGroups.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    lat: real('lat').notNull(),
    lon: real('lon').notNull(),
    eleM: real('ele_m'),
    description: text('description'),
    symbol: text('symbol'),
    notes: text('notes'),
    source: text('source').notNull().default('user'),
    /** As routes: imported fields with no column, preserved verbatim. */
    metadata: text('metadata'),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [
    index('idx_waypoints_trip').on(t.tripId),
    index('idx_waypoints_coords').on(t.lat, t.lon),
  ],
);

/**
 * Attachment bytes live on disk under the application support directory; this
 * table holds metadata and a relative path. Keeps the database small enough
 * that rolling backups stay cheap.
 */
export const attachments = sqliteTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    ownerType: text('owner_type').notNull(),
    ownerId: text('owner_id').notNull(),
    kind: text('kind').notNull(),
    relativePath: text('relative_path').notNull(),
    contentHash: text('content_hash').notNull(),
    byteSize: integer('byte_size').notNull(),
    mimeType: text('mime_type'),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [
    index('idx_attachments_owner').on(t.ownerType, t.ownerId),
    check(
      'attachments_owner_type_valid',
      sql`${t.ownerType} in ('trip', 'route', 'track', 'waypoint')`,
    ),
  ],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  /** JSON-encoded value, validated against its own zod schema on write. */
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull().default(now),
});

export const importHistory = sqliteTable(
  'import_history',
  {
    id: text('id').primaryKey(),
    sourceName: text('source_name').notNull(),
    sourceFormat: text('source_format').notNull(),
    destinationTripId: text('destination_trip_id').references(() => trips.id, {
      onDelete: 'set null',
    }),
    status: text('status').notNull(),
    /** JSON: counts, warnings, unsupported objects, unmapped metadata. */
    report: text('report').notNull(),
    startedAt: integer('started_at').notNull().default(now),
    finishedAt: integer('finished_at'),
  },
  (t) => [
    index('idx_import_history_started').on(t.startedAt),
    check(
      'import_history_status_valid',
      sql`${t.status} in ('success', 'partial', 'failed')`,
    ),
  ],
);

/** Backs the "Recently Used" library view. */
export const recentItems = sqliteTable(
  'recent_items',
  {
    itemType: text('item_type').notNull(),
    itemId: text('item_id').notNull(),
    accessedAt: integer('accessed_at').notNull().default(now),
  },
  (t) => [
    unique('uq_recent_items').on(t.itemType, t.itemId),
    index('idx_recent_items_accessed').on(t.accessedAt),
  ],
);

export type FolderRow = typeof folders.$inferSelect;
export type TripRow = typeof trips.$inferSelect;
export type SettingsRow = typeof settings.$inferSelect;
export type ImportHistoryRow = typeof importHistory.$inferSelect;
