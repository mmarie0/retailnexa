import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { cloneElement, isValidElement } from 'react';

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const variants: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent border-accent shadow-[0_6px_16px_rgba(91,127,245,.32)] hover:bg-accent-strong hover:border-accent-strong',
  secondary: 'bg-card text-ink border-line hover:border-accent',
  ghost: 'bg-transparent text-accent-strong border-transparent hover:bg-accent-soft',
  danger: 'bg-card text-late border-late-soft hover:bg-late-soft',
};
export const buttonClass = (variant: Variant = 'primary', size: 'sm' | 'md' | 'lg' = 'md') =>
  cx(
    'inline-flex items-center justify-center gap-1.5 rounded-xl border font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
    size === 'sm' && 'px-3 py-1.5 text-[13.5px]',
    size === 'md' && 'px-3.5 py-[9px] text-[14px]',
    size === 'lg' && 'px-6 py-3.5 text-base',
    variants[variant],
  );

export function Button({ variant = 'primary', size = 'md', className, ...rest }: ComponentProps<'button'> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  return <button className={cx(buttonClass(variant, size), className)} {...rest} />;
}

export function LinkButton({ variant = 'primary', size = 'md', className, ...rest }: ComponentProps<typeof Link> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  return <Link className={cx(buttonClass(variant, size), className)} {...rest} />;
}

export function Card({ className, ...rest }: ComponentProps<'div'>) {
  return <div className={cx('rounded-[18px] bg-card p-4 shadow-[var(--shadow-card)]', className)} {...rest} />;
}

export function Field({ label, htmlFor, hint, error, children }: { label: string; htmlFor: string; hint?: string; error?: string; children: ReactNode }) {
  // Wire the message to the control for screen readers (#26).
  const describedBy = error ? `${htmlFor}-error` : hint ? `${htmlFor}-hint` : undefined;
  const control = isValidElement<Record<string, unknown>>(children) && describedBy
    ? cloneElement(children, { 'aria-describedby': describedBy, ...(error ? { 'aria-invalid': true } : {}) })
    : children;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-muted">{label}</label>
      {control}
      {hint && !error && <p id={`${htmlFor}-hint`} className="text-sm text-muted">{hint}</p>}
      {error && <p id={`${htmlFor}-error`} className="text-sm text-late" role="alert">{error}</p>}
    </div>
  );
}

const inputBase = 'rounded-xl border border-transparent bg-soft px-[11px] py-2.5 text-base text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:opacity-60';
/** Full width unless the caller sets its own width (w-*, flex-1, max-w-*). */
const widthDefault = (className?: string) => (/(^|\s)(w-|flex-1)/.test(className ?? '') ? null : 'w-full');

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return <input className={cx(inputBase, widthDefault(className), className)} {...rest} />;
}
export function Select({ className, ...rest }: ComponentProps<'select'>) {
  return <select className={cx(inputBase, 'pr-8', widthDefault(className), className)} {...rest} />;
}
export function Textarea({ className, ...rest }: ComponentProps<'textarea'>) {
  return <textarea className={cx(inputBase, 'min-h-28', widthDefault(className), className)} {...rest} />;
}

type Tone = 'neutral' | 'info' | 'good' | 'warning' | 'danger';
const tones: Record<Tone, string> = {
  neutral: 'bg-soft text-ink',
  info: 'bg-accent-soft text-indigo',
  good: 'bg-paid-soft text-paid',
  warning: 'bg-soon-soft text-soon',
  danger: 'bg-late-soft text-late',
};
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold', tones[tone])}>{children}</span>;
}

export function Notice({ tone = 'info', children, action }: { tone?: Exclude<Tone, 'neutral'>; children: ReactNode; action?: ReactNode }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('flex flex-wrap items-center justify-between gap-3 rounded-2xl px-3.5 py-2.5 text-[14px] font-medium', tones[tone])}>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[24px] font-extrabold leading-tight tracking-[-.02em]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13.5px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-[18px] bg-card px-4 py-[22px] text-center text-muted shadow-[var(--shadow-card)]">
      <p className="text-[17px] font-bold text-ink">{title}</p>
      {children && <div className="mx-auto max-w-md">{children}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function FormMessage({ state }: { state: { ok: boolean; message: string | null } }) {
  if (!state.message) return null;
  return (
    <p role={state.ok ? 'status' : 'alert'} className={cx('rounded-xl px-3 py-2 text-sm font-medium', state.ok ? 'bg-paid-soft text-paid' : 'bg-late-soft text-late')}>
      {state.message}
    </p>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2 text-[21px] font-extrabold tracking-tight', className)}>
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
        <rect width="26" height="26" rx="8" fill="#38357F" />
        <rect x="6" y="13" width="3.5" height="7" rx="1.5" fill="#9EA2E6" />
        <rect x="11.25" y="9" width="3.5" height="11" rx="1.5" fill="#7E99FA" />
        <rect x="16.5" y="5.5" width="3.5" height="14.5" rx="1.5" fill="#FF9B91" />
      </svg>
      RetailNexa
    </span>
  );
}

/** Bold gradient block for headline numbers, as in the RetailNexa app. */
export function Block({ tone = 'blue', className, ...rest }: ComponentProps<'div'> & { tone?: 'blue' | 'indigo' | 'lav' | 'coral' | 'sunset' }) {
  return <div className={cx('blk', tone, 'rounded-[18px] p-4', className)} {...rest} />;
}

/** Small uppercase label used above numbers and sections. */
export function Eyebrow({ className, ...rest }: ComponentProps<'span'>) {
  return <span className={cx('text-[11px] font-semibold uppercase tracking-[.08em] text-muted', className)} {...rest} />;
}
