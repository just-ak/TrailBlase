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
  .object({ includeArchived: z.boolean().default(false) })
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
