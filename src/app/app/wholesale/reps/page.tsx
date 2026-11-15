import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getSupabase } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, EmptyState, Field, Input, Notice, PageHeader, Select, Textarea } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { centsToInput } from '@/lib/money';
import { ReadOnlyNotice } from '../../read-only-notice';
import { loadCommission, loadReps, wsContext, type Rep } from '../_data';
import { money } from '../_ui';
import { saveRep } from '../actions';

export const metadata: Metadata = { title: 'Sales reps' };

const basisLabel = (r: Pick<Rep, 'rate_pct' | 'basis' | 'earn_on'>) =>
  `${r.rate_pct}% of ${r.basis === 'sales' ? 'sales' : 'gross profit'}, earned ${r.earn_on === 'invoiced' ? 'when invoiced' : 'as the customer pays'}`;

function RepFields({ r, team }: { r?: Rep; team: { id: string; name: string }[] }) {
  const k = r?.id ?? 'new';
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <input type="hidden" name="id" value={r?.id ?? ''} />
      <Field label="Name" htmlFor={`${k}-n`}><Input id={`${k}-n`} name="name" defaultValue={r?.name} required maxLength={120} /></Field>
      <Field label="Email (optional)" htmlFor={`${k}-e`}><Input id={`${k}-e`} name="email" type="email" defaultValue={r?.email ?? ''} maxLength={200} /></Field>
      <Field label="Phone (optional)" htmlFor={`${k}-p`}><Input id={`${k}-p`} name="phone" type="tel" defaultValue={r?.phone ?? ''} maxLength={40} /></Field>
      <Field label="Commission %" htmlFor={`${k}-r`}><Input id={`${k}-r`} name="rate_pct" type="number" min={0} max={100} step="0.01" defaultValue={r?.rate_pct ?? 5} className="num" required /></Field>
      <Field label="Paid on" htmlFor={`${k}-b`}>
        <Select id={`${k}-b`} name="basis" defaultValue={r?.basis ?? 'sales'}><option value="sales">Sales (before tax and shipping)</option><option value="profit">Gross profit (sales − cost)</option></Select>
      </Field>
      <Field label="Earned" htmlFor={`${k}-t`}>
        <Select id={`${k}-t`} name="earn_on" defaultValue={r?.earn_on ?? 'paid'}><option value="paid">As the customer pays</option><option value="invoiced">When the order is invoiced</option></Select>
      </Field>
      <Field label="Monthly sales target (optional)" htmlFor={`${k}-g`}><Input id={`${k}-g`} name="monthly_target" inputMode="decimal" className="num" defaultValue={r?.monthly_target_cents != null ? centsToInput(r.monthly_target_cents) : ''} placeholder="10000.00" /></Field>
      <Field label="Their login (optional)" htmlFor={`${k}-u`} hint="Link a team member with the Sales rep role so they see their own orders and commission.">
        <Select id={`${k}-u`} name="user_id" defaultValue={r?.user_id ?? ''}><option value="">No login</option>{team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
      </Field>
      {r && <label className="flex items-center gap-2 self-end pb-2 text-[15px]"><input type="hidden" name="active" value="false" /><input type="checkbox" name="active" value="true" defaultChecked={r.is_active} className="size-4 accent-[#3f63de]" />Active</label>}
      <div className="sm:col-span-3"><Field label="Notes (optional)" htmlFor={`${k}-no`}><Textarea id={`${k}-no`} name="notes" rows={2} maxLength={1000} defaultValue={r?.notes ?? ''} /></Field></div>
    </div>
  );
}

/** Wholesale sales reps: commission terms, this month against target, what you owe them. */
export default async function RepsPage() {
  const ctx = await wsContext();
  if (!can(ctx, 'commissions.view') && !can(ctx, 'commissions.manage')) return <Notice tone="warning">You don’t have access to sales reps.</Notice>;
  const month = ctx.today.slice(0, 7);
  const [reps, sum, { data: members }] = await Promise.all([
    loadReps(ctx.org.id), loadCommission(ctx.org.id, `${month}-01`, ctx.today),
    (await getSupabase()).from('memberships').select('user_id, role').eq('organization_id', ctx.org.id).eq('status', 'active'),
  ]);
  const ids = (members ?? []).map((m) => m.user_id as string);
  const { data: profiles } = ids.length ? await (await getSupabase()).from('profiles').select('id, email, full_name').in('id', ids) : { data: [] };
  const who = new Map((profiles ?? []).map((p) => [p.id as string, (p.full_name as string | null) || (p.email as string)]));
  const manage = can(ctx, 'commissions.manage') && ctx.access.canWrite;
  const byRep = new Map(sum.map((s) => [s.rep_id, s]));
  const team = (members ?? []).map((m) => ({ id: m.user_id as string, name: `${who.get(m.user_id as string) ?? 'Team member'}${m.role === 'sales_rep' ? '' : ` (${String(m.role).replace('_', ' ')})`}` }));
  return (
    <>
      <PageHeader title="Sales reps" description="Who sells for you, what they earn, and how they’re doing this month. Pay them on the Commissions page." />
      <ReadOnlyNotice show={can(ctx, 'commissions.manage') && !ctx.access.canWrite} />
      {reps.length ? (
        <ul className="flex flex-col gap-2">
          {reps.map((r) => {
            const s = byRep.get(r.id);
            const sales = s?.invoiced_sales_cents ?? 0;
            const pct = r.monthly_target_cents ? Math.min(100, Math.round((sales / r.monthly_target_cents) * 100)) : null;
            return (
              <li key={r.id}>
                <Card className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0"><span className="block font-bold">{r.name}{!r.is_active && <Badge>Inactive</Badge>}</span>
                      <span className="text-sm text-muted">{basisLabel(r)}{r.user_id ? ' · has a login' : ''}</span></span>
                    <span className="text-end"><span className="block text-xs text-muted">Owed to them</span><span className="num text-lg font-bold">{money(s?.balance_cents ?? 0)}</span></span>
                  </div>
                  <dl className="grid grid-cols-3 gap-2 text-center text-sm">
                    <div className="rounded-xl bg-soft px-2 py-1.5"><dt className="text-xs text-muted">Sales this month</dt><dd className="num font-semibold">{money(sales)}</dd></div>
                    <div className="rounded-xl bg-soft px-2 py-1.5"><dt className="text-xs text-muted">Earned this month</dt><dd className="num font-semibold">{money(s?.earned_cents ?? 0)}</dd></div>
                    <div className="rounded-xl bg-soft px-2 py-1.5"><dt className="text-xs text-muted">Target</dt><dd className="num font-semibold">{r.monthly_target_cents ? `${pct}%` : '—'}</dd></div>
                  </dl>
                  {pct !== null && <div className="h-2 overflow-hidden rounded-full bg-soft" role="img" aria-label={`${pct}% of the monthly target`}><div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} /></div>}
                  <div className="flex flex-wrap gap-3 text-sm">
                    <Link href={`/app/wholesale/commissions?rep=${r.id}`} className="font-semibold text-accent-strong">Commission details</Link>
                  </div>
                  {manage && (
                    <details>
                      <summary className="cursor-pointer text-sm font-semibold text-muted">Edit</summary>
                      <ActionForm action={saveRep} className="mt-2 flex flex-col gap-3"><RepFields r={r} team={team} /><div><SubmitButton size="sm">Save</SubmitButton></div></ActionForm>
                    </details>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      ) : <EmptyState title="No sales reps yet">{manage ? 'Add your first rep below.' : 'An owner or admin can add sales reps.'}</EmptyState>}
      {manage && (
        <Card id="add">
          <h2 className="text-lg font-bold">Add a sales rep</h2>
          <p className="mt-1 text-sm text-muted">To give them a login, first invite them on Business → Team with the <strong>Sales rep</strong> role, then pick them here.</p>
          <ActionForm action={saveRep} className="mt-3 flex flex-col gap-3"><RepFields team={team} /><div><SubmitButton>Add rep</SubmitButton></div></ActionForm>
        </Card>
      )}
      <p className="text-sm text-muted">Each customer has a rep (set on the customer’s page). An order is credited to the rep who entered it, or else to the customer’s rep. Managers can change who gets credit on the order.</p>
    </>
  );
}
