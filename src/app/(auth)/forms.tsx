'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import { initialActionState } from '@/lib/actions';
import { Field, FormMessage, Input } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { requestPasswordReset, signIn, signUp, updatePassword } from './actions';
import { useT } from '@/lib/i18n/client';

export function LoginForm({ next }: { next: string }) {
  const t = useT();
  const [state, action] = useActionState(signIn, initialActionState);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <Field label={t('Email')} htmlFor="email" error={fe.email}><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
      <Field label={t('Password')} htmlFor="password" error={fe.password}><Input id="password" name="password" type="password" autoComplete="current-password" required /></Field>
      <FormMessage state={state} />
      <SubmitButton pendingText={t('Logging in…')}>{t('Log in')}</SubmitButton>
      <Link href="/forgot-password" className="text-center text-sm font-semibold text-accent-strong">{t('Forgot your password?')}</Link>
    </form>
  );
}

export function SignupForm({ next }: { next: string }) {
  const t = useT();
  const [state, action] = useActionState(signUp, initialActionState);
  const fe = state.fieldErrors ?? {};
  if (state.ok) return <FormMessage state={state} />;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <Field label={t('Your name')} htmlFor="full_name" error={fe.full_name}><Input id="full_name" name="full_name" autoComplete="name" required /></Field>
      <Field label={t('Work email')} htmlFor="email" error={fe.email}><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
      <Field label={t('Password')} htmlFor="password" hint={t('At least 10 characters.')} error={fe.password}><Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required /></Field>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="terms" className="mt-0.5 size-4 accent-[#3f63de]" required />
        <span>{t('I agree to the')} <Link href="/legal/terms" className="font-semibold underline">{t('terms of service')}</Link> {t('and')} <Link href="/legal/billing" className="font-semibold underline">{t('subscription terms')}</Link>.</span>
      </label>
      {fe.terms && <p className="text-sm text-late">{fe.terms}</p>}
      <FormMessage state={state} />
      <SubmitButton pendingText={t('Creating account…')}>{t('Create account')}</SubmitButton>
    </form>
  );
}

export function ForgotForm() {
  const t = useT();
  const [state, action] = useActionState(requestPasswordReset, initialActionState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label={t('Email')} htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
      <FormMessage state={state} />
      <SubmitButton pendingText={t('Sending…')}>{t('Send reset link')}</SubmitButton>
    </form>
  );
}

export function ResetForm() {
  const t = useT();
  const [state, action] = useActionState(updatePassword, initialActionState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label={t('New password')} htmlFor="password" hint={t('At least 10 characters.')}><Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required /></Field>
      <Field label={t('Confirm new password')} htmlFor="confirm"><Input id="confirm" name="confirm" type="password" autoComplete="new-password" required /></Field>
      <FormMessage state={state} />
      <SubmitButton pendingText={t('Saving…')}>{t('Save password')}</SubmitButton>
    </form>
  );
}
