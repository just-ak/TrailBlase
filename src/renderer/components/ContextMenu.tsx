import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface MenuItem {
  label: string;
  onSelect?: () => void;
  /** Disabled items carry a reason, so the UI explains rather than just greys out. */
  disabled?: boolean;
  disabledReason?: string;
  danger?: boolean;
  separatorBefore?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

/**
 * Right-click menu.
 *
 * Only contextually valid actions are passed in by the caller; this component
 * renders them and keeps itself inside the viewport, since a menu opened near
 * the bottom edge would otherwise be clipped.
 */
export function ContextMenu({ x, y, items, onClose }: Props): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null) return;
    const rect = node.getBoundingClientRect();
    const left = x + rect.width > window.innerWidth ? x - rect.width : x;
    const top = y + rect.height > window.innerHeight ? y - rect.height : y;
    setPos({ left: Math.max(4, left), top: Math.max(4, top) });
  }, [x, y]);

  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (ref.current?.contains(event.target as Node) !== true) onClose();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    // `capture` so the dismissal wins over any handler underneath.
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-50 min-w-[200px] rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] py-1 shadow-xl"
    >
      {items.map((item, index) => (
        <div key={`${item.label}-${index}`}>
          {item.separatorBefore === true && (
            <div className="my-1 h-px bg-[var(--color-border-subtle)]" />
          )}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled === true}
            title={item.disabled === true ? item.disabledReason : undefined}
            onClick={() => {
              if (item.disabled === true) return;
              item.onSelect?.();
              onClose();
            }}
            className={`block w-full px-3 py-1.5 text-left text-[13px] disabled:cursor-default disabled:opacity-40 ${
              item.danger === true
                ? 'text-[var(--color-danger)] enabled:hover:bg-[var(--color-danger)] enabled:hover:text-white'
                : 'text-[var(--color-text-primary)] enabled:hover:bg-[var(--color-accent)] enabled:hover:text-white'
            }`}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>
  );
}
