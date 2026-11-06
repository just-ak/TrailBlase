import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SYMBOL_ID,
  isKnownSymbol,
  resolveSymbol,
  ROUTE_COLOURS,
  routeColour,
  WAYPOINT_SYMBOLS,
} from './symbols';

describe('waypoint symbols', () => {
  it('has unique ids', () => {
    const ids = WAYPOINT_SYMBOLS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every symbol a Garmin name, so export can keep fidelity', () => {
    for (const symbol of WAYPOINT_SYMBOLS) {
      expect(symbol.garminName.length).toBeGreaterThan(0);
      expect(symbol.glyph.length).toBeGreaterThan(0);
      expect(symbol.colour).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('includes the default symbol', () => {
    expect(isKnownSymbol(DEFAULT_SYMBOL_ID)).toBe(true);
  });

  it('resolves a known symbol', () => {
    const summit = resolveSymbol('summit');
    expect(summit.label).toBe('Summit');
    expect(summit.garminName).toBe('Summit');
  });

  it('preserves an unknown imported id rather than discarding it', () => {
    // An imported file may carry a symbol this build has no icon for. Losing
    // the value would break round-tripping in Phase 3.
    const imported = resolveSymbol('Geocache Found');
    expect(imported.id).toBe('Geocache Found');
    expect(imported.label).toContain('imported');
    expect(imported.glyph.length).toBeGreaterThan(0);
  });

  it('falls back for a null symbol without throwing', () => {
    expect(() => resolveSymbol(null)).not.toThrow();
    expect(resolveSymbol(null).glyph.length).toBeGreaterThan(0);
  });
});

describe('route colours', () => {
  it('offers valid hex colours', () => {
    for (const colour of ROUTE_COLOURS) {
      expect(colour.hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('falls back to the default when a route has no colour', () => {
    expect(routeColour(null)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(routeColour('#abcdef')).toBe('#abcdef');
  });
});
