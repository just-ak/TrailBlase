import { useEffect, useState, type ReactNode } from 'react';
import type { ImportProgress, ImportReport } from '@shared/io/types';
import type { StagedImport, StagedPreview } from '@shared/ipc/api';
import type { TripWithCounts } from '@shared/domain/types';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { api, call, callOr, describeError } from '../../lib/client';
import { useGeometryStore } from '../../stores/geometryStore';
import { useLibraryStore } from '../../stores/libraryStore';
import { useUiStore } from '../../stores/uiStore';

/**
 * Import: preview, choose, commit, then read the report.
 *
 * The files arrive already parsed and staged in the main process, identified by
 * opaque tokens — the renderer holds no filesystem paths. So this dialog shows
 * what *would* be imported with nothing yet written, which is the whole point
 * of the three-stage pipeline.
 *
 * Four things are deliberately visible rather than tucked away:
 *
 * - a file that failed to parse, with its reason, listed next to the good ones
 * - objects present in the file but not importable (`skipped`)
 * - fields preserved without a column of their own (`unmappedMetadata`)
 * - the report after the write, so what happened outlives the dialog
 */

type Phase = 'choosing' | 'importing' | 'done';

interface Selection {
  include: boolean;
  routes: Set<number>;
  tracks: Set<number>;
  waypoints: Set<number>;
}

function allSelected(preview: StagedPreview): Selection {
  return {
    include: true,
    routes: new Set(preview.routeNames.map((_, index) => index)),
    tracks: new Set(preview.trackNames.map((_, index) => index)),
    waypoints: new Set(preview.waypointNames.map((_, index) => index)),
  };
}

function Counts({ preview }: { preview: StagedPreview }): ReactNode {
  const parts: string[] = [];
  if (preview.counts.routes > 0) parts.push(`${preview.counts.routes} routes`);
  if (preview.counts.tracks > 0) parts.push(`${preview.counts.tracks} tracks`);
  if (preview.counts.waypoints > 0) {
    parts.push(`${preview.counts.waypoints} waypoints`);
  }

  return (
    <span className="text-[12px] text-[var(--color-text-muted)]">
      {preview.format.toUpperCase()} ·{' '}
      {parts.length === 0 ? 'nothing to import' : parts.join(', ')} ·{' '}
      {preview.counts.points.toLocaleString()} points
    </span>
  );
}

/** One group of objects within a file, each individually deselectable. */
function ObjectGroup({
  label,
  names,
  chosen,
  onToggle,
}: {
  label: string;
  names: readonly string[];
  chosen: Set<number>;
  onToggle: (index: number) => void;
}): ReactNode {
  if (names.length === 0) return null;

  return (
    <fieldset className="mt-2">
      <legend className="text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
        {label}
      </legend>
      <div className="mt-1 max-h-32 overflow-y-auto">
        {names.map((name, index) => (
          <label
            // Names repeat in real files, so the index is part of the identity.
            key={`${index}-${name}`}
            className="flex items-center gap-2 py-0.5 text-[12px] text-[var(--color-text-primary)]"
          >
            <input
              type="checkbox"
              checked={chosen.has(index)}
              onChange={() => onToggle(index)}
            />
            <span className="truncate">{name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Disclosure({
  summary,
  items,
}: {
  summary: string;
  items: readonly string[];
}): ReactNode {
  if (items.length === 0) return null;
  return (
    <details className="mt-2">
      <summary className="cursor-default text-[12px] text-[var(--color-text-secondary)]">
        {summary} ({items.length})
      </summary>
      <ul className="mt-1 list-inside list-disc text-[11px] text-[var(--color-text-muted)]">
        {items.map((item, index) => (
          <li key={`${index}-${item}`}>{item}</li>
        ))}
      </ul>
    </details>
  );
}

function ReportView({ reports }: { reports: readonly ImportReport[] }): ReactNode {
  return (
    <div>
      {reports.map((report, index) => (
        <div
          key={`${index}-${report.sourceName}`}
          className="mb-3 rounded-md border border-[var(--color-border-subtle)] p-3"
        >
          <p className="text-[13px] font-semibold text-[var(--color-text-primary)]">
            {report.sourceName}
          </p>
          <p
            className={`text-[12px] ${
              report.status === 'failed'
                ? 'text-[var(--color-danger)]'
                : 'text-[var(--color-text-secondary)]'
            }`}
          >
            {report.status === 'failed'
              ? `Not imported — ${report.error ?? 'unknown reason'}`
              : `${report.imported.routes} routes, ${report.imported.tracks} tracks, ${report.imported.waypoints} waypoints (${report.imported.points.toLocaleString()} points)`}
          </p>
          {report.destinationTripName !== null && (
            <p className="text-[11px] text-[var(--color-text-muted)]">
              Into “{report.destinationTripName}”
            </p>
          )}

          <Disclosure summary="Warnings" items={report.warnings} />
          <Disclosure
            summary="Not imported"
            items={report.skipped.map(
              (item) => `${item.kind} “${item.name}”: ${item.reason}`,
            )}
          />
          {/* Named, not silently kept: the user is told their data survived
              even though no column displays it. */}
          <Disclosure
            summary="Preserved without a field of its own"
            items={report.unmappedMetadata}
          />
        </div>
      ))}
    </div>
  );
}

export function ImportDialog({ staged }: { staged: StagedImport[] }): ReactNode {
  const closeDialog = useUiStore((s) => s.closeDialog);
  const showToast = useUiStore((s) => s.showToast);
  const refresh = useLibraryStore((s) => s.refresh);

  const [phase, setPhase] = useState<Phase>('choosing');
  const [trips, setTrips] = useState<TripWithCounts[]>([]);
  const [destination, setDestination] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [reports, setReports] = useState<ImportReport[]>([]);
  const [selections, setSelections] = useState<Map<string, Selection>>(() => {
    const initial = new Map<string, Selection>();
    for (const file of staged) {
      initial.set(
        file.token,
        file.preview === null
          ? {
              include: false,
              routes: new Set(),
              tracks: new Set(),
              waypoints: new Set(),
            }
          : allSelected(file.preview),
      );
    }
    return initial;
  });

  useEffect(() => {
    void (async () => {
      setTrips(
        await callOr(
          api().trips.list({ includeArchived: true, sortKey: 'name', sortDirection: 'asc' }),
          [],
        ),
      );
    })();
  }, []);

  useEffect(
    () => api().events.onImportProgress((next) => setProgress(next)),
    [],
  );

  // Abandoning the dialog must release the staged files in the main process,
  // or a cancelled import would keep its parsed data alive for an hour.
  const cancel = (): void => {
    void callOr(
      api().importing.discard({ tokens: staged.map((file) => file.token) }),
      null,
    );
    closeDialog();
  };

  const update = (token: string, patch: Partial<Selection>): void => {
    setSelections((current) => {
      const next = new Map(current);
      const existing = next.get(token);
      if (existing === undefined) return current;
      next.set(token, { ...existing, ...patch });
      return next;
    });
  };

  const toggleIndex = (
    token: string,
    group: 'routes' | 'tracks' | 'waypoints',
    index: number,
  ): void => {
    setSelections((current) => {
      const next = new Map(current);
      const existing = next.get(token);
      if (existing === undefined) return current;
      const set = new Set(existing[group]);
      if (set.has(index)) set.delete(index);
      else set.add(index);
      next.set(token, { ...existing, [group]: set });
      return next;
    });
  };

  const importable = staged.filter((file) => {
    const selection = selections.get(file.token);
    return file.preview !== null && selection?.include === true;
  });

  const run = async (): Promise<void> => {
    setPhase('importing');
    try {
      const result = await call(
        api().importing.commit({
          files: importable.map((file) => {
            const selection = selections.get(file.token);
            return {
              token: file.token,
              destinationTripId: destination,
              routeIndices: [...(selection?.routes ?? [])],
              trackIndices: [...(selection?.tracks ?? [])],
              waypointIndices: [...(selection?.waypoints ?? [])],
              retainOriginal: true,
            };
          }),
        }),
      );
      setReports(result);
      setPhase('done');
      await refresh();
      await useGeometryStore.getState().reload();
    } catch (cause) {
      showToast(describeError(cause), 'error');
      setPhase('choosing');
    }
  };

  if (phase === 'done') {
    return (
      <Dialog
        title="Import report"
        width={620}
        onClose={closeDialog}
        footer={
          <Button onClick={closeDialog} aria-label="Close import report">
            Done
          </Button>
        }
      >
        <ReportView reports={reports} />
      </Dialog>
    );
  }

  if (phase === 'importing') {
    const percent =
      progress === null || progress.pointsTotal === 0
        ? 0
        : Math.round((progress.pointsWritten / progress.pointsTotal) * 100);

    return (
      <Dialog title="Importing" width={480} onClose={() => undefined}>
        <p className="text-[13px] text-[var(--color-text-primary)]">
          {progress === null
            ? 'Reading…'
            : `${progress.sourceName} — file ${progress.fileIndex + 1} of ${progress.fileCount}`}
        </p>
        {progress !== null && progress.pointsTotal > 0 && (
          <>
            <div
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-sunken)]"
            >
              <div
                className="h-full bg-[var(--color-accent)]"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
              {progress.pointsWritten.toLocaleString()} of{' '}
              {progress.pointsTotal.toLocaleString()} points
            </p>
          </>
        )}
      </Dialog>
    );
  }

  return (
    <Dialog
      title={`Import ${staged.length} file${staged.length === 1 ? '' : 's'}`}
      width={620}
      onClose={cancel}
      footer={
        <>
          <Button onClick={cancel} aria-label="Cancel import">
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={importable.length === 0}
            onClick={() => void run()}
            // An explicit name because the library toolbar also has an
            // "Import…" button; the visible label stays a count.
            aria-label="Confirm import"
          >
            Import {importable.length > 0 ? `(${importable.length})` : ''}
          </Button>
        </>
      }
    >
      <label className="mb-3 block">
        <span className="mb-1 block text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
          Destination
        </span>
        <select
          aria-label="Destination trip"
          value={destination ?? ''}
          onChange={(event) =>
            setDestination(
              event.target.value === '' ? null : event.target.value,
            )
          }
          className="w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1 text-[13px]"
        >
          <option value="">New trip named after each file</option>
          {trips.map((trip) => (
            <option key={trip.id} value={trip.id}>
              {trip.name}
            </option>
          ))}
        </select>
      </label>

      {staged.map((file) => {
        const selection = selections.get(file.token);

        if (file.preview === null) {
          return (
            <div
              key={file.token}
              className="mb-3 rounded-md border border-[var(--color-danger)] p-3"
            >
              <p className="text-[13px] font-semibold text-[var(--color-text-primary)]">
                {file.sourceName}
              </p>
              {/* Listed rather than quietly omitted, so the count of files the
                  user chose still matches what they see. */}
              <p className="text-[12px] text-[var(--color-danger)]">
                {file.error?.message ?? 'This file could not be read.'}
              </p>
              {file.error?.detail !== undefined && (
                <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
                  {file.error.detail}
                </p>
              )}
            </div>
          );
        }

        return (
          <div
            key={file.token}
            className="mb-3 rounded-md border border-[var(--color-border-subtle)] p-3"
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selection?.include ?? false}
                onChange={() =>
                  update(file.token, { include: !(selection?.include ?? false) })
                }
              />
              <span className="flex-1 truncate text-[13px] font-semibold text-[var(--color-text-primary)]">
                {file.sourceName}
              </span>
            </label>
            <div className="ml-6">
              <Counts preview={file.preview} />

              {selection?.include === true && (
                <>
                  <ObjectGroup
                    label="Routes"
                    names={file.preview.routeNames}
                    chosen={selection.routes}
                    onToggle={(index) =>
                      toggleIndex(file.token, 'routes', index)
                    }
                  />
                  <ObjectGroup
                    label="Tracks"
                    names={file.preview.trackNames}
                    chosen={selection.tracks}
                    onToggle={(index) =>
                      toggleIndex(file.token, 'tracks', index)
                    }
                  />
                  <ObjectGroup
                    label="Waypoints"
                    names={file.preview.waypointNames}
                    chosen={selection.waypoints}
                    onToggle={(index) =>
                      toggleIndex(file.token, 'waypoints', index)
                    }
                  />
                </>
              )}

              <Disclosure summary="Warnings" items={file.preview.warnings} />
              <Disclosure
                summary="Not importable"
                items={file.preview.skipped.map(
                  (item) => `${item.kind} “${item.name}”: ${item.reason}`,
                )}
              />
              <Disclosure
                summary="Will be preserved without a field of its own"
                items={file.preview.unmappedMetadata}
              />
            </div>
          </div>
        );
      })}
    </Dialog>
  );
}
