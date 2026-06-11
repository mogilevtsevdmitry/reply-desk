'use client';

import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { useId } from 'react';

/** Обёртка поля: метка, контрол, подсказка и ошибка под полем. */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-13 font-medium text-ink-muted">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="mt-1 text-13 text-ink-faint">{hint}</p> : null}
      {error ? (
        <p role="alert" className="mt-1 text-13 text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const controlBase =
  'w-full rounded-md border bg-bg px-3.5 font-text text-16 text-ink ' +
  'placeholder:text-ink-faint transition-colors duration-[120ms] hover:border-ink-faint';

function controlClasses(error?: string | null): string {
  return `${controlBase} ${error ? 'border-danger' : 'border-line-strong'}`;
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string | null;
}

export function Input({ error, className = '', ...rest }: InputProps) {
  return (
    <input
      className={`rd-input py-[11px] ${controlClasses(error)} ${className}`}
      aria-invalid={error ? true : undefined}
      {...rest}
    />
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string | null;
}

export function Textarea({ error, className = '', ...rest }: TextareaProps) {
  return (
    <textarea
      className={`rd-textarea min-h-[110px] resize-y py-3 leading-base ${controlClasses(error)} ${className}`}
      aria-invalid={error ? true : undefined}
      {...rest}
    />
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: string | null;
}

export function Select({ error, className = '', children, ...rest }: SelectProps) {
  return (
    <select className={`rd-select py-[11px] ${controlClasses(error)} ${className}`} {...rest}>
      {children}
    </select>
  );
}

/** Textarea со счётчиком символов «{n} / {max}». */
export function CountedTextarea({
  label,
  max,
  value,
  error,
  hint,
  ...rest
}: TextareaProps & { label: string; max: number; value: string; hint?: string }) {
  const id = useId();
  return (
    <div className="mb-4 flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-13 font-medium text-ink-muted">
          {label}
        </label>
        <span
          className={`text-12 ${value.length > max ? 'text-danger' : 'text-ink-faint'}`}
          aria-hidden="true"
        >
          {value.length} / {max}
        </span>
      </div>
      <Textarea id={id} value={value} error={error} {...rest} />
      {hint && !error ? <p className="mt-1 text-13 text-ink-faint">{hint}</p> : null}
      {error ? (
        <p role="alert" className="mt-1 text-13 text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
