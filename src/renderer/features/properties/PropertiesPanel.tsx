import { useState, type ReactNode } from "react";
import { formatTimestamp } from "@shared/geo/units";
import type { Folder, TripWithCounts } from "@shared/domain/types";
import { Button } from "../../components/Button";
import { api, call, describeError } from "../../lib/client";
import * as actions from "../../lib/actions";
import { useLibraryStore } from "../../stores/libraryStore";
import { useSelectionStore } from "../../stores/selectionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";
import { RouteProperties } from "./RouteProperties";
import { TrackProperties } from "./TrackProperties";
import { WaypointProperties } from "./WaypointProperties";

/**
 * The right panel.
 *
 * Phase 1 inspects trips and folders. The route, track and waypoint views in
 * section 3 of the specification need objects that arrive in Phases 2 and 3;
 * rather than render empty fields, the panel says what is coming.
 *
 * Edits commit on blur through the service layer. There is no save button
 * because there is no unsaved state. ADR 0001.
 */

const INPUT_CLASS =
  "w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]";

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="mb-3">
      <p className="mb-1 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
        {label}
      </p>
      {children}
    </div>
  );
}

function ReadOnly({ value }: { value: string }): ReactNode {
  return (
    <p className="text-[13px] text-[var(--color-text-primary)]">{value}</p>
  );
}

interface EditorProps {
  initialName: string;
  initialDescription?: string;
  initialNotes?: string;
  showText: boolean;
  onCommitName: (name: string) => void;
  onCommitDescription?: (value: string | null) => void;
  onCommitNotes?: (value: string | null) => void;
  onInvalidName: () => void;
}

/**
 * The editable fields.
 *
 * Mounted with a `key` of the object's id by the parent, so selecting a
 * different object remounts this with fresh initial state. That is React's
 * documented way to reset state on a prop change, and it avoids a
 * setState-inside-effect cascade.
 */
function ObjectEditor({
  initialName,
  initialDescription = "",
  initialNotes = "",
  showText,
  onCommitName,
  onCommitDescription,
  onCommitNotes,
  onInvalidName,
}: EditorProps): ReactNode {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [notes, setNotes] = useState(initialNotes);

  return (
    <>
      <Field label="Name">
        <input
          value={name}
          aria-label="Name"
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            const trimmed = name.trim();
            if (trimmed.length === 0) {
              setName(initialName);
              onInvalidName();
              return;
            }
            if (trimmed !== initialName) onCommitName(trimmed);
          }}
          className={INPUT_CLASS}
        />
      </Field>

      {showText && (
        <>
          <Field label="Description">
            <textarea
              value={description}
              rows={3}
              aria-label="Description"
              onChange={(event) => setDescription(event.target.value)}
              onBlur={() => {
                const next = description.trim();
                if (next !== initialDescription) {
                  onCommitDescription?.(next.length === 0 ? null : next);
                }
              }}
              className={`${INPUT_CLASS} resize-y`}
            />
          </Field>

          <Field label="Notes">
            <textarea
              value={notes}
              rows={4}
              aria-label="Notes"
              onChange={(event) => setNotes(event.target.value)}
              onBlur={() => {
                const next = notes.trim();
                if (next !== initialNotes) {
                  onCommitNotes?.(next.length === 0 ? null : next);
                }
              }}
              className={`${INPUT_CLASS} resize-y`}
            />
          </Field>
        </>
      )}
    </>
  );
}

function TripDetails({ trip }: { trip: TripWithCounts }): ReactNode {
  return (
    <>
      <div className="my-4 h-px bg-[var(--color-border-subtle)]" />

      <Field label="Status">
        <ReadOnly value={trip.status === "archived" ? "Archived" : "Active"} />
      </Field>

      <Field label="Contents">
        <ul className="text-[13px] text-[var(--color-text-primary)]">
          <li>{trip.routeCount} routes</li>
          <li>{trip.trackCount} tracks</li>
          <li>{trip.waypointCount} waypoints</li>
        </ul>
        <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
          Tracks are recorded GPS files. Import GPX, KML, KMZ, TCX, FIT or CSV
          to add them.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button onClick={() => actions.startDrawingRoute()}>New Route</Button>
          <Button onClick={() => actions.startPlacingWaypoint()}>
            New Waypoint
          </Button>
          <Button onClick={() => void actions.chooseFilesToImport()}>
            Import…
          </Button>
          <Button
            onClick={() =>
              actions.openExportDialog({ kind: "trips", tripIds: [trip.id] })
            }
          >
            Export…
          </Button>
        </div>
      </Field>

      <Field label="Created">
        <ReadOnly value={formatTimestamp(trip.createdAt)} />
      </Field>

      <Field label="Last modified">
        <ReadOnly value={formatTimestamp(trip.updatedAt)} />
      </Field>
    </>
  );
}

function FolderDetails({ folder }: { folder: Folder }): ReactNode {
  return (
    <>
      <div className="my-4 h-px bg-[var(--color-border-subtle)]" />
      <Field label="Created">
        <ReadOnly value={formatTimestamp(folder.createdAt)} />
      </Field>
      <Field label="Last modified">
        <ReadOnly value={formatTimestamp(folder.updatedAt)} />
      </Field>
    </>
  );
}

export function PropertiesPanel(): ReactNode {
  const { selected, trip, folder, route, track, waypoint, loading, reload } =
    useSelectionStore();
  const refresh = useLibraryStore((s) => s.refresh);
  const showToast = useUiStore((s) => s.showToast);
  const settings = useSettingsStore((s) => s.settings);

  const commit = async (patch: {
    name?: string;
    description?: string | null;
    notes?: string | null;
  }): Promise<void> => {
    if (selected === null) return;
    try {
      if (selected.kind === "trip") {
        await call(api().trips.update({ id: selected.id, ...patch }));
      } else if (selected.kind === "folder" && patch.name !== undefined) {
        await call(api().folders.rename({ id: selected.id, name: patch.name }));
      }
      await reload();
      await refresh();
    } catch (cause) {
      showToast(describeError(cause), "error");
      await reload();
    }
  };

  if (selected === null) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[12px] text-[var(--color-text-muted)]">
        Select a trip or folder to see its properties.
      </div>
    );
  }

  if (selected.kind === "route") {
    if (route === null) {
      return (
        <div className="p-4 text-[12px] text-[var(--color-text-muted)]">
          Loading…
        </div>
      );
    }
    return (
      <RouteProperties
        route={route}
        units={settings.units}
        planningSpeedKmh={settings.planningSpeedKmh}
      />
    );
  }

  if (selected.kind === "waypoint") {
    if (waypoint === null) {
      return (
        <div className="p-4 text-[12px] text-[var(--color-text-muted)]">
          Loading…
        </div>
      );
    }
    return <WaypointProperties waypoint={waypoint} units={settings.units} />;
  }

  if (selected.kind === "track") {
    if (track === null) {
      return (
        <div className="p-4 text-[12px] text-[var(--color-text-muted)]">
          Loading…
        </div>
      );
    }
    return <TrackProperties track={track} units={settings.units} />;
  }

  if (selected.kind !== "trip" && selected.kind !== "folder") {
    return (
      <div className="p-4 text-[12px] text-[var(--color-text-secondary)]">
        {selected.kind} properties arrive with that feature in a later phase.
      </div>
    );
  }

  if (loading && trip === null && folder === null) {
    return (
      <div className="p-4 text-[12px] text-[var(--color-text-muted)]">
        Loading…
      </div>
    );
  }

  const object = selected.kind === "trip" ? trip : folder;
  if (object === null) return null;

  return (
    <div className="h-full overflow-y-auto p-3">
      <h2 className="mb-3 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
        {selected.kind === "trip" ? "Trip" : "Folder"}
      </h2>

      <ObjectEditor
        // Remount on selection change so the draft never carries over.
        key={`${selected.kind}:${object.id}`}
        initialName={object.name}
        showText={selected.kind === "trip"}
        {...(trip !== null && selected.kind === "trip"
          ? {
              initialDescription: trip.description ?? "",
              initialNotes: trip.notes ?? "",
              onCommitDescription: (description: string | null) =>
                void commit({ description }),
              onCommitNotes: (notes: string | null) => void commit({ notes }),
            }
          : {})}
        onCommitName={(name) => void commit({ name })}
        onInvalidName={() => showToast("A name cannot be empty.", "error")}
      />

      {selected.kind === "trip" && trip !== null && <TripDetails trip={trip} />}
      {selected.kind === "folder" && folder !== null && (
        <FolderDetails folder={folder} />
      )}
    </div>
  );
}
