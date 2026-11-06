import L from 'leaflet';
import { resolveSymbol } from '@shared/domain/symbols';

/**
 * Leaflet icon factories.
 *
 * DivIcons rather than image sprites: the symbol vocabulary is small, the
 * glyphs are text, and this keeps the markers themable by the same CSS
 * variables as the rest of the app with no asset pipeline.
 *
 * Imported text is never injected as markup. The glyph comes from our own
 * vocabulary, and `escapeHtml` guards the one place a value could originate
 * from a file — an unrecognised imported symbol id.
 */

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function waypointIcon(
  symbolId: string | null,
  selected: boolean,
): L.DivIcon {
  const symbol = resolveSymbol(symbolId);
  const size = selected ? 30 : 26;
  const ring = selected ? '#ffffff' : 'rgba(255,255,255,0.85)';

  return L.divIcon({
    className: 'trailrt-waypoint-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="
        width:${size}px;height:${size}px;
        display:flex;align-items:center;justify-content:center;
        border-radius:50%;
        background:${symbol.colour};
        border:2.5px solid ${ring};
        box-shadow:0 1px 4px rgba(0,0,0,0.4);
        color:#fff;font-size:${selected ? 15 : 13}px;line-height:1;
        font-weight:600;
      ">${escapeHtml(symbol.glyph)}</div>`,
  });
}

/** Draggable handle on a selected route's vertex. */
export function vertexIcon(isEndpoint: boolean): L.DivIcon {
  const size = isEndpoint ? 14 : 11;
  return L.divIcon({
    className: 'trailrt-vertex-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="
        width:${size}px;height:${size}px;
        border-radius:50%;
        background:${isEndpoint ? '#0f172a' : '#ffffff'};
        border:2px solid ${isEndpoint ? '#ffffff' : '#0f172a'};
        box-shadow:0 1px 3px rgba(0,0,0,0.35);
      "></div>`,
  });
}

/** Start and finish badges on a route. */
export function endpointIcon(kind: 'start' | 'end'): L.DivIcon {
  const colour = kind === 'start' ? '#16a34a' : '#dc2626';
  return L.divIcon({
    className: 'trailrt-endpoint-marker',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html: `<div style="
        width:18px;height:18px;
        display:flex;align-items:center;justify-content:center;
        border-radius:50%;
        background:${colour};
        border:2px solid #ffffff;
        box-shadow:0 1px 3px rgba(0,0,0,0.35);
        color:#fff;font-size:10px;font-weight:700;line-height:1;
      ">${kind === 'start' ? 'S' : 'F'}</div>`,
  });
}

/** Ghost marker for a point being placed but not yet committed. */
export function pendingPointIcon(): L.DivIcon {
  return L.divIcon({
    className: 'trailrt-pending-marker',
    iconSize: [10, 10],
    iconAnchor: [5, 5],
    html: `<div style="
        width:10px;height:10px;border-radius:50%;
        background:#f59e0b;border:2px solid #ffffff;
      "></div>`,
  });
}
