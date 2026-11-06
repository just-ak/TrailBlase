import { z } from 'zod';

/**
 * Request schemas for every IPC channel. The main process validates against
 * these before touching a service, so a malformed or hostile payload from a
 * compromised renderer is rejected at the boundary.
 */

export const idSchema = z.uuid();

/** Trip and folder names. Duplicates are allowed, as in BaseCamp. */
export const nameSchema = z.string().trim().min(1).max(200);

export const optionalTextSchema = z.string().max(10_000).nullable();

export const latSchema = z.number().finite().min(-90).max(90);
export const lonSchema = z.number().finite().min(-180).max(180);

export const tripStatusSchema = z.enum(['active', 'archived']);
export const tripSortKeySchema = z.enum(['name', 'updatedAt', 'createdAt']);
export const sortDirectionSchema = z.enum(['asc', 'desc']);

export const emptySchema = z.object({}).strict();

// ---------------------------------------------------------------- library

export const libraryTreeRequest = z
  .object({
    includeArchived: z.boolean().default(false),
    /**
     * Ordering within the cross-trip views.
     *
     * Distance became meaningful in Phase 3, when tracks joined routes as
     * objects that have one.
     */
    sortKey: z.enum(['name', 'distance', 'updatedAt']).default('name'),
  })
  .strict();

// ------------------------------------------------------------------ trips

export const tripListRequest = z
  .object({
    folderId: idSchema.nullable().optional(),
    includeArchived: z.boolean().default(false),
    sortKey: tripSortKeySchema.default('updatedAt'),
    sortDirection: sortDirectionSchema.default('desc'),
  })
  .strict();

export const tripGetRequest = z.object({ id: idSchema }).strict();

export const tripCreateRequest = z
  .object({
    name: nameSchema,
    folderId: idSchema.nullable().default(null),
    description: optionalTextSchema.default(null),
    notes: optionalTextSchema.default(null),
  })
  .strict();

export const tripUpdateRequest = z
  .object({
    id: idSchema,
    name: nameSchema.optional(),
    description: optionalTextSchema.optional(),
    notes: optionalTextSchema.optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.name !== undefined ||
      v.description !== undefined ||
      v.notes !== undefined,
    { message: 'At least one field must be provided' },
  );

export const tripDuplicateRequest = z.object({ id: idSchema }).strict();

export const tripMoveRequest = z
  .object({ id: idSchema, folderId: idSchema.nullable() })
  .strict();

export const tripSetStatusRequest = z
  .object({ id: idSchema, status: tripStatusSchema })
  .strict();

export const tripDeleteRequest = z.object({ id: idSchema }).strict();

export const tripSearchRequest = z
  .object({ query: z.string().trim().max(200) })
  .strict();

// ---------------------------------------------------------------- folders

export const folderGetRequest = z.object({ id: idSchema }).strict();

export const folderCreateRequest = z
  .object({ name: nameSchema, parentId: idSchema.nullable().default(null) })
  .strict();

export const folderRenameRequest = z
  .object({ id: idSchema, name: nameSchema })
  .strict();

export const folderMoveRequest = z
  .object({ id: idSchema, parentId: idSchema.nullable() })
  .strict();

export const folderDeleteRequest = z.object({ id: idSchema }).strict();

// --------------------------------------------------------------- settings

export const themeSchema = z.enum(['light', 'dark', 'system']);
export const unitSystemSchema = z.enum(['metric', 'imperial']);

export const windowGeometrySchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().int().min(640).max(20_000),
    height: z.number().int().min(480).max(20_000),
  })
  .strict();

export const mapPositionSchema = z
  .object({
    lat: latSchema,
    lon: lonSchema,
    zoom: z.number().int().min(0).max(24),
  })
  .strict();

export const panelLayoutSchema = z
  .object({
    libraryWidth: z.number().int().min(0).max(2000),
    propertiesWidth: z.number().int().min(0).max(2000),
    libraryVisible: z.boolean(),
    propertiesVisible: z.boolean(),
  })
  .strict();

/**
 * Settings are written one key at a time through a discriminated union, so each
 * value is validated against its own schema rather than a loose `unknown`.
 */
export const settingsSetRequest = z.discriminatedUnion('key', [
  z.object({ key: z.literal('theme'), value: themeSchema }).strict(),
  z.object({ key: z.literal('units'), value: unitSystemSchema }).strict(),
  z
    .object({ key: z.literal('mapProviderId'), value: z.string().min(1).max(64) })
    .strict(),
  z
    .object({
      key: z.literal('backupIntervalHours'),
      value: z.number().int().min(1).max(720),
    })
    .strict(),
  z
    .object({
      key: z.literal('backupRetention'),
      value: z.number().int().min(1).max(100),
    })
    .strict(),
  z
    .object({
      key: z.literal('planningSpeedKmh'),
      value: z.number().finite().min(0.5).max(100),
    })
    .strict(),
  z.object({ key: z.literal('tripSortKey'), value: tripSortKeySchema }).strict(),
  z
    .object({ key: z.literal('tripSortDirection'), value: sortDirectionSchema })
    .strict(),
  z.object({ key: z.literal('panelLayout'), value: panelLayoutSchema }).strict(),
  z
    .object({
      key: z.literal('windowGeometry'),
      value: windowGeometrySchema.nullable(),
    })
    .strict(),
  z.object({ key: z.literal('mapPosition'), value: mapPositionSchema }).strict(),
  z
    .object({
      key: z.literal('expandedNodeIds'),
      value: z.array(z.string().max(128)).max(5000),
    })
    .strict(),
  z.object({ key: z.literal('showArchivedTrips'), value: z.boolean() }).strict(),
]);

// ----------------------------------------------------------------- backup

export const backupRestoreRequest = z
  .object({ fileName: z.string().min(1).max(256) })
  .strict();

// -------------------------------------------------------------------- app

/**
 * External links are restricted to https and an explicit host allowlist. The
 * host check lives in the main process (`security/navigation.ts`); this only
 * enforces the shape.
 */
export const openExternalRequest = z
  .object({ url: z.string().url().max(2048) })
  .strict();

export type LibraryTreeRequest = z.infer<typeof libraryTreeRequest>;
export type TripListRequest = z.infer<typeof tripListRequest>;
export type TripCreateRequest = z.infer<typeof tripCreateRequest>;
export type TripUpdateRequest = z.infer<typeof tripUpdateRequest>;
export type TripMoveRequest = z.infer<typeof tripMoveRequest>;
export type TripSetStatusRequest = z.infer<typeof tripSetStatusRequest>;
export type TripSearchRequest = z.infer<typeof tripSearchRequest>;
export type FolderCreateRequest = z.infer<typeof folderCreateRequest>;
export type FolderRenameRequest = z.infer<typeof folderRenameRequest>;
export type FolderMoveRequest = z.infer<typeof folderMoveRequest>;
export type SettingsSetRequest = z.infer<typeof settingsSetRequest>;
export type BackupRestoreRequest = z.infer<typeof backupRestoreRequest>;
export type OpenExternalRequest = z.infer<typeof openExternalRequest>;

// ------------------------------------------------- Phase 2: routes, waypoints

export const elevationSchema = z
  .number()
  .finite()
  // Dead Sea shore to above the troposphere: wide enough for any real datum,
  // narrow enough to catch a unit mix-up or a parsing error.
  .min(-500)
  .max(12_000)
  .nullable();

export const routePointSchema = z
  .object({
    lat: latSchema,
    lon: lonSchema,
    ele: elevationSchema.default(null),
    name: z.string().max(200).nullable().default(null),
    symbol: z.string().max(64).nullable().default(null),
    notes: z.string().max(10_000).nullable().default(null),
  })
  .strict();

/**
 * A route's complete geometry.
 *
 * Capped at 10,000 points: a human-placed route is tens to low hundreds, and
 * the cap keeps a single undo entry bounded. Recorded tracks, which are far
 * larger, use a different storage path entirely (ADR 0003).
 */
export const routePointsSchema = z.array(routePointSchema).max(10_000);

export const routeColourSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Expected a hex colour such as #2563eb')
  .nullable();

export const routeListForTripRequest = z.object({ tripId: idSchema }).strict();
export const routeGetRequest = z.object({ id: idSchema }).strict();

export const routeCreateRequest = z
  .object({
    tripId: idSchema,
    name: nameSchema,
    colour: routeColourSchema.default(null),
    points: routePointsSchema.default([]),
  })
  .strict();

export const routeUpdateRequest = z
  .object({
    id: idSchema,
    name: nameSchema.optional(),
    colour: routeColourSchema.optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.colour !== undefined, {
    message: 'At least one field must be provided',
  });

export const routeSetGeometryRequest = z
  .object({ id: idSchema, points: routePointsSchema })
  .strict();

export const routeReverseRequest = z.object({ id: idSchema }).strict();
export const routeDuplicateRequest = z.object({ id: idSchema }).strict();
export const routeDeleteRequest = z.object({ id: idSchema }).strict();

export const routeMoveRequest = z
  .object({ id: idSchema, tripId: idSchema })
  .strict();

// ------------------------------------------------------------- waypoints

export const waypointListForTripRequest = z
  .object({ tripId: idSchema })
  .strict();

export const waypointGetRequest = z.object({ id: idSchema }).strict();

export const waypointCreateRequest = z
  .object({
    tripId: idSchema,
    name: nameSchema,
    lat: latSchema,
    lon: lonSchema,
    eleM: elevationSchema.default(null),
    description: optionalTextSchema.default(null),
    symbol: z.string().max(64).default('pin'),
    notes: optionalTextSchema.default(null),
    groupId: idSchema.nullable().default(null),
  })
  .strict();

export const waypointUpdateRequest = z
  .object({
    id: idSchema,
    name: nameSchema.optional(),
    lat: latSchema.optional(),
    lon: lonSchema.optional(),
    eleM: elevationSchema.optional(),
    description: optionalTextSchema.optional(),
    symbol: z.string().max(64).optional(),
    notes: optionalTextSchema.optional(),
    groupId: idSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (v) => Object.keys(v).some((k) => k !== 'id'),
    { message: 'At least one field must be provided' },
  );

/** Dragging a marker: coordinates only, so the undo label can say "Move". */
export const waypointMoveRequest = z
  .object({ id: idSchema, lat: latSchema, lon: lonSchema })
  .strict();

export const waypointDeleteRequest = z.object({ id: idSchema }).strict();
export const waypointDuplicateRequest = z.object({ id: idSchema }).strict();

export const waypointMoveToTripRequest = z
  .object({ id: idSchema, tripId: idSchema })
  .strict();

export const waypointSearchRequest = z
  .object({ query: z.string().trim().max(200) })
  .strict();

export const waypointGroupsRequest = z.object({ tripId: idSchema }).strict();

export const waypointCreateGroupRequest = z
  .object({ tripId: idSchema, name: nameSchema })
  .strict();

// -------------------------------------------------------------- geometry

export const geometryForTripRequest = z.object({ tripId: idSchema }).strict();

export type RoutePointInput = z.input<typeof routePointSchema>;
export type RouteCreateRequest = z.infer<typeof routeCreateRequest>;
export type RouteSetGeometryRequest = z.infer<typeof routeSetGeometryRequest>;
export type WaypointCreateRequest = z.infer<typeof waypointCreateRequest>;
export type WaypointUpdateRequest = z.infer<typeof waypointUpdateRequest>;

// --------------------------------------------------------------- tracks

/** A colour is a 6-digit hex string, or null for the default. */
export const trackColourSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i)
  .nullable();

/** Line width in CSS pixels. Bounded so a stray value cannot blank the map. */
export const trackWidthSchema = z.number().int().min(1).max(12).nullable();

export const trackListForTripRequest = z.object({ tripId: idSchema }).strict();
export const trackGetRequest = z.object({ id: idSchema }).strict();

/**
 * Geometry for the map.
 *
 * The zoom decides whether the simplified render cache or the real points are
 * returned, so the renderer asks for what it is drawing rather than being told
 * which representation to use.
 */
export const trackGeometryRequest = z
  .object({ id: idSchema, zoom: z.number().int().min(0).max(24) })
  .strict();

export const trackUpdateRequest = z
  .object({
    id: idSchema,
    name: nameSchema.optional(),
    colour: trackColourSchema.optional(),
    width: trackWidthSchema.optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.name !== undefined || v.colour !== undefined || v.width !== undefined,
    { message: 'At least one field must be provided' },
  );

export const trackMoveRequest = z
  .object({ id: idSchema, tripId: idSchema })
  .strict();

export const trackReverseRequest = z.object({ id: idSchema }).strict();
export const trackDeleteRequest = z.object({ id: idSchema }).strict();
export const trackHasOriginalRequest = z.object({ id: idSchema }).strict();
export const trackRestoreOriginalRequest = z.object({ id: idSchema }).strict();

/**
 * Simplification tolerance in metres.
 *
 * Positive and bounded: zero would be a no-op dressed as an edit, and an
 * unbounded value would reduce a track to its endpoints without warning.
 */
export const trackSimplifyRequest = z
  .object({ id: idSchema, toleranceM: z.number().finite().min(0.1).max(10_000) })
  .strict();

export const trackPreviewSimplifyRequest = trackSimplifyRequest;

export const trackSplitRequest = z
  .object({ id: idSchema, pointIndex: z.number().int().min(0) })
  .strict();

export const trackJoinRequest = z
  .object({
    firstId: idSchema,
    secondId: idSchema,
    name: nameSchema.optional(),
  })
  .strict();

export const trackDeleteRangeRequest = z
  .object({
    id: idSchema,
    from: z.number().int().min(0),
    to: z.number().int().min(0),
  })
  .strict();

// -------------------------------------------------------- import / export

export const importFormatSchema = z.enum([
  'gpx',
  'kml',
  'kmz',
  'tcx',
  'fit',
  'csv',
  'json',
]);

export const exportFormatSchema = z.enum(['gpx', 'kml', 'kmz', 'csv', 'json']);

/**
 * A staged-file token.
 *
 * Opaque to the renderer by design: it identifies a parsed file held in the
 * main process, which is what lets the renderer confirm an import without ever
 * holding a path.
 */
export const importTokenSchema = z.string().min(1).max(200);

/** Selection within one staged file. Omitting an index list means "all". */
export const importFileSelectionSchema = z
  .object({
    token: importTokenSchema,
    destinationTripId: idSchema.nullable().default(null),
    routeIndices: z.array(z.number().int().min(0)).max(100_000).optional(),
    trackIndices: z.array(z.number().int().min(0)).max(100_000).optional(),
    waypointIndices: z.array(z.number().int().min(0)).max(1_000_000).optional(),
    retainOriginal: z.boolean().default(true),
  })
  .strict();

export const importCommitRequest = z
  .object({
    files: z.array(importFileSelectionSchema).min(1).max(200),
  })
  .strict();

export const importDiscardRequest = z
  .object({ tokens: z.array(importTokenSchema).max(200).default([]) })
  .strict();

export const importHistoryRequest = z
  .object({ limit: z.number().int().min(1).max(1000).default(100) })
  .strict();

/**
 * Paths from a drag-and-drop.
 *
 * The renderer cannot produce these itself: the preload bridge resolves them
 * from the dropped `File` objects with `webUtils.getPathForFile` and passes
 * them straight through, so a path originates from a real user gesture rather
 * than from renderer-side string construction.
 */
export const importAddPathsRequest = z
  .object({ paths: z.array(z.string().min(1).max(4096)).min(1).max(200) })
  .strict();

export const exportScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('route'), id: idSchema }).strict(),
  z.object({ kind: z.literal('track'), id: idSchema }).strict(),
  z.object({ kind: z.literal('waypoint'), id: idSchema }).strict(),
  z
    .object({
      kind: z.literal('trips'),
      tripIds: z.array(idSchema).min(1).max(10_000),
    })
    .strict(),
  z.object({ kind: z.literal('everything') }).strict(),
]);

export const exportOptionsRequest = z
  .object({ scope: exportScopeSchema })
  .strict();

export const exportRunRequest = z
  .object({ scope: exportScopeSchema, format: exportFormatSchema })
  .strict();

export type TrackUpdateRequest = z.infer<typeof trackUpdateRequest>;
export type ImportFileSelection = z.infer<typeof importFileSelectionSchema>;
export type ExportScopeRequest = z.infer<typeof exportScopeSchema>;
