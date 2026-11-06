import type { ReactNode } from "react";
import type { UnitSystem } from "@shared/domain/types";
import type { SpeedDistribution } from "@shared/geo/speedBands";
import { formatDistance } from "@shared/geo/units";

/**
 * Speed distribution as a stacked bar plus a table — Requirement 6.
 *
 * Three rules from ADR 0011 are visible in this component:
 *
 * 1. **Unknown is always shown.** It has a reserved slot and a reserved
 *    colour, and it is rendered even at 0%. Hiding it when it is large — which
 *    it often is, because OpenStreetMap `maxspeed` coverage is partial — would
 *    make an unmapped route look fully characterised.
 * 2. **Percentages are of distance.** The label says so, because a reader will
 *    otherwise assume point count and be wrong in the direction that flatters
 *    slow sections.
 * 3. **The source is labelled on the bar itself**, not in a tooltip. A posted
 *    limit from road data and a speed derived from the user's own GPS are
 *    different facts, and the one thing a user must never have to guess is
 *    which they are looking at.
 */

/**
 * Band colours, cool to warm by speed.
 *
 * Unknown is deliberately outside the ramp: a grey hatch, so it reads as "no
 * data" rather than as another speed. Giving it a colour from the scale would
 * place it somewhere on the fast–slow axis, which is exactly the inference the
 * ADR forbids.
 */
const BAND_COLOURS = [
  "#1d4ed8",
  "#0891b2",
  "#15803d",
  "#ca8a04",
  "#ea580c",
  "#b91c1c",
] as const;

const UNKNOWN_COLOUR = "#94a3b8";

export function SpeedDistributionBar({
  distribution,
  units,
  fetchedAt,
  provider,
  stale,
}: {
  distribution: SpeedDistribution;
  units: UnitSystem;
  /** Null for a recorded distribution: it comes from the track, not a provider. */
  fetchedAt: number | null;
  provider: string | null;
  stale: boolean;
}): ReactNode {
  const sourceLabel =
    distribution.source === "posted"
      ? "Posted speed limits from road data"
      : "Speed recorded by the device that made this track";

  const rows = [
    ...distribution.bands.map((band, index) => ({
      ...band,
      colour: BAND_COLOURS[index] ?? UNKNOWN_COLOUR,
      isUnknown: false,
    })),
    { ...distribution.unknown, colour: UNKNOWN_COLOUR, isUnknown: true },
  ];

  // Zero-width segments would still render a 1px sliver in some browsers, so
  // they are dropped from the bar. They stay in the table, where a 0% row is
  // information rather than noise.
  const segments = rows.filter((row) => row.percent > 0);

  if (distribution.totalDistanceM === 0) {
    return (
      <p className="text-[12px] text-[var(--color-text-secondary)]">
        There is no distance here to describe.
      </p>
    );
  }

  return (
    <div>
      <p className="mb-1 text-[11px] text-[var(--color-text-secondary)]">
        {sourceLabel}
      </p>

      <div
        className="flex h-4 w-full overflow-hidden rounded border border-[var(--color-border-subtle)]"
        role="img"
        aria-label={`Share of distance by speed band. ${segments
          .map((row) => `${row.label}: ${row.percent.toFixed(0)} per cent`)
          .join(". ")}`}
      >
        {segments.map((row) => (
          <div
            key={row.label}
            style={{
              width: `${row.percent}%`,
              background: row.colour,
              ...(row.isUnknown
                ? {
                    // A hatch, so Unknown is distinguishable from a speed band
                    // even in greyscale or to a colour-blind reader.
                    backgroundImage:
                      "repeating-linear-gradient(45deg, rgba(255,255,255,0.45) 0 3px, transparent 3px 6px)",
                  }
                : {}),
            }}
            title={`${row.label} — ${row.percent.toFixed(1)}% (${formatDistance(
              row.distanceM,
              units,
            )})`}
          />
        ))}
      </div>

      <table className="mt-2 w-full text-[12px]">
        <caption className="sr-only">
          Share of total distance in each speed band
        </caption>
        <thead>
          <tr className="text-[var(--color-text-muted)]">
            <th scope="col" className="text-left font-normal">
              Band
            </th>
            <th scope="col" className="text-right font-normal">
              % of distance
            </th>
            <th scope="col" className="text-right font-normal">
              Distance
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.label}
              className={
                row.isUnknown
                  ? "font-medium text-[var(--color-text-primary)]"
                  : "text-[var(--color-text-secondary)]"
              }
            >
              <td className="py-0.5">
                <span className="mr-1.5 inline-block h-2 w-2 rounded-sm align-middle"
                  style={{ background: row.colour }}
                />
                {row.label}
              </td>
              <td className="py-0.5 text-right tabular-nums">
                {row.percent.toFixed(1)}%
              </td>
              <td className="py-0.5 text-right tabular-nums">
                {formatDistance(row.distanceM, units)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {distribution.allUnknown && (
        <p className="mt-2 text-[11px] text-[var(--color-text-secondary)]">
          No speed could be determined for any part of this geometry. That is
          what the road data says, not a failure — speed limits are missing from
          large parts of OpenStreetMap, especially on minor roads.
        </p>
      )}

      {provider !== null && fetchedAt !== null && (
        <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
          {provider} ·{" "}
          {new Date(fetchedAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
          {stale && (
            <span className="ml-1 text-[var(--color-danger)]">
              · the geometry has changed since this was fetched
            </span>
          )}
        </p>
      )}
    </div>
  );
}
