import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ObjectRef, TreeNode, TripSortKey } from "@shared/domain/types";
import { ContextMenu, type MenuItem } from "../../components/ContextMenu";
import * as actions from "../../lib/actions";
import { api, call, describeError } from "../../lib/client";
import { useLibraryStore } from "../../stores/libraryStore";
import { useSelectionStore } from "../../stores/selectionStore";
import { useUiStore } from "../../stores/uiStore";
import { TreeRow } from "./TreeRow";

/**
 * The left panel: a hierarchical library of folders, trips, routes and
 * waypoints.
 *
 * Drag-and-drop reparents rather than copying (ADR 0004), and a move that
 * would create a cycle is rejected by the main process with an explanation
 * rather than silently dropped.
 */

const MIME = "application/x-trailrt-node";

/** Which kinds can be dragged, and what they can be dropped onto. */
const DRAGGABLE: ReadonlySet<string> = new Set([
  "trip",
  "folder",
  "route",
  "waypoint",
]);

function canAcceptDrop(node: TreeNode, dragged: ObjectRef): boolean {
  if (dragged.kind === "trip" || dragged.kind === "folder") {
    // Trips and folders live in folders, or at the root of the Trips view.
    return (
      node.kind === "folder" ||
      (node.kind === "view" && node.viewId === "trips")
    );
  }
  // Routes and waypoints belong to a trip, so only a trip can receive them.
  return node.kind === "trip";
}

function readDragged(event: React.DragEvent): ObjectRef | null {
  const raw = event.dataTransfer.getData(MIME);
  if (raw.length === 0) return null;
  try {
    return JSON.parse(raw) as ObjectRef;
  } catch {
    // A foreign drag payload is not an error; it simply is not ours.
    return null;
  }
}

const onDragStart =
  (node: TreeNode) =>
  (event: React.DragEvent): void => {
    if (node.ref === undefined || !DRAGGABLE.has(node.ref.kind)) return;
    event.dataTransfer.setData(MIME, JSON.stringify(node.ref));
    // "move", not "copy": dragging reparents rather than duplicating.
    event.dataTransfer.effectAllowed = "move";
  };

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
    setSearch,
  } = useLibraryStore();

  const selected = useSelectionStore((s) => s.selected);
  const select = useSelectionStore((s) => s.select);
  const showToast = useUiStore((s) => s.showToast);
  const openDialog = useUiStore((s) => s.openDialog);

  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    node: TreeNode;
  } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
    return api().events.onLibraryChanged(() => {
      void refresh();
    });
  }, [refresh]);

  const selectedKey = useMemo(
    () => (selected === null ? null : `${selected.kind}:${selected.id}`),
    [selected],
  );

  // ---------------------------------------------------------- mutations

  const createTrip = useCallback(
    async (folderId: string | null) => {
      try {
        const trip = await call(
          api().trips.create({ name: "New Trip", folderId }),
        );
        await refresh();
        await select({ kind: "trip", id: trip.id });
        setRenamingId(`trip:${trip.id}`);
      } catch (cause) {
        showToast(describeError(cause), "error");
      }
    },
    [refresh, select, showToast],
  );

  const createFolder = useCallback(
    async (parentId: string | null) => {
      try {
        const folder = await call(
          api().folders.create({ name: "New Folder", parentId }),
        );
        if (parentId !== null) setExpanded(`folder:${parentId}`, true);
        await refresh();
        await select({ kind: "folder", id: folder.id });
        setRenamingId(`folder:${folder.id}`);
      } catch (cause) {
        showToast(describeError(cause), "error");
      }
    },
    [refresh, select, setExpanded, showToast],
  );

  const commitRename = useCallback(
    async (node: TreeNode, name: string) => {
      setRenamingId(null);
      const ref = node.ref;
      if (ref === undefined) return;

      const trimmed = name.trim();
      if (trimmed.length === 0) {
        showToast("A name cannot be empty.", "error");
        return;
      }

      try {
        switch (ref.kind) {
          case "trip":
            await call(api().trips.update({ id: ref.id, name: trimmed }));
            break;
          case "folder":
            await call(api().folders.rename({ id: ref.id, name: trimmed }));
            break;
          case "route":
            await actions.renameRoute(ref.id, trimmed);
            return;
          case "waypoint":
            await actions.updateWaypoint(ref.id, { name: trimmed });
            return;
          default:
            return;
        }
        await refresh();
        await useSelectionStore.getState().reload();
      } catch (cause) {
        showToast(describeError(cause), "error");
      }
    },
    [refresh, showToast],
  );

  const confirmDeleteTripOrFolder = useCallback(
    async (ref: ObjectRef, name: string) => {
      try {
        if (ref.kind === "trip") {
          const trip = await call(api().trips.get({ id: ref.id }));
          openDialog({
            kind: "confirmDelete",
            target: { type: "trip", id: ref.id, name },
            counts: {
              routes: trip.routeCount,
              tracks: trip.trackCount,
              waypoints: trip.waypointCount,
            },
          });
        } else {
          openDialog({
            kind: "confirmDelete",
            target: { type: "folder", id: ref.id, name },
            counts: {},
          });
        }
      } catch (cause) {
        showToast(describeError(cause), "error");
      }
    },
    [openDialog, showToast],
  );

  // ------------------------------------------------------- drag and drop

  const onDragOver =
    (node: TreeNode) =>
    (event: React.DragEvent): void => {
      if (!event.dataTransfer.types.includes(MIME)) return;
      // The payload is unreadable during dragover, so acceptance is checked
      // loosely here and strictly on drop.
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropTargetId(node.id);
    };

  const onDrop =
    (node: TreeNode) =>
    (event: React.DragEvent): void => {
      event.preventDefault();
      setDropTargetId(null);

      const dragged = readDragged(event);
      if (dragged === null || !canAcceptDrop(node, dragged)) return;
      // Dropping something onto itself is a no-op, not an error.
      if (node.ref?.kind === dragged.kind && node.ref.id === dragged.id) return;

      void (async () => {
        try {
          switch (dragged.kind) {
            case "trip": {
              const folderId =
                node.kind === "folder" ? (node.ref?.id ?? null) : null;
              await call(api().trips.move({ id: dragged.id, folderId }));
              if (folderId !== null) setExpanded(`folder:${folderId}`, true);
              break;
            }
            case "folder": {
              const parentId =
                node.kind === "folder" ? (node.ref?.id ?? null) : null;
              await call(api().folders.move({ id: dragged.id, parentId }));
              if (parentId !== null) setExpanded(`folder:${parentId}`, true);
              break;
            }
            case "route": {
              const tripId = node.ref?.id;
              if (tripId === undefined) return;
              await call(api().routes.move({ id: dragged.id, tripId }));
              showToast("Route moved to that trip.");
              break;
            }
            case "waypoint": {
              const tripId = node.ref?.id;
              if (tripId === undefined) return;
              await call(
                api().waypoints.moveToTrip({ id: dragged.id, tripId }),
              );
              showToast("Waypoint moved to that trip.");
              break;
            }
            default:
              return;
          }
          await refresh();
          await useSelectionStore.getState().reload();
        } catch (cause) {
          // A rejected cycle arrives here with the main process's explanation.
          showToast(describeError(cause), "error");
        }
      })();
    };

  // -------------------------------------------------------- context menu

  const menuItems = (node: TreeNode): MenuItem[] => {
    const ref = node.ref;

    if (node.kind === "view" && node.viewId === "trips") {
      return [
        { label: "New Trip", onSelect: () => void createTrip(null) },
        { label: "New Folder", onSelect: () => void createFolder(null) },
      ];
    }

    if (node.kind === "view") {
      return node.available === true
        ? [
            {
              label: `${node.children.length} item${node.children.length === 1 ? "" : "s"}`,
              disabled: true,
            },
          ]
        : [
            {
              label: node.name,
              disabled: true,
              disabledReason: "This view becomes available in a later phase.",
            },
          ];
    }

    if (ref?.kind === "folder") {
      return [
        {
          label: "New Trip in Folder",
          onSelect: () => void createTrip(ref.id),
        },
        { label: "New Subfolder", onSelect: () => void createFolder(ref.id) },
        {
          label: "Rename…",
          separatorBefore: true,
          onSelect: () => setRenamingId(node.id),
        },
        {
          label: "Delete Folder…",
          danger: true,
          separatorBefore: true,
          onSelect: () => void confirmDeleteTripOrFolder(ref, node.name),
        },
      ];
    }

    if (ref?.kind === "trip") {
      const archived = node.status === "archived";
      return [
        { label: "New Route", onSelect: () => actions.startDrawingRoute() },
        {
          label: "New Waypoint",
          onSelect: () => actions.startPlacingWaypoint(),
        },
        {
          label: "Rename…",
          separatorBefore: true,
          onSelect: () => setRenamingId(node.id),
        },
        {
          label: "Duplicate",
          onSelect: () =>
            void (async () => {
              try {
                const copy = await call(api().trips.duplicate({ id: ref.id }));
                await refresh();
                await select({ kind: "trip", id: copy.id });
              } catch (cause) {
                showToast(describeError(cause), "error");
              }
            })(),
        },
        {
          label: archived ? "Unarchive" : "Archive",
          onSelect: () =>
            void (async () => {
              try {
                await call(
                  api().trips.setStatus({
                    id: ref.id,
                    status: archived ? "active" : "archived",
                  }),
                );
                await refresh();
              } catch (cause) {
                showToast(describeError(cause), "error");
              }
            })(),
        },
        {
          label: "Delete Trip…",
          danger: true,
          separatorBefore: true,
          onSelect: () => void confirmDeleteTripOrFolder(ref, node.name),
        },
      ];
    }

    if (ref?.kind === "route") {
      return [
        { label: "Rename…", onSelect: () => setRenamingId(node.id) },
        {
          label: "Reverse",
          separatorBefore: true,
          onSelect: () => void actions.reverseRoute(ref.id),
        },
        {
          label: "Duplicate",
          onSelect: () => void actions.duplicateRoute(ref.id),
        },
        {
          label: "Delete Route",
          danger: true,
          separatorBefore: true,
          onSelect: () => void actions.deleteRoute(ref.id),
        },
      ];
    }

    if (ref?.kind === "waypoint") {
      return [
        { label: "Rename…", onSelect: () => setRenamingId(node.id) },
        {
          label: "Duplicate",
          separatorBefore: true,
          onSelect: () => void actions.duplicateWaypoint(ref.id),
        },
        {
          label: "Delete Waypoint",
          danger: true,
          separatorBefore: true,
          onSelect: () => void actions.deleteWaypoint(ref.id),
        },
      ];
    }

    return [{ label: "New Trip", onSelect: () => void createTrip(null) }];
  };

  // Native menu actions that act on the library selection.
  useEffect(() => {
    return api().events.onMenuAction((action) => {
      const ref = useSelectionStore.getState().selected;
      const state = useSelectionStore.getState();

      if (action === "trip:new") void createTrip(null);
      else if (action === "folder:new") void createFolder(null);
      else if (action === "trip:rename" && ref !== null) {
        setRenamingId(`${ref.kind}:${ref.id}`);
      } else if (action === "trip:duplicate" && ref?.kind === "trip") {
        void (async () => {
          const copy = await call(api().trips.duplicate({ id: ref.id }));
          await refresh();
          await select({ kind: "trip", id: copy.id });
        })();
      } else if (action === "trip:delete" || action === "selection:delete") {
        if (ref === null) return;
        if (ref.kind === "route") void actions.deleteRoute(ref.id);
        else if (ref.kind === "waypoint") void actions.deleteWaypoint(ref.id);
        else {
          const name = state.trip?.name ?? state.folder?.name ?? "this item";
          void confirmDeleteTripOrFolder(ref, name);
        }
      }
    });
  }, [createTrip, createFolder, confirmDeleteTripOrFolder, refresh, select]);

  // ------------------------------------------------------------- render

  const rows: ReactNode[] = [];

  const renderNode = (node: TreeNode, depth: number): void => {
    const hasChildren = node.children.length > 0;
    const expanded = isExpanded(node.id);
    const nodeKey =
      node.ref === undefined ? null : `${node.ref.kind}:${node.ref.id}`;

    rows.push(
      <TreeRow
        key={node.id}
        node={node}
        depth={depth}
        selected={nodeKey !== null && nodeKey === selectedKey}
        expanded={expanded}
        hasChildren={hasChildren}
        renaming={renamingId === node.id}
        dropTarget={dropTargetId === node.id}
        onToggle={() => toggleExpanded(node.id)}
        onSelect={() => {
          if (node.ref !== undefined) void select(node.ref);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (node.ref !== undefined) void select(node.ref);
          setMenu({ x: event.clientX, y: event.clientY, node });
        }}
        onRenameCommit={(name) => void commitRename(node, name)}
        onRenameCancel={() => setRenamingId(null)}
        {...(node.ref !== undefined && DRAGGABLE.has(node.ref.kind)
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
          placeholder="Search trips and waypoints"
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
            {/* Sorting by distance needs tracks as well as routes, so it
                arrives in Phase 3 rather than being half-right now. */}
          </select>
          <button
            type="button"
            aria-label="Toggle sort direction"
            onClick={() =>
              setSort(sortKey, sortDirection === "asc" ? "desc" : "asc")
            }
            className="rounded border border-[var(--color-border-subtle)] px-1.5 py-0.5 hover:bg-[var(--color-surface-sunken)]"
          >
            {sortDirection === "asc" ? "↑" : "↓"}
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
          if (tree !== null)
            setMenu({ x: event.clientX, y: event.clientY, node: tree });
        }}
      >
        {loading && tree === null && (
          <p className="px-3 py-2 text-[12px] text-[var(--color-text-muted)]">
            Loading…
          </p>
        )}

        {error !== null && (
          <p className="px-3 py-2 text-[12px] text-[var(--color-danger)]">
            {error}
          </p>
        )}

        {searching ? <SearchResults selectedKey={selectedKey} /> : rows}
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

/** Flat search results across trips and waypoints. */
function SearchResults({
  selectedKey,
}: {
  selectedKey: string | null;
}): ReactNode {
  const trips = useLibraryStore((s) => s.searchResults);
  const waypoints = useLibraryStore((s) => s.waypointResults);
  const select = useSelectionStore((s) => s.select);

  const total = (trips?.length ?? 0) + (waypoints?.length ?? 0);

  return (
    <div>
      <p className="px-3 py-1 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
        {total} match{total === 1 ? "" : "es"}
      </p>

      {(trips ?? []).map((trip) => (
        <button
          key={`trip:${trip.id}`}
          type="button"
          onClick={() => void select({ kind: "trip", id: trip.id })}
          className={`block w-full truncate px-3 py-1 text-left text-[13px] ${
            selectedKey === `trip:${trip.id}`
              ? "bg-[var(--color-accent)] text-white"
              : "hover:bg-[var(--color-surface-sunken)]"
          }`}
        >
          🗺️ {trip.name}
        </button>
      ))}

      {(waypoints ?? []).map((waypoint) => (
        <button
          key={`waypoint:${waypoint.id}`}
          type="button"
          onClick={() => void select({ kind: "waypoint", id: waypoint.id })}
          className={`block w-full truncate px-3 py-1 text-left text-[13px] ${
            selectedKey === `waypoint:${waypoint.id}`
              ? "bg-[var(--color-accent)] text-white"
              : "hover:bg-[var(--color-surface-sunken)]"
          }`}
        >
          🔖 {waypoint.name}
          <span className="ml-1.5 text-[11px] text-[var(--color-text-muted)]">
            {waypoint.tripName}
          </span>
        </button>
      ))}
    </div>
  );
}
