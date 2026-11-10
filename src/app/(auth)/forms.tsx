'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import { initialActionState } from '@/lib/actions';
import { Field, FormMessage, Input } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { requestPasswordReset, signIn, signUp, updatePassword } from './actions';

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(signIn, initialActionState);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <Field label="Email" htmlFor="email" error={fe.email}><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
      <Field label="Password" htmlFor="password" error={fe.password}><Input id="password" name="password" type="password" autoComplete="current-password" required /></Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="Logging in…">Log in</SubmitButton>
      <Link href="/forgot-password" className="text-center text-sm font-semibold text-accent-strong">Forgot your password?</Link>
    </form>
  );
}

export function SignupForm({ next }: { next: string }) {
  const [state, action] = useActionState(signUp, initialActionState);
  const fe = state.fieldErrors ?? {};
  if (state.ok) return <FormMessage state={state} />;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <Field label="Your name" htmlFor="full_name" error={fe.full_name}><Input id="full_name" name="full_name" autoComplete="name" required /></Field>
      <Field label="Work email" htmlFor="email" error={fe.email}><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
      <Field label="Password" htmlFor="password" hint="At least 10 characters." error={fe.password}><Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required /></Field>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="terms" className="mt-0.5 size-4 accent-[#3f63de]" required />
        <span>I agree to the <Link href="/legal/terms" className="font-semibold underline">terms of service</Link> and <Link href="/legal/billing" className="font-semibold underline">subscription terms</Link>.</span>
      </label>
      {fe.terms && <p className="text-sm text-late">{fe.terms}</p>}
      <FormMessage state={state} />
      <SubmitButton pendingText="Creating account…">Create account</SubmitButton>
    </form>
  );
}

export function ForgotForm() {
  const [state, action] = useActionState(requestPasswordReset, initialActionState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="Sending…">Send reset link</SubmitButton>
    </form>
  );
}

export function ResetForm() {
  const [state, action] = useActionState(updatePassword, initialActionState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="New password" htmlFor="password" hint="At least 10 characters."><Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required /></Field>
      <Field label="Confirm new password" htmlFor="confirm"><Input id="confirm" name="confirm" type="password" autoComplete="new-password" required /></Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="Saving…">Save password</SubmitButton>
    </form>
  );
}
