'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';

const base =
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border border-transparent ' +
  'font-text text-14 font-medium leading-none transition-colors duration-[120ms] ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

/** Primary зарезервирована за AI-действиями (старт генерации) и главными CTA. */
const variants: Record<Variant, string> = {
  primary: 'bg-accent text-ink-on-accent hover:bg-accent-hover active:bg-accent-down',
  secondary: 'border-line-strong bg-transparent text-ink hover:bg-surface-2',
  ghost: 'bg-transparent text-ink-muted hover:bg-surface-2 hover:text-ink',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

export function Button({ variant = 'secondary', className = '', children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`${base} ${variants[variant]} px-5 py-[13px] ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
