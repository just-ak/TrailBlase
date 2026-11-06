import type { UnitSystem } from '../domain/types';

/**
 * Display formatting. Storage is always SI; conversion happens here and nowhere
 * else, so there is exactly one place that can get it wrong.
 *
 * Every formatter takes `number | null` and renders absent data as an em dash.
 * That is deliberate: a null elevation must never surface as "0 m".
 */

const M_PER_KM = 1000;
const M_PER_MILE = 1609.344;
const M_PER_FOOT = 0.3048;

export const ABSENT = '—';

export function formatDistance(
  metres: number | null,
  units: UnitSystem,
): string {
  if (metres === null || !Number.isFinite(metres)) return ABSENT;

  if (units === 'imperial') {
    const miles = metres / M_PER_MILE;
    if (miles < 0.1) return `${Math.round(metres / M_PER_FOOT)} ft`;
    return `${miles.toFixed(miles < 10 ? 2 : 1)} mi`;
  }

  if (metres < 1000) return `${Math.round(metres)} m`;
  const km = metres / M_PER_KM;
  return `${km.toFixed(km < 10 ? 2 : 1)} km`;
}

export function formatElevation(
  metres: number | null,
  units: UnitSystem,
): string {
  if (metres === null || !Number.isFinite(metres)) return ABSENT;
  return units === 'imperial'
    ? `${Math.round(metres / M_PER_FOOT)} ft`
    : `${Math.round(metres)} m`;
}

export function formatSpeed(kmh: number | null, units: UnitSystem): string {
  if (kmh === null || !Number.isFinite(kmh)) return ABSENT;
  return units === 'imperial'
    ? `${(kmh / 1.609344).toFixed(1)} mph`
    : `${kmh.toFixed(1)} km/h`;
}

/** Durations are rendered as h/min; seconds are noise at trip scale. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return ABSENT;
  }
  const total = Math.round(seconds / 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} min`;
  return `${hours} h ${String(minutes).padStart(2, '0')} min`;
}

/**
 * Decimal degrees with a hemisphere suffix. Five decimal places is a bit over a
 * metre, which is finer than consumer GPS and enough for display.
 */
export function formatLatitude(lat: number): string {
  return `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}`;
}

export function formatLongitude(lon: number): string {
  return `${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? 'E' : 'W'}`;
}

export function formatCoordinates(lat: number, lon: number): string {
  return `${formatLatitude(lat)}, ${formatLongitude(lon)}`;
}

export function formatTimestamp(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return ABSENT;
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * An estimate, explicitly labelled as such by the caller. Returns null when a
 * distance is unknown rather than inventing a duration.
 */
export function estimateDurationSeconds(
  metres: number | null,
  planningSpeedKmh: number,
): number | null {
  if (metres === null || !Number.isFinite(metres)) return null;
  if (!Number.isFinite(planningSpeedKmh) || planningSpeedKmh <= 0) return null;
  return (metres / M_PER_KM / planningSpeedKmh) * 3600;
}
