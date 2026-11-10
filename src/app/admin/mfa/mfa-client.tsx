'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabase } from '@/lib/supabase/browser';
import { Button, Field, Input, Notice } from '@/components/ui';

type Stage =
  | { kind: 'loading' }
  | { kind: 'enroll'; factorId: string; qr: string; secret: string }
  | { kind: 'verify'; factorId: string }
  | { kind: 'enrolled'; justNow?: boolean }
  | { kind: 'verified' }
  | { kind: 'error'; message: string };

/**
 * TOTP two-factor (Supabase Auth MFA).
 *  mode "enroll": account security page — set up an authenticator if none is verified.
 *  mode "verify": admin step-up — only verifies an existing factor (no first-time enrolment
 *  here, so a leaked password alone can never create a platform admin's first factor).
 */
export function MfaClient({ mode, returnTo }: { mode: 'enroll' | 'verify'; returnTo: string }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = createBrowserSupabase();
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) return setStage({ kind: 'error', message: 'Could not load your security settings. Sign in again.' });
      const verified = data.totp.find((f) => f.status === 'verified');
      if (mode === 'enroll' && verified) return setStage({ kind: 'enrolled' });
      if (verified) return setStage({ kind: 'verify', factorId: verified.id });
      if (mode === 'verify') return setStage({ kind: 'error', message: 'No authenticator is set up for this account. Set one up at /account/security, then ask a superadmin to grant access.' });
      const enrolled = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `RetailNexa admin ${new Date().toISOString().slice(0, 10)}` });
      if (enrolled.error) return setStage({ kind: 'error', message: 'Could not start two-factor setup.' });
      setStage({ kind: 'enroll', factorId: enrolled.data.id, qr: enrolled.data.totp.qr_code, secret: enrolled.data.totp.secret });
    })();
  }, [mode]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (stage.kind !== 'enroll' && stage.kind !== 'verify') return;
    setBusy(true);
    setError(null);
    const supabase = createBrowserSupabase();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: stage.factorId, code: code.replace(/\s/g, '') });
    if (error) {
      setBusy(false);
      return setError('That code didn’t work. Codes change every 30 seconds — try the current one.');
    }
    // Leave the form so a second submit can't start another challenge (#70).
    setStage(stage.kind === 'enroll' ? { kind: 'enrolled', justNow: true } : { kind: 'verified' });
    setBusy(false);
    router.replace(returnTo);
    router.refresh();
  }

  if (stage.kind === 'loading') return <p className="text-muted">Loading…</p>;
  if (stage.kind === 'enrolled') {
    return <Notice tone="good">{stage.justNow ? 'Done. ' : ''}Two-factor authentication is on for this account.{stage.justNow ? ' You’ll be asked for a code from your authenticator app when you open admin pages.' : ''}</Notice>;
  }
  if (stage.kind === 'verified') return <Notice tone="good">Verified. Opening…</Notice>;
  if (stage.kind === 'error') return <Notice tone="danger">{stage.message}</Notice>;
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {stage.kind === 'enroll' && (
        <>
          <p>Scan this code with an authenticator app (1Password, Google Authenticator, Authy), then enter the 6-digit code it shows.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={stage.qr} alt="Two-factor setup QR code" className="size-48 self-center rounded-xl bg-white p-2" />
          <p className="break-all text-sm text-muted">Can’t scan? Enter this key: <code className="text-ink">{stage.secret}</code></p>
        </>
      )}
      {stage.kind === 'verify' && <p>Enter the 6-digit code from your authenticator app.</p>}
      <Field label="Code" htmlFor="code" error={error ?? undefined}>
        <Input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
      </Field>
      <Button type="submit" disabled={busy}>{busy ? 'Checking…' : 'Verify'}</Button>
    </form>
  );
}
