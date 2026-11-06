import { useCallback, useEffect, useRef, type ReactNode } from 'react';

interface Props {
  /** 'left' grows the pane as the divider moves right; 'right' is inverted. */
  side: 'left' | 'right';
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
  label: string;
  children: ReactNode;
}

/**
 * A fixed-width pane with a draggable divider.
 *
 * The drag is tracked on `window` rather than the divider so the pointer can
 * leave the 5px handle mid-drag without the resize stopping, which is the usual
 * failure of a naive implementation. Keyboard resizing is supported because a
 * 5px target is not reasonably clickable for everyone.
 */
export function SplitPane({
  side,
  width,
  min,
  max,
  onResize,
  label,
  children,
}: Props): ReactNode {
  const paneRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      dragging.current = true;

      const startX = event.clientX;
      const startWidth = width;

      const onMove = (move: PointerEvent): void => {
        if (!dragging.current) return;
        const delta =
          side === 'left' ? move.clientX - startX : startX - move.clientX;
        onResize(Math.min(max, Math.max(min, startWidth + delta)));
      };

      const onUp = (): void => {
        dragging.current = false;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        document.body.style.cursor = '';
      };

      document.body.style.cursor = 'col-resize';
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [side, width, min, max, onResize],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const step = event.shiftKey ? 40 : 8;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        onResize(
          Math.max(min, Math.min(max, width + (side === 'left' ? -step : step))),
        );
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        onResize(
          Math.max(min, Math.min(max, width + (side === 'left' ? step : -step))),
        );
      }
    },
    [side, width, min, max, onResize],
  );

  // A pointer-up that lands outside the window would otherwise leave the drag
  // latched on.
  useEffect(() => {
    const cancel = (): void => {
      dragging.current = false;
      document.body.style.cursor = '';
    };
    window.addEventListener('blur', cancel);
    return () => window.removeEventListener('blur', cancel);
  }, []);

  const divider = (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label}`}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className="w-[5px] shrink-0 cursor-col-resize bg-[var(--color-border-subtle)] transition-colors hover:bg-[var(--color-accent)] focus-visible:bg-[var(--color-accent)] focus-visible:outline-none"
    />
  );

  return (
    <>
      {side === 'right' && divider}
      <div
        ref={paneRef}
        style={{ width }}
        className="flex shrink-0 flex-col overflow-hidden bg-[var(--color-surface-raised)]"
      >
        {children}
      </div>
      {side === 'left' && divider}
    </>
  );
}
