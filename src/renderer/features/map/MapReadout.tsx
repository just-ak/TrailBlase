import type { ReactNode } from 'react';
import type { UnitSystem } from '@shared/domain/types';
import { formatCoordinates, formatDistance } from '@shared/geo/units';
import type { MapReadout as Readout } from './useLeafletMap';

/**
 * Scale bar and cursor coordinates — Requirements 4.1 and 4.2.
 *
 * Leaflet ships `L.control.scale`, which is not used: it injects its own DOM
 * outside React and cannot be themed from the project's CSS variables without
 * overriding Leaflet's stylesheet. The arithmetic it would do lives in
 * `computeScale`, so this component is presentation only.
 *
 * The bar's label is a round number and its width is whatever represents that
 * number, rather than a fixed width with whatever distance happens to fall at
 * its end. A bar you can hold a finger against and read "500 m" is a
 * measurement; "487 m" is just furniture.
 */
export function MapReadout({
  readout,
  units,
  showScaleBar,
}: {
  readout: Readout;
  units: UnitSystem;
  showScaleBar: boolean;
}): ReactNode {
  const { cursor, scale } = readout;

  if (!showScaleBar && cursor === null) return null;

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-[500] flex flex-col items-start gap-1.5">
      {showScaleBar && scale !== null && (
        <div
          className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/90 px-2 py-1 shadow-md"
          /*
           * `role="img"` with a label rather than leaving the bar as decorative
           * divs. The length of the line is the information, and that is not
           * available to a screen reader any other way.
           */
          role="img"
          aria-label={`Map scale: the bar represents ${formatDistance(
            scale.metres,
            units,
          )}`}
        >
          <div className="flex items-end gap-1.5">
            <div
              className="h-2 border-x-2 border-b-2 border-[var(--color-text-secondary)]"
              style={{ width: `${Math.round(scale.pixels)}px` }}
            />
            <span className="text-[11px] leading-none text-[var(--color-text-secondary)]">
              {formatDistance(scale.metres, units)}
            </span>
          </div>
        </div>
      )}

      {cursor !== null && (
        <div
          role="status"
          aria-live="off"
          className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/90 px-2 py-1 font-mono text-[11px] text-[var(--color-text-secondary)] shadow-md"
        >
          {/*
            `aria-live="off"`: the value changes on every pointer move, and
            announcing each one would make the map unusable with a screen
            reader. The properties panel is where a coordinate is read out.
          */}
          {formatCoordinates(cursor.lat, cursor.lon)}
        </div>
      )}
    </div>
  );
}
