/**
 * Encoding for the `metadata` columns on trips, routes, tracks and waypoints.
 *
 * These columns hold fields an imported format carried that have no column of
 * their own — GPX `<extensions>` and `<url>`, KML `ExtendedData`, TCX heart
 * rate, FIT lap summaries. The import-fidelity rule in
 * `.kiro/steering/architecture.md` means they are preserved rather than
 * dropped, and Phase 5 writes them back out.
 *
 * Two conventions, both to keep "no metadata" unambiguous:
 *
 * - An empty object is stored as `NULL`, never `"{}"`. One representation.
 * - A column that fails to parse decodes to `{}` rather than throwing. The
 *   metadata is opaque passenger data; a corrupt value should not make the
 *   object it belongs to unreadable.
 */

export function encodeMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  if (metadata === null || metadata === undefined) return null;
  if (Object.keys(metadata).length === 0) return null;
  return JSON.stringify(metadata);
}

export function decodeMetadata(
  value: string | null | undefined,
): Record<string, unknown> {
  if (value === null || value === undefined || value.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
