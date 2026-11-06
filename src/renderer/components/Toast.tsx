import { useEffect, type ReactNode } from 'react';
import { useUiStore } from '../stores/uiStore';

/** Transient feedback. Errors stay longer, because they need reading. */
export function Toast(): ReactNode {
  const toast = useUiStore((s) => s.toast);
  const dismiss = useUiStore((s) => s.dismissToast);

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(dismiss, toast.tone === 'error' ? 7000 : 3500);
    return () => clearTimeout(timer);
  }, [toast, dismiss]);

  if (toast === null) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-auto fixed bottom-6 left-1/2 z-50 max-w-[560px] -translate-x-1/2 rounded-lg px-4 py-2.5 text-[13px] shadow-xl ${
        toast.tone === 'error'
          ? 'bg-[var(--color-danger)] text-white'
          : 'bg-[var(--color-text-primary)] text-[var(--color-surface)]'
      }`}
    >
      <div className="flex items-center gap-3">
        <span>{toast.message}</span>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 opacity-70 hover:opacity-100"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
