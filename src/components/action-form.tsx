'use client';
import { useActionState, type ReactNode } from 'react';
import { initialActionState, type ActionState } from '@/lib/actions';
import { FormMessage } from './ui';

/** Form bound to a Server Action, showing its success/error message inline. */
export function ActionForm({ action, children, className, render }: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  render?: (state: ActionState) => ReactNode;
}) {
  const [state, run] = useActionState(action, initialActionState);
  return (
    <form action={run} className={className}>
      {children}
      {render ? render(state) : <FormMessage state={state} />}
    </form>
  );
}
