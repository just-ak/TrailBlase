import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ObjectRef, TreeNode, TripSortKey } from '@shared/domain/types';
import { ContextMenu, type MenuItem } from '../../components/ContextMenu';
import { api, call, describeError } from '../../lib/client';
import { useLibraryStore } from '../../stores/libraryStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useUiStore } from '../../stores/uiStore';
import { TreeRow } from './TreeRow';

/**
 * The left panel: a hierarchical library of folders and trips.
 *
 * Drag-and-drop reparents rather than copying, and a move that would create a
 * cycle is rejected by the main process with an explanation rather than being
 * silently dropped. Requirement 5.6.
 */

interface DragPayload {
  kind: 'trip' | 'folder';
  id: string;
}

const MIME = 'application/x-trailrt-node';

function parseNodeId(id: string): ObjectRef | null {
  const [kind, rest] = id.split(':');
  if (rest === undefined) return null;
  if (kind === 'trip') return { kind: 'trip', id: rest };
  if (kind === 'folder') return { kind: 'folder', id: rest };
  return null;
}

export function LibraryPanel(): ReactNode {
  const {
    tree,
    loading,
    error,
    refresh,
    isExpanded,
    toggleExpanded,
    setExpanded,
    sortKey,
    sortDirection,
    setSort,
    showArchived,
    setShowArchived,
    search,
    searchResults,
    setSearch,
  } = useLibraryStore();

  const selected = useSelectionStore((s) => s.selected);
  const select = useSelectionStore((s) => s.select);
  const showToast = useUiStore((s) => s.showToast);
  const openDialog = useUiStore((s) => s.openDialog);

  const [menu, setMenu] = useState<{ x: number; y: number; node: TreeNode } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
    return api().events.onLibraryChanged(() => {
      void refresh();
      void useSelectionStore.getState().reload();
    });
  }, [refresh]);

  const selectedNodeId = useMemo(() => {
    if (selected === null) return null;
    return `${selected.kind}:${selected.id}`;
  }, [selected]);

  // ---------------------------------------------------------- mutations

  const createTrip = useCallback(
    async (folderId: string | null) => {
      try {
        const trip = await call(
          api().trips.create({ name: 'New Trip', folderId }),
        );
        await refresh();
        await select({ kind: 'trip', id: trip.id });
        // Straight into rename, which is what the user wants next.
        setRenamingId(`trip:${trip.id}`);
      } catch (cause) {
        showToast(describeError(cause), 'error');
      }
    },
    [refresh, select, showToast],
  );

  const createFolder = useCallback(
    async (parentId: string | null) => {
      try {
        const folder = await call(
          api().folders.create({ name: 'New Folder', parentId }),
        );
        if (parentId !== null) setExpanded(`folder:${parentId}`, true);
        await refresh();
        await select({ kind: 'folder', id: folder.id });
        setRenamingId(`folder:${folder.id}`);
      } catch (cause) {
        showToast(describeError(cause), 'error');
      }
    },
    [refresh, select, setExpanded, showToast],
  );

  const commitRename = useCallback(
    async (nodeId: string, name: string) => {
      setRenamingId(null);
      const ref = parseNodeId(nodeId);
      if (ref === null) return;
      const trimmed = name.trim();
      if (trimmed.length === 0) {
        showToast('A name cannot be empty.', 'error');
        return;
      }
      try {
        if (ref.kind === 'trip') {
          await call(api().trips.update({ id: ref.id, name: trimmed }));
        } else {
          await call(api().folders.rename({ id: ref.id, name: trimmed }));
        }
        await refresh();
        await useSelectionStore.getState().reload();
      } catch (cause) {
        showToast(describeError(cause), 'error');
      }
    },
    [refresh, showToast],
  );

  const duplicateTrip = useCallback(
    async (id: string) => {
      try {
        const copy = await call(api().trips.duplicate({ id }));
        await refresh();
        await select({ kind: 'trip', id: copy.id });
      } catch (cause) {
        showToast(describeError(cause), 'error');
      }
    },
    [refresh, select, showToast],
  );

  const setArchived = useCallback(
    async (id: string, archived: boolean) => {
      try {
        await call(
          api().trips.setStatus({ id, status: archived ? 'archived' : 'active' }),
        );
        await refresh();
      } catch (cause) {
        showToast(describeError(cause), 'error');
      }
    },
    [refresh, showToast],
  );

  /** Destructive operations are always confirmed, with counts. Requirement 5.4. */
  const confirmDelete = useCallback(
    async (ref: ObjectRef, name: string) => {
      try {
        if (ref.kind === 'trip') {
          const trip = await call(api().trips.get({ id: ref.id }));
          openDialog({
            kind: 'confirmDelete',
            target: { type: 'trip', id: ref.id, name },
            counts: {
              routes: trip.routeCount,
              tracks: trip.trackCount,
              waypoints: trip.waypointCount,
            },
          });
        } else {
          openDialog({
            kind: 'confirmDelete',
            target: { type: 'folder', id: ref.id, name },
            counts: {},
          });
        }
      } catch (cause) {
        showToast(describeError(cause), 'error');
      }
    },
    [openDialog, showToast],
  );

  // ------------------------------------------------------- drag and drop

  const onDragStart = (node: TreeNode) => (event: React.DragEvent): void => {
    const ref = parseNodeId(node.id);
    if (ref === null || ref.kind === 'route') return;
    const payload: DragPayload = { kind: ref.kind as 'trip' | 'folder', id: ref.id };
    event.dataTransfer.setData(MIME, JSON.stringify(payload));
    // "move", not "copy": dragging reparents. ADR 0004.
    event.dataTransfer.effectAllowed = 'move';
  };

  const canDropOn = (node: TreeNode): boolean =>
    node.kind === 'folder' || (node.kind === 'view' && node.viewId === 'trips');

  const onDragOver = (node: TreeNode) => (event: React.DragEvent): void => {
    if (!event.dataTransfer.types.includes(MIME) || !canDropOn(node)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetId(node.id);
  };

  const onDrop = (node: TreeNode) => (event: React.DragEvent): void => {
    event.preventDefault();
    setDropTargetId(null);
    if (!canDropOn(node)) return;

    const raw = event.dataTransfer.getData(MIME);
    if (raw.length === 0) return;

    let payload: DragPayload;
    try {
      payload = JSON.parse(raw) as DragPayload;
    } catch {
      return;
    }

    // Dropping on the Trips view means "move to the root".
    const destination =
      node.kind === 'folder' ? (parseNodeId(node.id)?.id ?? null) : null;

    void (async () => {
      try {
        if (payload.kind === 'trip') {
          await call(api().trips.move({ id: payload.id, folderId: destination }));
        } else {
          if (payload.id === destination) return;
          await call(
            api().folders.move({ id: payload.id, parentId: destination }),
          );
        }
        if (destination !== null) setExpanded(`folder:${destination}`, true);
        await refresh();
      } catch (cause) {
        // A rejected cycle lands here with the main process's explanation.
        showToast(describeError(cause), 'error');
      }
    })();
  };

  // -------------------------------------------------------- context menu

  const menuItems = (node: TreeNode): MenuItem[] => {
    const ref = parseNodeId(node.id);

    if (node.kind === 'view' && node.viewId === 'trips') {
      return [
        { label: 'New Trip', onSelect: () => void createTrip(null) },
        { label: 'New Folder', onSelect: () => void createFolder(null) },
      ];
    }

    if (node.kind === 'view') {
      return [
        {
          label: node.name,
          disabled: true,
          disabledReason: 'This view becomes available in a later phase.',
        },
      ];
    }

    if (ref?.kind === 'folder') {
      return [
        { label: 'New Trip in Folder', onSelect: () => void createTrip(ref.id) },
        { label: 'New Subfolder', onSelect: () => void createFolder(ref.id) },
        { label: 'Rename…', separatorBefore: true, onSelect: () => setRenamingId(node.id) },
        {
          label: 'Delete Folder…',
          danger: true,
          separatorBefore: true,
          onSelect: () => void confirmDelete(ref, node.name),
        },
      ];
    }

    if (ref?.kind === 'trip') {
      const archived = node.status === 'archived';
      return [
        { label: 'Rename…', onSelect: () => setRenamingId(node.id) },
        { label: 'Duplicate', onSelect: () => void duplicateTrip(ref.id) },
        {
          label: archived ? 'Unarchive' : 'Archive',
          separatorBefore: true,
          onSelect: () => void setArchived(ref.id, !archived),
        },
        { label: 'New Route', disabled: true, disabledReason: 'Arrives in Phase 2' },
        { label: 'New Waypoint', disabled: true, disabledReason: 'Arrives in Phase 2' },
        {
          label: 'Delete Trip…',
          danger: true,
          separatorBefore: true,
          onSelect: () => void confirmDelete(ref, node.name),
        },
      ];
    }

    return [{ label: 'New Trip', onSelect: () => void createTrip(null) }];
  };

  // Exposed so the native Trip menu can drive the same actions.
  useEffect(() => {
    return api().events.onMenuAction((action) => {
      const ref = useSelectionStore.getState().selected;
      if (action === 'trip:new') void createTrip(null);
      else if (action === 'folder:new') void createFolder(null);
      else if (action === 'trip:rename' && ref !== null) {
        setRenamingId(`${ref.kind}:${ref.id}`);
      } else if (action === 'trip:duplicate' && ref?.kind === 'trip') {
        void duplicateTrip(ref.id);
      } else if (
        (action === 'trip:delete' || action === 'selection:delete') &&
        ref !== null
      ) {
        const name =
          useSelectionStore.getState().trip?.name ??
          useSelectionStore.getState().folder?.name ??
          'this item';
        void confirmDelete(ref, name);
      }
    });
  }, [createTrip, createFolder, duplicateTrip, confirmDelete]);

  // ------------------------------------------------------------- render

  const rows: ReactNode[] = [];

  const renderNode = (node: TreeNode, depth: number): void => {
    const hasChildren = node.children.length > 0;
    const expanded = isExpanded(node.id);

    rows.push(
      <TreeRow
        key={node.id}
        node={node}
        depth={depth}
        selected={selectedNodeId === node.id}
        expanded={expanded}
        hasChildren={hasChildren}
        renaming={renamingId === node.id}
        dropTarget={dropTargetId === node.id}
        onToggle={() => toggleExpanded(node.id)}
        onSelect={() => {
          const ref = parseNodeId(node.id);
          void select(ref);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const ref = parseNodeId(node.id);
          if (ref !== null) void select(ref);
          setMenu({ x: event.clientX, y: event.clientY, node });
        }}
        onRenameCommit={(name) => void commitRename(node.id, name)}
        onRenameCancel={() => setRenamingId(null)}
        {...(node.kind === 'trip' || node.kind === 'folder'
          ? { onDragStart: onDragStart(node) }
          : {})}
        onDragOver={onDragOver(node)}
        onDragLeave={() => setDropTargetId(null)}
        onDrop={onDrop(node)}
      />,
    );

    if (expanded) {
      for (const child of node.children) renderNode(child, depth + 1);
    }
  };

  if (tree !== null) renderNode(tree, 0);

  const searching = search.trim().length > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-[var(--color-border-subtle)] px-2 py-2">
        <input
          type="search"
          value={search}
          placeholder="Search trips"
          aria-label="Search trips"
          onChange={(event) => void setSearch(event.target.value)}
          className="w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
        />
        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-[var(--color-text-secondary)]">
          <label htmlFor="sortKey" className="sr-only">
            Sort trips by
          </label>
          <select
            id="sortKey"
            value={sortKey}
            onChange={(event) =>
              setSort(event.target.value as TripSortKey, sortDirection)
            }
            className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-1 py-0.5"
          >
            <option value="name">Name</option>
            <option value="updatedAt">Modified</option>
            <option value="createdAt">Created</option>
            {/* Distance sorting needs routes and tracks, which arrive in
                Phase 3. Omitted rather than shown inert. */}
          </select>
          <button
            type="button"
            aria-label="Toggle sort direction"
            onClick={() => setSort(sortKey, sortDirection === 'asc' ? 'desc' : 'asc')}
            className="rounded border border-[var(--color-border-subtle)] px-1.5 py-0.5 hover:bg-[var(--color-surface-sunken)]"
          >
            {sortDirection === 'asc' ? '↑' : '↓'}
          </button>
          <label className="ml-auto flex items-center gap-1">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            Archived
          </label>
        </div>
      </div>

      <div
        role="tree"
        aria-label="Trip library"
        className="min-h-0 flex-1 overflow-y-auto py-1"
        onContextMenu={(event) => {
          event.preventDefault();
          if (tree !== null) setMenu({ x: event.clientX, y: event.clientY, node: tree });
        }}
      >
        {loading && tree === null && (
          <p className="px-3 py-2 text-[12px] text-[var(--color-text-muted)]">Loading…</p>
        )}

        {error !== null && (
          <p className="px-3 py-2 text-[12px] text-[var(--color-danger)]">{error}</p>
        )}

        {searching ? (
          <div>
            <p className="px-3 py-1 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
              {searchResults?.length ?? 0} match
              {(searchResults?.length ?? 0) === 1 ? '' : 'es'}
            </p>
            {(searchResults ?? []).map((trip) => (
              <button
                key={trip.id}
                type="button"
                onClick={() => void select({ kind: 'trip', id: trip.id })}
                className={`block w-full truncate px-3 py-1 text-left text-[13px] ${
                  selectedNodeId === `trip:${trip.id}`
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'hover:bg-[var(--color-surface-sunken)]'
                }`}
              >
                🗺️ {trip.name}
              </button>
            ))}
          </div>
        ) : (
          rows
        )}
      </div>

      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.node)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
