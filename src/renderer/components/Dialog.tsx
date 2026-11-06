import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

/**
 * Modal dialog.
 *
 * Uses the native `<dialog>` element so focus trapping, Escape handling and
 * the top layer come from the platform rather than being reimplemented, which
 * is also what makes it reachable by keyboard without extra work.
 */
export function Dialog({
  title,
  onClose,
  children,
  footer,
  width = 440,
}: Props): ReactNode {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    if (!node.open) node.showModal();

    const onCancel = (event: Event): void => {
      // Escape fires `cancel`; route it through our own close so state stays
      // consistent rather than the element closing itself.
      event.preventDefault();
      onClose();
    };
    node.addEventListener("cancel", onCancel);

    return () => {
      node.removeEventListener("cancel", onCancel);
      // `close()` on unmount, not just removal from the DOM.
      //
      // `showModal()` puts the element in the top layer and makes the rest of
      // the document inert. React removing the node does not necessarily take
      // it back out, which leaves the page swallowing every subsequent click —
      // the app looks frozen after a dialog has been used once. Closing it
      // explicitly is the documented lifecycle for `<dialog>`.
      if (node.open) node.close();
    };
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      className="m-auto rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-0 text-[var(--color-text-primary)] shadow-2xl backdrop:bg-black/40"
      style={{ width }}
    >
      <div className="border-b border-[var(--color-border-subtle)] px-5 py-3">
        <h2 id="dialog-title" className="text-[15px] font-semibold">
          {title}
        </h2>
      </div>
      <div className="max-h-[60vh] overflow-y-auto px-5 py-4">{children}</div>
      {footer !== undefined && (
        <div className="flex justify-end gap-2 border-t border-[var(--color-border-subtle)] px-5 py-3">
          {footer}
        </div>
      )}
    </dialog>
  );
}
