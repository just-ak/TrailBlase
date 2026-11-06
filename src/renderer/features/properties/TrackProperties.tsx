import { useEffect, useState, type ReactNode } from "react";
import type { TrackWithPoints, UnitSystem } from "@shared/domain/types";
import { ROUTE_COLOURS } from "@shared/domain/symbols";
import {
  formatCoordinates,
  formatDistance,
  formatDuration,
  formatElevation,
  formatTimestamp,
} from "@shared/geo/units";
import * as actions from "../../lib/actions";
import { api, callOr } from "../../lib/client";
import { Button } from "../../components/Button";
import { Field, INPUT_CLASS, ReadOnly } from "./fields";
import { RoadDataSection } from "./RoadDataSection";
import { WazeButton } from "./WazeButton";

/**
 * Track inspector.
 *
 * Two things this panel is careful about:
 *
 * - **It says when data is absent rather than showing a zero.** A recording
 *   with no barometer has no elevation gain; a recording with no timestamps has
 *   no duration. Both say so in words instead of displaying "0 m" and "0:00",
 *   which would be a different and false claim.
 * - **Simplify is previewed, not just applied.** The user sees the resulting
 *   point count before agreeing, because the operation is not reversible from
 *   the undo stack on a track this size. The retained original file is the way
 *   back, and the panel says so and offers it.
 */

const DEFAULT_TRACK_COLOUR = "#b45309";
const WIDTHS = [1, 2, 3, 4, 6, 8] as const;

/** Preset tolerances, labelled by what they are for rather than by number. */
const TOLERANCES = [
  { metres: 1, label: "1 m — remove GPS jitter" },
  { metres: 5, label: "5 m — light" },
  { metres: 20, label: "20 m — moderate" },
  { metres: 100, label: "100 m — aggressive" },
] as const;

function SimplifySection({ track }: { track: TrackWithPoints }): ReactNode {
  const [toleranceM, setToleranceM] = useState<number>(5);
  const [preview, setPreview] = useState<{
    before: number;
    after: number;
  } | null>(null);

  // Previewing is a read-only call, so it can run on every change of the
  // tolerance without the user committing to anything.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Cleared after yielding rather than in the effect body, so the "stale
      // preview for a new tolerance" window closes without a synchronous
      // setState starting a second render.
      await Promise.resolve();
      if (cancelled) return;
      setPreview(null);
      const result = await actions.previewTrackSimplify(track.id, toleranceM);
      if (!cancelled) setPreview(result);
    })();
    return () => {
      cancelled = true;
    };
    // `track.pointCount` is not read here: it is a dependency so the preview
    // is recalculated after an edit changes the geometry, which the tolerance
    // and id alone would not catch.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [track.id, toleranceM, track.pointCount]);

  const removed = preview === null ? null : preview.before - preview.after;

  return (
    <Field label="Simplify">
      <select
        aria-label="Simplification tolerance"
        value={toleranceM}
        onChange={(event) => setToleranceM(Number(event.target.value))}
        className={INPUT_CLASS}
      >
        {TOLERANCES.map((option) => (
          <option key={option.metres} value={option.metres}>
            {option.label}
          </option>
        ))}
      </select>

      <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
        {preview === null
          ? "Calculating…"
          : removed === 0
            ? `No points would be removed at ${toleranceM} m.`
            : `${preview.before.toLocaleString()} points → ${preview.after.toLocaleString()} (${removed?.toLocaleString()} removed).`}
      </p>

      <div className="mt-2">
        <Button
          disabled={preview === null || removed === 0}
          onClick={() => void actions.simplifyTrack(track.id, toleranceM)}
        >
          Simplify
        </Button>
      </div>
    </Field>
  );
}

function TrimSection({ track }: { track: TrackWithPoints }): ReactNode {
  const total = track.pointCount;
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(0);

  const valid =
    total > 1 &&
    from >= 0 &&
    to >= from &&
    to < total &&
    total - (to - from + 1) >= 1;

  return (
    <Field label="Remove points">
      <div className="flex items-center gap-2">
        <input
          type="number"
          aria-label="First point to remove"
          min={0}
          max={Math.max(0, total - 1)}
          value={from}
          onChange={(event) => setFrom(Number(event.target.value))}
          className={`${INPUT_CLASS} w-24`}
        />
        <span className="text-[12px] text-[var(--color-text-muted)]">to</span>
        <input
          type="number"
          aria-label="Last point to remove"
          min={0}
          max={Math.max(0, total - 1)}
          value={to}
          onChange={(event) => setTo(Number(event.target.value))}
          className={`${INPUT_CLASS} w-24`}
        />
      </div>
      <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
        Zero-based, inclusive. Points are numbered across all segments.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          disabled={!valid}
          onClick={() => void actions.deleteTrackPointRange(track.id, from, to)}
        >
          Remove range
        </Button>
        <Button
          disabled={from <= 0 || from >= total - 1}
          onClick={() => void actions.splitTrack(track.id, from)}
        >
          Split at {from}
        </Button>
      </div>
    </Field>
  );
}

function OriginalSection({ track }: { track: TrackWithPoints }): ReactNode {
  const [original, setOriginal] = useState<{
    hasOriginal: boolean;
    format: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await callOr(
        api().tracks.hasOriginal({ id: track.id }),
        null,
      );
      if (!cancelled) setOriginal(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [track.id]);

  if (original === null) return null;

  if (!original.hasOriginal) {
    return (
      <Field label="Original file">
        {/* Stated rather than hidden: the user needs to know that an edit here
            has no file to fall back on. */}
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          No original file is retained for this track, so edits cannot be
          reverted from one.
        </p>
      </Field>
    );
  }

  return (
    <Field label="Original file">
      <p className="text-[13px] text-[var(--color-text-primary)]">
        The imported {original.format?.toUpperCase() ?? "source"} file is kept,
        so the recorded geometry can be restored.
      </p>
      <div className="mt-2">
        <Button onClick={() => void actions.restoreTrackOriginal(track.id)}>
          Restore original geometry
        </Button>
      </div>
    </Field>
  );
}

export function TrackProperties({
  track,
  units,
}: {
  track: TrackWithPoints;
  units: UnitSystem;
}): ReactNode {
  const [name, setName] = useState(track.name);

  const all = track.segments.flatMap((segment) => segment.points);
  const first = all.at(0) ?? null;
  const last = all.at(-1) ?? null;

  const hasElevation = track.elevGainM !== null;
  const hasTimes = track.startedAt !== null;
  const currentColour = track.colour ?? DEFAULT_TRACK_COLOUR;

  return (
    <div className="h-full overflow-y-auto p-3">
      <h2 className="mb-3 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
        Track
      </h2>

      <Field label="Name">
        <input
          value={name}
          aria-label="Track name"
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            const trimmed = name.trim();
            if (trimmed.length === 0) {
              setName(track.name);
              return;
            }
            if (trimmed !== track.name) {
              void actions.renameTrack(track.id, trimmed);
            }
          }}
          className={INPUT_CLASS}
        />
      </Field>

      <Field label="Colour">
        <div className="flex flex-wrap gap-1.5">
          {ROUTE_COLOURS.map((option) => (
            <button
              key={option.id}
              type="button"
              title={option.label}
              aria-label={option.label}
              aria-pressed={currentColour === option.hex}
              onClick={() => void actions.setTrackColour(track.id, option.hex)}
              style={{ background: option.hex }}
              className={`h-6 w-6 rounded-full border-2 ${
                currentColour === option.hex
                  ? "border-[var(--color-text-primary)]"
                  : "border-transparent"
              }`}
            />
          ))}
        </div>
      </Field>

      <Field label="Line width">
        <div className="flex flex-wrap gap-1.5">
          {WIDTHS.map((width) => (
            <button
              key={width}
              type="button"
              aria-label={`${width} pixels`}
              aria-pressed={(track.width ?? 3) === width}
              onClick={() => void actions.setTrackWidth(track.id, width)}
              className={`rounded-md border px-2 py-1 text-[12px] ${
                (track.width ?? 3) === width
                  ? "border-[var(--color-accent)] text-[var(--color-text-primary)]"
                  : "border-[var(--color-border-subtle)] text-[var(--color-text-secondary)]"
              }`}
            >
              {width}
            </button>
          ))}
        </div>
      </Field>

      <div className="my-4 h-px bg-[var(--color-border-subtle)]" />

      <Field label="Distance">
        <ReadOnly value={formatDistance(track.distanceM, units)} />
      </Field>

      <Field label="Points">
        <ReadOnly
          value={`${track.pointCount.toLocaleString()} in ${track.segmentCount} segment${
            track.segmentCount === 1 ? "" : "s"
          }`}
        />
      </Field>

      <Field label="Duration">
        {hasTimes ? (
          <>
            <ReadOnly value={formatDuration(track.durationS)} />
            <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
              {formatTimestamp(track.startedAt)} →{" "}
              {formatTimestamp(track.endedAt)}
            </p>
          </>
        ) : (
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            This recording has no timestamps, so it has no duration.
          </p>
        )}
      </Field>

      <Field label="Elevation">
        {hasElevation ? (
          <ul className="text-[13px] text-[var(--color-text-primary)]">
            <li>Gain {formatElevation(track.elevGainM, units)}</li>
            <li>Loss {formatElevation(track.elevLossM, units)}</li>
            <li>
              Range {formatElevation(track.elevMinM, units)} –{" "}
              {formatElevation(track.elevMaxM, units)}
            </li>
          </ul>
        ) : (
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            No elevation data in this recording.
          </p>
        )}
      </Field>

      <Field label="Start">
        <ReadOnly
          value={first === null ? "—" : formatCoordinates(first.lat, first.lon)}
        />
      </Field>

      <Field label="Finish">
        <ReadOnly
          value={last === null ? "—" : formatCoordinates(last.lat, last.lon)}
        />
      </Field>

      <div className="my-4 h-px bg-[var(--color-border-subtle)]" />

      <SimplifySection track={track} />
      <TrimSection track={track} />
      <OriginalSection track={track} />

      <div className="my-4 h-px bg-[var(--color-border-subtle)]" />

      <Field label="Source">
        <ReadOnly
          value={
            track.source === "import" ? "Imported recording" : "Created here"
          }
        />
      </Field>

      <Field label="Last modified">
        <ReadOnly value={formatTimestamp(track.updatedAt)} />
      </Field>

      <RoadDataSection
        ownerType="track"
        ownerId={track.id}
        units={units}
        pointCount={track.pointCount}
      />

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => void actions.reverseTrack(track.id)}>
          Reverse
        </Button>
        <Button onClick={() => actions.openProfile("track", track.id)}>
          Profile
        </Button>
        <WazeButton
          selection={{
            kind: "track",
            name: track.name,
            points: track.segments.flatMap((segment) =>
              segment.points.map((p) => ({ lat: p.lat, lon: p.lon })),
            ),
          }}
        />
        <Button
          onClick={() =>
            actions.openExportDialog({ kind: "track", id: track.id })
          }
        >
          Export…
        </Button>
        <Button
          variant="danger"
          onClick={() => void actions.deleteTrack(track.id)}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}
