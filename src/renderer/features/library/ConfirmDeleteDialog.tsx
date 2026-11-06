import { useState, type ReactNode } from 'react';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { api, call, describeError } from '../../lib/client';
import { useLibraryStore } from '../../stores/libraryStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useUiStore } from '../../stores/uiStore';

interface Props {
  target: { type: 'trip' | 'folder'; id: string; name: string };
  counts: Record<string, number>;
}

/**
 * Destructive-action confirmation.
 *
 * States exactly what will be destroyed, including child counts, because a
 * trip delete cascades to its routes, tracks and waypoints and is not
 * undoable. Requirement 5.4 and ADR 0001.
 */
export function ConfirmDeleteDialog({ target, counts }: Props): ReactNode {
  const closeDialog = useUiStore((s) => s.closeDialog);
  const showToast = useUiStore((s) => s.showToast);
  const refresh = useLibraryStore((s) => s.refresh);
  const clearSelection = useSelectionStore((s) => s.clear);
  const [busy, setBusy] = useState(false);

  const children = Object.entries(counts).filter(([, n]) => n > 0);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    try {
      if (target.type === 'trip') {
        await call(api().trips.delete({ id: target.id }));
      } else {
        await call(api().folders.delete({ id: target.id }));
      }
      clearSelection();
      await refresh();
      closeDialog();
      showToast(`Deleted “${target.name}”.`);
    } catch (cause) {
      showToast(describeError(cause), 'error');
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={target.type === 'trip' ? 'Delete trip?' : 'Delete folder?'}
      onClose={closeDialog}
      footer={
        <>
          <Button onClick={closeDialog} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void confirm()} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete'}
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-[var(--color-text-primary)]">
        “{target.name}” will be permanently deleted.
      </p>

      {target.type === 'trip' && children.length > 0 && (
        <>
          <p className="mt-3 text-[13px] text-[var(--color-text-primary)]">
            This also deletes:
          </p>
          <ul className="mt-1 list-disc pl-5 text-[13px] text-[var(--color-text-secondary)]">
            {children.map(([label, n]) => (
              <li key={label}>
                {n} {label}
              </li>
            ))}
          </ul>
        </>
      )}

      {target.type === 'folder' && (
        <p className="mt-3 text-[13px] text-[var(--color-text-secondary)]">
          Subfolders are deleted too. Trips inside are kept and moved to the top
          level rather than deleted.
        </p>
      )}

      <p className="mt-3 text-[12px] text-[var(--color-text-muted)]">
        This cannot be undone. A copy may still exist in your automatic backups.
      </p>
    </Dialog>
  );
}
