import { useEffect, useState, type ReactNode } from 'react';
import { formatTimestamp } from '@shared/geo/units';
import { api, call, describeError } from '../../lib/client';
import { useLibraryStore } from '../../stores/libraryStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useUiStore } from '../../stores/uiStore';

/**
 * The right panel.
 *
 * Phase 1 inspects trips and folders. The route, track and waypoint views
 * specified in section 3 need objects that arrive in Phases 2 and 3; rather
 * than render empty fields, the panel says what is coming.
 *
 * Edits commit on blur and write through the service layer — there is no save
 * button because there is no unsaved state. ADR 0001.
 */

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
  return <p className="text-[13px] text-[var(--color-text-primary)]">{value}</p>;
}

export function PropertiesPanel(): ReactNode {
  const { selected, trip, folder, loading, reload } = useSelectionStore();
  const refresh = useLibraryStore((s) => s.refresh);
  const showToast = useUiStore((s) => s.showToast);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');

  // Reset the draft whenever the selection changes, otherwise the previous
  // object's text lingers in the inputs.
  useEffect(() => {
    if (trip !== null) {
      setName(trip.name);
      setDescription(trip.description ?? '');
      setNotes(trip.notes ?? '');
    } else if (folder !== null) {
      setName(folder.name);
      setDescription('');
      setNotes('');
    }
  }, [trip, folder]);

  const commit = async (
    patch: { name?: string; description?: string | null; notes?: string | null },
  ): Promise<void> => {
    if (selected === null) return;
    try {
      if (selected.kind === 'trip') {
        await call(api().trips.update({ id: selected.id, ...patch }));
      } else if (selected.kind === 'folder' && patch.name !== undefined) {
        await call(api().folders.rename({ id: selected.id, name: patch.name }));
      }
      await reload();
      await refresh();
    } catch (cause) {
      showToast(describeError(cause), 'error');
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

  if (loading && trip === null && folder === null) {
    return (
      <div className="p-4 text-[12px] text-[var(--color-text-muted)]">Loading…</div>
    );
  }

  if (selected.kind === 'route' || selected.kind === 'track' || selected.kind === 'waypoint') {
    return (
      <div className="p-4 text-[12px] text-[var(--color-text-secondary)]">
        {selected.kind} properties arrive with that feature in a later phase.
      </div>
    );
  }

  const inputClass =
    'w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]';

  return (
    <div className="h-full overflow-y-auto p-3">
      <h2 className="mb-3 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
        {selected.kind === 'trip' ? 'Trip' : 'Folder'}
      </h2>

      <Field label="Name">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            const trimmed = name.trim();
            const current = trip?.name ?? folder?.name ?? '';
            if (trimmed.length === 0) {
              setName(current);
              showToast('A name cannot be empty.', 'error');
              return;
            }
            if (trimmed !== current) void commit({ name: trimmed });
          }}
          className={inputClass}
        />
      </Field>

      {selected.kind === 'trip' && trip !== null && (
        <>
          <Field label="Description">
            <textarea
              value={description}
              rows={3}
              onChange={(event) => setDescription(event.target.value)}
              onBlur={() => {
                const next = description.trim();
                if (next !== (trip.description ?? '')) {
                  void commit({ description: next.length === 0 ? null : next });
                }
              }}
              className={`${inputClass} resize-y`}
            />
          </Field>

          <Field label="Notes">
            <textarea
              value={notes}
              rows={4}
              onChange={(event) => setNotes(event.target.value)}
              onBlur={() => {
                const next = notes.trim();
                if (next !== (trip.notes ?? '')) {
                  void commit({ notes: next.length === 0 ? null : next });
                }
              }}
              className={`${inputClass} resize-y`}
            />
          </Field>

          <div className="my-4 h-px bg-[var(--color-border-subtle)]" />

          <Field label="Status">
            <ReadOnly value={trip.status === 'archived' ? 'Archived' : 'Active'} />
          </Field>

          <Field label="Contents">
            <ul className="text-[13px] text-[var(--color-text-primary)]">
              <li>{trip.routeCount} routes</li>
              <li>{trip.trackCount} tracks</li>
              <li>{trip.waypointCount} waypoints</li>
            </ul>
            <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
              Routes and waypoints can be created from Phase 2; tracks are
              imported in Phase 3.
            </p>
          </Field>

          <Field label="Created">
            <ReadOnly value={formatTimestamp(trip.createdAt)} />
          </Field>

          <Field label="Last modified">
            <ReadOnly value={formatTimestamp(trip.updatedAt)} />
          </Field>
        </>
      )}

      {selected.kind === 'folder' && folder !== null && (
        <>
          <Field label="Created">
            <ReadOnly value={formatTimestamp(folder.createdAt)} />
          </Field>
          <Field label="Last modified">
            <ReadOnly value={formatTimestamp(folder.updatedAt)} />
          </Field>
        </>
      )}
    </div>
  );
}
