'use client';
import { useActionState, type ReactNode } from 'react';
import { initialActionState, type ActionState } from '@/lib/actions';
import { FormMessage } from './ui';

/** Form bound to a Server Action, showing its success/error message inline. */
export function ActionForm({ action, children, className, render, quiet }: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  /** Client components only: a function can't be passed from a server component (#175). */
  render?: (state: ActionState) => ReactNode;
  /** Show nothing but errors (no success line). Safe from server components. */
  quiet?: boolean;
}) {
  const [state, run] = useActionState(action, initialActionState);
  return (
    <form action={run} className={className}>
      {children}
      {render ? render(state) : quiet ? (!state.ok && state.message ? <FormMessage state={state} /> : null) : <FormMessage state={state} />}
    </form>
  );
}
