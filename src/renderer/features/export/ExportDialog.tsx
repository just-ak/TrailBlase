import { useEffect, useState, type ReactNode } from 'react';
import type { ExportFormatOption } from '@shared/ipc/api';
import type { ExportScopeRequest } from '@shared/ipc/schemas';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { api, call, callOr, describeError } from '../../lib/client';
import { useUiStore } from '../../stores/uiStore';

/**
 * Export: pick a format, see what it cannot carry, then write.
 *
 * The loss list is the reason this dialog exists rather than a format submenu.
 * Choosing CSV for a trip with tracks silently drops them, and a user who finds
 * that out by reopening the file has been misled. So every format is listed
 * with its own consequences, and a format that can carry nothing in this scope
 * is shown disabled with the reason instead of being hidden — a missing option
 * invites the question "why can't I?" with no answer.
 *
 * TCX and FIT are absent, and the note at the bottom says why. They are
 * recording formats whose required device and session data TrailRT does not
 * hold, so writing one would mean inventing it.
 */

const READ_ONLY_NOTE =
  'TCX and FIT are not listed: both describe a recording session — laps, device, sport — that TrailRT does not hold, so writing one would mean inventing that data. TrailRT reads both.';

export function ExportDialog({
  scope,
}: {
  scope: ExportScopeRequest;
}): ReactNode {
  const closeDialog = useUiStore((s) => s.closeDialog);
  const showToast = useUiStore((s) => s.showToast);

  const [options, setOptions] = useState<ExportFormatOption[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const result = await callOr(api().exporting.options({ scope }), []);
      setOptions(result);
      // Default to the first format that can actually carry this selection,
      // rather than to GPX regardless.
      setChosen(result.find((option) => !option.empty)?.format ?? null);
    })();
  }, [scope]);

  const selected = options?.find((option) => option.format === chosen) ?? null;

  const run = async (): Promise<void> => {
    if (selected === null) return;
    setBusy(true);
    try {
      const outcome = await call(
        api().exporting.run({ scope, format: selected.format }),
      );
      if (outcome.cancelled) {
        setBusy(false);
        return;
      }
      closeDialog();
      showToast(
        outcome.losses.length === 0
          ? `Exported ${outcome.fileName ?? 'file'}.`
          : `Exported ${outcome.fileName ?? 'file'} with ${outcome.losses.length} noted limitation${outcome.losses.length === 1 ? '' : 's'}.`,
      );
    } catch (cause) {
      showToast(describeError(cause), 'error');
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Export"
      width={560}
      onClose={closeDialog}
      footer={
        <>
          <Button onClick={closeDialog} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void run()}
            disabled={busy || selected === null || selected.empty}
          >
            {busy ? 'Exporting…' : 'Export…'}
          </Button>
        </>
      }
    >
      {options === null && (
        <p className="text-[13px] text-[var(--color-text-muted)]">Loading…</p>
      )}

      {options !== null && (
        <div role="radiogroup" aria-label="Export format">
          {options.map((option) => (
            <label
              key={option.format}
              className={`mb-2 flex cursor-default gap-2 rounded-md border p-3 ${
                chosen === option.format
                  ? 'border-[var(--color-accent)]'
                  : 'border-[var(--color-border-subtle)]'
              } ${option.empty ? 'opacity-60' : ''}`}
            >
              <input
                type="radio"
                name="format"
                className="mt-0.5"
                value={option.format}
                checked={chosen === option.format}
                disabled={option.empty}
                onChange={() => setChosen(option.format)}
              />
              <span className="flex-1">
                <span className="block text-[13px] font-semibold text-[var(--color-text-primary)]">
                  {option.label}{' '}
                  <span className="font-normal text-[var(--color-text-muted)]">
                    .{option.extension}
                  </span>
                </span>

                <span className="block text-[12px] text-[var(--color-text-secondary)]">
                  {option.empty
                    ? `${option.label} cannot carry anything in this selection.`
                    : `Writes ${option.willWrite.routes} routes, ${option.willWrite.tracks} tracks, ${option.willWrite.waypoints} waypoints.`}
                </span>

                {/* The point of the dialog: consequences before the write. */}
                {option.losses.map((loss, index) => (
                  <span
                    key={`${index}-${loss}`}
                    className="mt-1 block text-[11px] text-[var(--color-warning,#b45309)]"
                  >
                    {loss}
                  </span>
                ))}
              </span>
            </label>
          ))}
        </div>
      )}

      <p className="mt-3 border-t border-[var(--color-border-subtle)] pt-3 text-[11px] text-[var(--color-text-muted)]">
        {READ_ONLY_NOTE}
      </p>
    </Dialog>
  );
}
