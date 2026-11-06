import type { ReactNode } from 'react';

/** Shared form primitives for the properties panels. */

export const INPUT_CLASS =
  'w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]';

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="mb-3">
      <p className="mb-1 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
        {label}
      </p>
      {children}
    </div>
  );
}

export function ReadOnly({ value }: { value: string }): ReactNode {
  return <p className="text-[13px] text-[var(--color-text-primary)]">{value}</p>;
}
