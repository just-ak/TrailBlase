import { useEffect, useState, type ReactNode } from 'react';
import type { BackupEntry } from '@shared/ipc/api';
import { formatTimestamp } from '@shared/geo/units';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { api, call, callOr, describeError } from '../../lib/client';
import { useLibraryStore } from '../../stores/libraryStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';

const formatSize = (bytes: number): string =>
  bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * Restore from a backup.
 *
 * Confirmation is explicit because this replaces the live collection. The main
 * process snapshots the current database first, so a mistaken restore is itself
 * recoverable. Requirement 9.3.
 */
export function RestoreDialog(): ReactNode {
  const closeDialog = useUiStore((s) => s.closeDialog);
  const showToast = useUiStore((s) => s.showToast);
  const refresh = useLibraryStore((s) => s.refresh);
  const clearSelection = useSelectionStore((s) => s.clear);
  const loadSettings = useSettingsStore((s) => s.load);

  const [backups, setBackups] = useState<BackupEntry[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      setBackups(await callOr(api().backup.list(), []));
    })();
  }, []);

  const restore = async (): Promise<void> => {
    if (chosen === null) return;
    setBusy(true);
    try {
      await call(api().backup.restore({ fileName: chosen }));
      clearSelection();
      await loadSettings();
      await refresh();
      closeDialog();
      showToast('Backup restored. Your previous data was saved as a new backup.');
    } catch (cause) {
      showToast(describeError(cause), 'error');
      setBusy(false);
    }
  };

  const createNow = async (): Promise<void> => {
    setBusy(true);
    try {
      await call(api().backup.create());
      setBackups(await callOr(api().backup.list(), []));
      showToast('Backup created.');
    } catch (cause) {
      showToast(describeError(cause), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Restore from backup"
      width={560}
      onClose={closeDialog}
      footer={
        <>
          <Button onClick={() => void createNow()} disabled={busy}>
            Back Up Now
          </Button>
          <Button onClick={closeDialog} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => void restore()}
            disabled={busy || chosen === null}
          >
            {busy ? 'Restoring…' : 'Restore'}
          </Button>
        </>
      }
    >
      {backups === null && (
        <p className="text-[13px] text-[var(--color-text-muted)]">Loading…</p>
      )}

      {backups !== null && backups.length === 0 && (
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          There are no backups yet. One is taken automatically on the schedule
          in Settings, and when the app quits.
        </p>
      )}

      {backups !== null && backups.length > 0 && (
        <>
          <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">
            Restoring replaces your current collection. The current database is
            backed up first, so this is reversible.
          </p>
          <div
            role="radiogroup"
            aria-label="Available backups"
            className="overflow-hidden rounded-md border border-[var(--color-border-subtle)]"
          >
            {backups.map((entry) => (
              <label
                key={entry.fileName}
                className="flex cursor-default items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2 last:border-b-0 hover:bg-[var(--color-surface-sunken)]"
              >
                <input
                  type="radio"
                  name="backup"
                  value={entry.fileName}
                  checked={chosen === entry.fileName}
                  onChange={() => setChosen(entry.fileName)}
                />
                <span className="flex-1 text-[13px] text-[var(--color-text-primary)]">
                  {formatTimestamp(entry.createdAt)}
                </span>
                <span className="text-[12px] text-[var(--color-text-muted)]">
                  {formatSize(entry.byteSize)}
                </span>
              </label>
            ))}
          </div>
        </>
      )}
    </Dialog>
  );
}
