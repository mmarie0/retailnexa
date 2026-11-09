'use client';
import { useActionState, useState } from 'react';
import { initialActionState } from '@/lib/actions';
import { Field, FormMessage, Input, Select, buttonClass } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { ROLE_LABELS, type MemberRole } from '@/lib/auth/permissions';
import { inviteMember } from '../actions';

export function InviteForm({ roles }: { roles: MemberRole[] }) {
  const [state, action] = useActionState(inviteMember, initialActionState);
  const [copied, setCopied] = useState(false);
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <Field label="Email" htmlFor="invite-email" error={state.fieldErrors?.email}><Input id="invite-email" name="email" type="email" required /></Field>
        <Field label="Role" htmlFor="invite-role">
          <Select id="invite-role" name="role" defaultValue={roles.includes('employee') ? 'employee' : roles[0]}>
            {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </Select>
        </Field>
      </div>
      <SubmitButton className="self-start" pendingText="Creating…">Create invitation</SubmitButton>
      <FormMessage state={state} />
      {state.ok && state.data?.link && (
        <div className="flex flex-wrap items-center gap-2">
          <Input readOnly value={state.data.link} aria-label="Invitation link" className="flex-1 text-sm" onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className={buttonClass('secondary', 'sm')} onClick={async () => { await navigator.clipboard.writeText(state.data!.link); setCopied(true); }}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      )}
    </form>
  );
}
