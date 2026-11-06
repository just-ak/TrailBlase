/**
 * Waypoint symbol vocabulary.
 *
 * Each entry pairs a stable internal id with a Garmin `<sym>` name, so Phase 3
 * GPX export keeps fidelity with devices and BaseCamp rather than inventing
 * names at export time.
 *
 * The set is deliberately small — the common outdoor cases — rather than an
 * exhaustive clone of Garmin's catalogue. An imported symbol that is not listed
 * here is preserved verbatim in the database and rendered with the default
 * glyph, so it can still round-trip. Discarding it would breach the
 * import-fidelity rule in `.kiro/steering/architecture.md`.
 */

export interface WaypointSymbol {
  id: string;
  label: string;
  /** Rendered inside the map marker. */
  glyph: string;
  /** Garmin `<sym>` value used on export. */
  garminName: string;
  colour: string;
}

export const WAYPOINT_SYMBOLS: readonly WaypointSymbol[] = [
  { id: 'flag', label: 'Flag', glyph: '⚑', garminName: 'Flag, Blue', colour: '#2563eb' },
  { id: 'pin', label: 'Pin', glyph: '●', garminName: 'Waypoint', colour: '#2563eb' },
  { id: 'summit', label: 'Summit', glyph: '▲', garminName: 'Summit', colour: '#78716c' },
  { id: 'trailhead', label: 'Trailhead', glyph: '⇥', garminName: 'Trail Head', colour: '#059669' },
  { id: 'campground', label: 'Campsite', glyph: '⛺', garminName: 'Campground', colour: '#059669' },
  { id: 'lodging', label: 'Lodging', glyph: '⌂', garminName: 'Lodging', colour: '#7c3aed' },
  { id: 'water', label: 'Drinking water', glyph: '💧', garminName: 'Drinking Water', colour: '#0891b2' },
  { id: 'food', label: 'Food', glyph: '🍴', garminName: 'Restaurant', colour: '#d97706' },
  { id: 'parking', label: 'Parking', glyph: 'P', garminName: 'Parking Area', colour: '#475569' },
  { id: 'viewpoint', label: 'Viewpoint', glyph: '◎', garminName: 'Scenic Area', colour: '#0891b2' },
  { id: 'danger', label: 'Danger', glyph: '!', garminName: 'Skull and Crossbones', colour: '#dc2626' },
  { id: 'medical', label: 'Medical', glyph: '✚', garminName: 'Medical Facility', colour: '#dc2626' },
  { id: 'shelter', label: 'Shelter', glyph: '⌂', garminName: 'Building', colour: '#78716c' },
  { id: 'bridge', label: 'Bridge', glyph: '≡', garminName: 'Bridge', colour: '#78716c' },
  { id: 'ford', label: 'River crossing', glyph: '≈', garminName: 'Ford', colour: '#0891b2' },
  { id: 'gate', label: 'Gate', glyph: '⊣', garminName: 'Gate', colour: '#475569' },
  { id: 'cave', label: 'Cave', glyph: '◗', garminName: 'Cave', colour: '#78716c' },
  { id: 'photo', label: 'Photo', glyph: '◳', garminName: 'Scenic Area', colour: '#7c3aed' },
  { id: 'transport', label: 'Transport', glyph: '🚏', garminName: 'Bus Station', colour: '#475569' },
  { id: 'fuel', label: 'Fuel', glyph: '⛽', garminName: 'Gas Station', colour: '#d97706' },
] as const;

export const DEFAULT_SYMBOL_ID = 'pin';

export const SYMBOL_IDS: readonly string[] = WAYPOINT_SYMBOLS.map((s) => s.id);

const UNKNOWN_SYMBOL: WaypointSymbol = {
  id: 'unknown',
  label: 'Imported symbol',
  glyph: '◆',
  garminName: 'Waypoint',
  colour: '#94a3b8',
};

/**
 * Resolves a symbol for display.
 *
 * An unrecognised id yields the neutral fallback rather than throwing: the id
 * may have come from an imported file and must survive, even though this build
 * has no icon for it.
 */
export function resolveSymbol(id: string | null): WaypointSymbol {
  if (id === null) return UNKNOWN_SYMBOL;
  return (
    WAYPOINT_SYMBOLS.find((s) => s.id === id) ??
    // Preserve the original id so export can write it back unchanged.
    { ...UNKNOWN_SYMBOL, id, label: `${id} (imported)` }
  );
}

export function isKnownSymbol(id: string): boolean {
  return WAYPOINT_SYMBOLS.some((s) => s.id === id);
}

/** Default colours offered for route polylines. */
export const ROUTE_COLOURS: readonly { id: string; label: string; hex: string }[] =
  [
    { id: 'blue', label: 'Blue', hex: '#2563eb' },
    { id: 'red', label: 'Red', hex: '#dc2626' },
    { id: 'green', label: 'Green', hex: '#059669' },
    { id: 'orange', label: 'Orange', hex: '#d97706' },
    { id: 'purple', label: 'Purple', hex: '#7c3aed' },
    { id: 'cyan', label: 'Cyan', hex: '#0891b2' },
    { id: 'slate', label: 'Slate', hex: '#475569' },
  ];

export const DEFAULT_ROUTE_COLOUR = '#2563eb';

export function routeColour(colour: string | null): string {
  return colour ?? DEFAULT_ROUTE_COLOUR;
}
