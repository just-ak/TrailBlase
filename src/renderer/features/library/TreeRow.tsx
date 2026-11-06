import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { TreeNode } from '@shared/domain/types';

interface Props {
  node: TreeNode;
  depth: number;
  selected: boolean;
  expanded: boolean;
  hasChildren: boolean;
  renaming: boolean;
  dropTarget: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onRenameCommit: (name: string) => void;
  onRenameCancel: () => void;
  onDragStart?: (event: React.DragEvent) => void;
  onDragOver?: (event: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (event: React.DragEvent) => void;
}

const INDENT = 14;

function Chevron({ open }: { open: boolean }): ReactNode {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
      className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
    >
      <path d="M3 1.5 L7 5 L3 8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function Icon({ node }: { node: TreeNode }): ReactNode {
  if (node.kind === 'folder') return <span aria-hidden="true">📁</span>;
  if (node.kind === 'trip') return <span aria-hidden="true">🗺️</span>;
  if (node.kind === 'root') return <span aria-hidden="true">📚</span>;
  return <span aria-hidden="true">🔖</span>;
}

export function TreeRow({
  node,
  depth,
  selected,
  expanded,
  hasChildren,
  renaming,
  dropTarget,
  onToggle,
  onSelect,
  onContextMenu,
  onRenameCommit,
  onRenameCancel,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: Props): ReactNode {
  const [draft, setDraft] = useState(node.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!renaming) return;
    setDraft(node.name);
    // Select the whole name so typing replaces it, as Finder does.
    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => clearTimeout(timer);
  }, [renaming, node.name]);

  const unavailable = node.kind === 'view' && node.available === false;
  const archived = node.status === 'archived';

  return (
    <div
      role="treeitem"
      aria-selected={selected}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-level={depth + 1}
      draggable={onDragStart !== undefined && !renaming}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
      onClick={(event) => {
        event.stopPropagation();
        if (!unavailable) onSelect();
      }}
      onDoubleClick={() => {
        if (hasChildren) onToggle();
      }}
      style={{ paddingLeft: depth * INDENT + 6 }}
      className={`group flex h-[26px] cursor-default items-center gap-1.5 pr-2 text-[13px] ${
        selected
          ? 'bg-[var(--color-accent)] text-white'
          : dropTarget
            ? 'bg-[var(--color-accent)]/20'
            : 'hover:bg-[var(--color-surface-sunken)]'
      } ${unavailable ? 'opacity-55' : ''}`}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={expanded ? 'Collapse' : 'Expand'}
        onClick={(event) => {
          event.stopPropagation();
          if (hasChildren) onToggle();
        }}
        className={`flex h-4 w-4 shrink-0 items-center justify-center ${
          hasChildren ? 'opacity-70 hover:opacity-100' : 'invisible'
        }`}
      >
        <Chevron open={expanded} />
      </button>

      <span className="shrink-0 text-[12px]">
        <Icon node={node} />
      </span>

      {renaming ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => onRenameCommit(draft)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onRenameCommit(draft);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onRenameCancel();
            }
          }}
          onClick={(event) => event.stopPropagation()}
          className="min-w-0 flex-1 rounded border border-[var(--color-accent)] bg-[var(--color-surface)] px-1 py-0 text-[13px] text-[var(--color-text-primary)] outline-none"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">
          {node.name}
          {archived && (
            <span
              className={`ml-1.5 text-[11px] ${selected ? 'text-white/70' : 'text-[var(--color-text-muted)]'}`}
            >
              archived
            </span>
          )}
          {unavailable && (
            <span
              className={`ml-1.5 text-[11px] ${selected ? 'text-white/70' : 'text-[var(--color-text-muted)]'}`}
            >
              later phase
            </span>
          )}
        </span>
      )}
    </div>
  );
}
