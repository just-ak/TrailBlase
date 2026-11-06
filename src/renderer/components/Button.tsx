import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'default' | 'primary' | 'danger' | 'ghost';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  default:
    'bg-[var(--color-surface-raised)] border-[var(--color-border-subtle)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-sunken)]',
  primary:
    'bg-[var(--color-accent)] border-transparent text-white hover:brightness-110',
  danger:
    'bg-[var(--color-danger)] border-transparent text-white hover:brightness-110',
  ghost:
    'bg-transparent border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-sunken)]',
};

export function Button({
  variant = 'default',
  children,
  className = '',
  ...rest
}: Props): ReactNode {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
