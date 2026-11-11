'use client';
import { useActionState, type ReactNode } from 'react';
import { initialActionState } from '@/lib/actions';
import { cx } from '@/components/ui';
import { editOverview } from './actions';

/** One customize step as its own tiny form, so it works before JavaScript loads too. */
export function StepButton({ op, id, label, disabled, wide, children }: { op: string; id: string; label: string; disabled?: boolean; wide?: boolean; children: ReactNode }) {
  const [state, run, pending] = useActionState(editOverview, initialActionState);
  return (
    <form action={run} className="contents">
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="id" value={id} />
      <button type="submit" aria-label={label} title={label} disabled={disabled || pending}
        className={cx('rounded-full bg-soft text-sm font-semibold hover:bg-line disabled:opacity-35', wide ? 'px-3.5 py-1.5' : 'grid size-9 place-items-center')}>
        {children}
      </button>
      {!state.ok && state.message && <span role="alert" className="text-sm text-late">{state.message}</span>}
    </form>
  );
}
