import { useCallback, useMemo, type ReactNode } from "react";
import type { UnitSystem } from "@shared/domain/types";
import type { ProfileSpan } from "@shared/geo/profile";
import { indexAtDistance } from "@shared/geo/profile";
import {
  formatDistance,
  formatElevation,
  formatSpeed,
} from "@shared/geo/units";
import type { RoadClass } from "@shared/routing/RoutingProvider";
import type { Profile } from "@shared/routing/results";

/**
 * The profile chart — Requirement 5.
 *
 * Hand-written SVG rather than a charting library. This is one `<path>` for the
 * elevation line and a run of `<rect>`s for the bands; a library would be a new
 * dependency, a new licence to check, and a bundle cost for something that fits
 * on a page. All the arithmetic is in `main/services/profileService.ts` and
 * `shared/geo/profile.ts`, so there is none here beyond mapping values to
 * pixels.
 *
 * ## A band with no data is not drawn
 *
 * Every band is conditional on its data being present, and when it is absent
 * the reason the service supplied is shown in its place. An empty axis labelled
 * "Elevation" over a route with no elevation would be a lie told in a chart,
 * which is the hardest kind to notice.
 */

const WIDTH = 760;
const ELEVATION_HEIGHT = 120;
const BAND_HEIGHT = 14;
const BAND_GAP = 4;
const PAD_LEFT = 46;
const PAD_RIGHT = 12;
const PAD_TOP = 8;

const PLOT_WIDTH = WIDTH - PAD_LEFT - PAD_RIGHT;

/**
 * Road class colours, ordered from major to minor.
 *
 * A sequential ramp rather than categorical hues: road class *is* ordered, and
 * a reader should be able to see "this route is mostly minor roads" without
 * consulting the key.
 */
const ROAD_CLASS_COLOURS: Record<RoadClass, string> = {
  motorway: "#1e3a8a",
  trunk: "#1d4ed8",
  primary: "#2563eb",
  secondary: "#0891b2",
  tertiary: "#0d9488",
  unclassified: "#65a30d",
  residential: "#ca8a04",
  service_other: "#a16207",
};

/** Speed colours, matched to SpeedDistributionBar so the two agree. */
const SPEED_STOPS: readonly { maxMps: number; colour: string }[] = [
  { maxMps: 30 / 3.6, colour: "#1d4ed8" },
  { maxMps: 50 / 3.6, colour: "#0891b2" },
  { maxMps: 70 / 3.6, colour: "#15803d" },
  { maxMps: 90 / 3.6, colour: "#ca8a04" },
  { maxMps: 110 / 3.6, colour: "#ea580c" },
  { maxMps: Number.POSITIVE_INFINITY, colour: "#b91c1c" },
];

function speedColour(mps: number): string {
  return SPEED_STOPS.find((stop) => mps < stop.maxMps)?.colour ?? "#b91c1c";
}

function AbsentBand({
  label,
  reason,
}: {
  label: string;
  reason: string;
}): ReactNode {
  return (
    <div className="mt-2">
      <p className="text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
        {label}
      </p>
      {/* The reason, not an empty axis. Requirement 5.6. */}
      <p className="text-[11px] text-[var(--color-text-secondary)]">{reason}</p>
    </div>
  );
}

export function ProfileChart({
  profile,
  units,
  hoverDistanceM,
  onHover,
}: {
  profile: Profile;
  units: UnitSystem;
  /** Distance currently hovered, from this chart or from the map. */
  hoverDistanceM: number | null;
  /** Null when the pointer leaves. Drives the map's cursor marker. */
  onHover: (distanceM: number | null) => void;
}): ReactNode {
  const total = profile.totalDistanceM;

  const x = useCallback(
    (distanceM: number): number =>
      total <= 0 ? PAD_LEFT : PAD_LEFT + (distanceM / total) * PLOT_WIDTH,
    [total],
  );

  const distances = useMemo(
    () => profile.samples.map((s) => s.distanceM),
    [profile.samples],
  );

  const elevation = profile.elevation;

  /*
   * The elevation path.
   *
   * Gaps matter: a sample with no elevation breaks the line rather than being
   * interpolated across. A straight segment drawn through missing data would
   * invent a gradient, and the architecture rules are explicit that absent data
   * stays absent.
   */
  const elevationPath = useMemo(() => {
    if (elevation === null) return null;
    const min = elevation.minM ?? 0;
    const max = elevation.maxM ?? min + 1;
    const range = max - min === 0 ? 1 : max - min;

    let path = "";
    let open = false;
    for (const sample of profile.samples) {
      if (sample.eleM === null) {
        open = false;
        continue;
      }
      const px = x(sample.distanceM);
      const py =
        PAD_TOP +
        ELEVATION_HEIGHT -
        ((sample.eleM - min) / range) * ELEVATION_HEIGHT;
      path += `${open ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`;
      open = true;
    }
    return path.length === 0 ? null : path;
  }, [elevation, profile.samples, x]);

  const hoverIndex =
    hoverDistanceM === null ? null : indexAtDistance(distances, hoverDistanceM);
  const hovered = hoverIndex === null ? null : profile.samples[hoverIndex];

  const bands: {
    label: string;
    spans: ProfileSpan<unknown>[];
    colour: (value: unknown) => string;
  }[] = [];
  if (profile.postedSpeedSpans !== null) {
    bands.push({
      label: "Posted speed limit",
      spans: profile.postedSpeedSpans,
      colour: (value) =>
        typeof value === "number" ? speedColour(value) : "#94a3b8",
    });
  }
  if (profile.roadClassSpans !== null) {
    bands.push({
      label: "Road class",
      spans: profile.roadClassSpans,
      colour: (value) =>
        typeof value === "string"
          ? (ROAD_CLASS_COLOURS[value as RoadClass] ?? "#94a3b8")
          : "#94a3b8",
    });
  }

  const svgHeight =
    PAD_TOP +
    (elevationPath === null ? 0 : ELEVATION_HEIGHT + 18) +
    bands.length * (BAND_HEIGHT + BAND_GAP + 12) +
    8;

  const handlePointer = (
    event: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>,
  ): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    // The SVG scales to its container, so the client x has to be mapped back
    // through the viewBox rather than used directly.
    const ratio = (event.clientX - rect.left) / rect.width;
    const svgX = ratio * WIDTH;
    if (svgX < PAD_LEFT || svgX > WIDTH - PAD_RIGHT) {
      onHover(null);
      return;
    }
    onHover(((svgX - PAD_LEFT) / PLOT_WIDTH) * total);
  };

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${svgHeight}`}
        width="100%"
        height={svgHeight}
        role="img"
        aria-label={
          elevation === null
            ? "Route profile. No elevation data."
            : `Route profile over ${formatDistance(total, units)}. Elevation from ${formatElevation(elevation.minM, units)} to ${formatElevation(elevation.maxM, units)}.`
        }
        onPointerMove={handlePointer}
        onPointerLeave={() => onHover(null)}
        className="touch-none select-none"
      >
        {elevationPath !== null && elevation !== null && (
          <g>
            {/* Two gridlines and their labels: the extremes are the two numbers
                a reader actually uses. More would clutter a 120px band. */}
            {[elevation.maxM, elevation.minM].map((value, index) => {
              if (value === null) return null;
              const py = PAD_TOP + (index === 0 ? 0 : ELEVATION_HEIGHT);
              return (
                <g key={index === 0 ? "grid-max" : "grid-min"}>
                  <line
                    x1={PAD_LEFT}
                    y1={py}
                    x2={WIDTH - PAD_RIGHT}
                    y2={py}
                    stroke="var(--color-border-subtle)"
                    strokeWidth="1"
                  />
                  <text
                    x={PAD_LEFT - 6}
                    y={py + 3}
                    textAnchor="end"
                    fontSize="9"
                    fill="var(--color-text-muted)"
                  >
                    {formatElevation(value, units)}
                  </text>
                </g>
              );
            })}

            <path
              d={elevationPath}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </g>
        )}

        {bands.map((band, bandIndex) => {
          const y =
            PAD_TOP +
            (elevationPath === null ? 0 : ELEVATION_HEIGHT + 18) +
            bandIndex * (BAND_HEIGHT + BAND_GAP + 12);
          return (
            <g key={band.label}>
              <text
                x={PAD_LEFT}
                y={y - 3}
                fontSize="9"
                fill="var(--color-text-muted)"
              >
                {band.label}
              </text>
              {band.spans.map((span) => {
                const left = x(span.startM);
                const width = Math.max(1, x(span.endM) - left);
                return (
                  <rect
                    key={`${span.startM}-${span.endM}`}
                    x={left}
                    y={y}
                    width={width}
                    height={BAND_HEIGHT}
                    fill={band.colour(span.value)}
                  />
                );
              })}
            </g>
          );
        })}

        {hovered !== undefined && hovered !== null && (
          <line
            x1={x(hovered.distanceM)}
            y1={PAD_TOP}
            x2={x(hovered.distanceM)}
            y2={svgHeight - 8}
            stroke="var(--color-text-primary)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}
      </svg>

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] text-[var(--color-text-secondary)]">
        <span>{formatDistance(total, units)} total</span>
        {elevation !== null && (
          <>
            <span>Gain {formatElevation(elevation.gainM, units)}</span>
            <span>Loss {formatElevation(elevation.lossM, units)}</span>
          </>
        )}
        {hovered !== undefined && hovered !== null && (
          <span className="font-medium text-[var(--color-text-primary)]">
            At {formatDistance(hovered.distanceM, units)}:{" "}
            {formatElevation(hovered.eleM, units)}
            {hovered.recordedSpeedMps !== null && (
              <> · {formatSpeed(hovered.recordedSpeedMps * 3.6, units)}</>
            )}
          </span>
        )}
        {profile.simplified && (
          /* Requirement 5.7. The chart is a sampled view of the recording, and
             saying so costs one line. */
          <span className="text-[var(--color-text-muted)]">
            Simplified for display — {profile.samples.length.toLocaleString()}{" "}
            of {profile.sourcePointCount.toLocaleString()} points
          </span>
        )}
      </div>

      {profile.elevationAbsentBecause !== null && (
        <AbsentBand label="Elevation" reason={profile.elevationAbsentBecause} />
      )}
      {profile.postedSpeedAbsentBecause !== null && (
        <AbsentBand
          label="Posted speed limit"
          reason={profile.postedSpeedAbsentBecause}
        />
      )}
      {profile.roadClassAbsentBecause !== null && (
        <AbsentBand
          label="Road class"
          reason={profile.roadClassAbsentBecause}
        />
      )}
      {profile.recordedSpeedAbsentBecause !== null && (
        <AbsentBand
          label="Recorded speed"
          reason={profile.recordedSpeedAbsentBecause}
        />
      )}
    </div>
  );
}
