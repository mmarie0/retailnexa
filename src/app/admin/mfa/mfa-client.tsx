'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabase } from '@/lib/supabase/browser';
import { Button, Field, Input, Notice } from '@/components/ui';

type Stage =
  | { kind: 'loading' }
  | { kind: 'enroll'; factorId: string; qr: string; secret: string }
  | { kind: 'verify'; factorId: string }
  | { kind: 'enrolled'; factorId: string; justNow?: boolean }
  | { kind: 'disable'; factorId: string }
  | { kind: 'disabled' }
  | { kind: 'verified' }
  | { kind: 'error'; message: string };

/** Unique per attempt: Supabase rejects a second factor with the same friendly name (#74). */
export function factorName(now = new Date()) {
  return `RetailNexa ${now.toISOString().slice(0, 16).replace('T', ' ')}`;
}

/**
 * TOTP two-factor (Supabase Auth MFA).
 *  mode "enroll": account security page. Set up an authenticator if none is verified,
 *  or turn the existing one off (after entering a current code).
 *  mode "verify": admin step-up. Only verifies an existing factor (no first-time enrolment
 *  here, so a leaked password alone can never create a platform admin's first factor).
 */
export function MfaClient({ mode, returnTo }: { mode: 'enroll' | 'verify'; returnTo: string }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const supabase = createBrowserSupabase();
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) return setStage({ kind: 'error', message: 'Could not load your security settings. Sign in again.' });
      const verified = data.totp.find((f) => f.status === 'verified');
      if (mode === 'enroll' && verified) return setStage({ kind: 'enrolled', factorId: verified.id });
      if (verified) return setStage({ kind: 'verify', factorId: verified.id });
      if (mode === 'verify') return setStage({ kind: 'error', message: 'No authenticator is set up for this account. Set one up at /account/security, then ask a superadmin to grant access.' });
      // A setup that was started and left unfinished can't be resumed (its QR code is only
      // shown once), so remove it and start fresh (#74).
      for (const f of data.all.filter((x) => x.factor_type === 'totp' && x.status === 'unverified')) {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const enrolled = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: factorName() });
      if (enrolled.error) return setStage({ kind: 'error', message: `Could not start two-factor setup: ${enrolled.error.message}. Reload the page to try again.` });
      setStage({ kind: 'enroll', factorId: enrolled.data.id, qr: enrolled.data.totp.qr_code, secret: enrolled.data.totp.secret });
    })();
  }, [mode, attempt]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (stage.kind !== 'enroll' && stage.kind !== 'verify' && stage.kind !== 'disable') return;
    setBusy(true);
    setError(null);
    const supabase = createBrowserSupabase();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: stage.factorId, code: code.replace(/\s/g, '') });
    if (error) {
      setBusy(false);
      return setError('That code didn’t work. Codes change every 30 seconds — try the current one.');
    }
    if (stage.kind === 'disable') {
      // The verified code raised this session to aal2, which Supabase requires to remove a verified factor.
      const off = await supabase.auth.mfa.unenroll({ factorId: stage.factorId });
      setBusy(false);
      if (off.error) return setError(`Could not turn two-factor off: ${off.error.message}`);
      setCode('');
      setStage({ kind: 'disabled' });
      router.refresh();
      return;
    }
    // Leave the form so a second submit can't start another challenge (#70).
    setStage(stage.kind === 'enroll' ? { kind: 'enrolled', factorId: stage.factorId, justNow: true } : { kind: 'verified' });
    setBusy(false);
    setCode('');
    router.replace(returnTo);
    router.refresh();
  }

  if (stage.kind === 'loading') return <p className="text-muted">Loading…</p>;
  if (stage.kind === 'enrolled') {
    return (
      <div className="flex flex-col gap-3">
        <Notice tone="good">{stage.justNow ? 'Done. ' : ''}Two-factor authentication is on for this account.{stage.justNow ? ' You’ll be asked for a code from your authenticator app when you open admin pages.' : ''}</Notice>
        {mode === 'enroll' && (
          <Button type="button" variant="secondary" className="self-start" onClick={() => { setError(null); setStage({ kind: 'disable', factorId: stage.factorId }); }}>
            Turn off two-factor
          </Button>
        )}
      </div>
    );
  }
  if (stage.kind === 'disabled') {
    return (
      <div className="flex flex-col gap-3">
        <Notice tone="warning">Two-factor authentication is off. A password alone now opens this account, and admin pages stay locked until you set it up again.</Notice>
        <Button type="button" className="self-start" onClick={() => { setStage({ kind: 'loading' }); setAttempt((n) => n + 1); }}>Set up two-factor again</Button>
      </div>
    );
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
      {stage.kind === 'disable' && <p>To turn two-factor off, enter the current 6-digit code from your authenticator app. Admin pages will stay locked until you set it up again.</p>}
      <Field label="Code" htmlFor="code" error={error ?? undefined}>
        <Input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant={stage.kind === 'disable' ? 'danger' : 'primary'} disabled={busy}>{busy ? 'Checking…' : stage.kind === 'disable' ? 'Turn off two-factor' : 'Verify'}</Button>
        {stage.kind === 'disable' && <Button type="button" variant="secondary" onClick={() => { setError(null); setCode(''); setStage({ kind: 'enrolled', factorId: stage.factorId }); }}>Keep it on</Button>}
      </div>
    </form>
  );
}
