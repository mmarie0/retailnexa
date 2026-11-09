import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const variants: Record<Variant, string> = {
  primary: 'bg-accent-strong text-white border-accent-strong hover:bg-indigo-2 hover:border-indigo-2',
  secondary: 'bg-card text-ink border-line hover:border-accent',
  ghost: 'bg-transparent text-accent-strong border-transparent hover:bg-accent-soft',
  danger: 'bg-card text-late border-late-soft hover:bg-late-soft',
};
export const buttonClass = (variant: Variant = 'primary', size: 'sm' | 'md' | 'lg' = 'md') =>
  cx(
    'inline-flex items-center justify-center gap-2 rounded-[10px] border font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
    size === 'sm' && 'px-3 py-1.5 text-sm',
    size === 'md' && 'px-4 py-2.5 text-[15px]',
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
  return <div className={cx('rounded-[var(--radius-card)] border border-line bg-card p-5', className)} {...rest} />;
}

export function Field({ label, htmlFor, hint, error, children }: { label: string; htmlFor: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-semibold">{label}</label>
      {children}
      {hint && !error && <p className="text-sm text-muted">{hint}</p>}
      {error && <p className="text-sm text-late" role="alert">{error}</p>}
    </div>
  );
}

const inputBase = 'rounded-[10px] border border-line bg-card px-3 py-2.5 text-[15px] text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:bg-soft';
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
  return <span className={cx('inline-flex items-center rounded-full px-2.5 py-0.5 text-[13px] font-semibold', tones[tone])}>{children}</span>;
}

export function Notice({ tone = 'info', children, action }: { tone?: Exclude<Tone, 'neutral'>; children: ReactNode; action?: ReactNode }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 text-[15px] font-medium', tones[tone])}>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[26px] font-bold leading-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-card/60 px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function FormMessage({ state }: { state: { ok: boolean; message: string | null } }) {
  if (!state.message) return null;
  return (
    <p role={state.ok ? 'status' : 'alert'} className={cx('rounded-lg px-3 py-2 text-sm font-medium', state.ok ? 'bg-paid-soft text-paid' : 'bg-late-soft text-late')}>
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
