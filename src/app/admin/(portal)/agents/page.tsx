import type { Metadata } from 'next';
import Link from 'next/link';
import { adminCan, getAdminContext } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, EmptyState, Field, Input, PageHeader } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { KpiTile } from '@/components/data/kpi-tile';
import { formatMoney } from '@/lib/billing/plans';
import { bookSummary } from '@/lib/partners';
import { addAgent } from './actions';
import { agentBooks } from './_data';

export const metadata: Metadata = { title: 'Sales agents' };

/** Sales agents who sell RetailNexa: their accounts and MRR, and adding a new agent. */
export default async function AgentsPage() {
  const ctx = await getAdminContext();
  const [{ data: agents }, books] = await Promise.all([
    ctx.supabase.from('sales_agents').select('user_id, name, email, ref_code, is_active, discount_org_id, created_at').order('name'),
    agentBooks(ctx.supabase),
  ]);
  const rows = (agents ?? []).map((a) => ({ a, s: bookSummary(books.get(a.user_id) ?? []) }));
  const total = bookSummary([...books.values()].flat());
  return (
    <>
      <PageHeader title="Sales agents" description="People who sell RetailNexa for you. Each has their own login and sees only their own accounts. MRR is at list price, before discounts and tax." />
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiTile size="lg" tone="indigo" label="MRR from agents" value={formatMoney(total.mrrCents)} footnote={`${total.paying} paying accounts`} />
        <KpiTile size="lg" tone="blue" label="In free trial" value={String(total.trialing)} footnote={`${formatMoney(total.trialPipelineCents)}/mo if all convert`} />
        <KpiTile size="lg" tone="lav" label="Active agents" value={String(rows.filter((r) => r.a.is_active).length)} footnote={`${total.newThisMonth} new accounts this month`} />
      </div>
      {rows.length ? (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-[15px]">
            <thead><tr className="border-b border-line text-start text-sm text-muted">
              <th className="px-4 py-2 font-semibold">Agent</th><th className="px-4 py-2 font-semibold">Code</th><th className="px-4 py-2 text-end font-semibold">Accounts</th>
              <th className="px-4 py-2 text-end font-semibold">Paying</th><th className="px-4 py-2 text-end font-semibold">Trials</th><th className="px-4 py-2 text-end font-semibold">MRR</th>
            </tr></thead>
            <tbody>
              {rows.map(({ a, s }) => (
                <tr key={a.user_id} className="border-b border-soft">
                  <td className="px-4 py-2"><Link href={`/admin/agents/${a.user_id}`} className="font-semibold text-accent-strong">{a.name}</Link>
                    <span className="block text-sm text-muted">{a.email}</span>{!a.is_active && <Badge>Inactive</Badge>}</td>
                  <td className="px-4 py-2 font-mono text-sm">{a.ref_code}</td>
                  <td className="num px-4 py-2 text-end">{s.accounts}</td><td className="num px-4 py-2 text-end">{s.paying}</td>
                  <td className="num px-4 py-2 text-end">{s.trialing}</td><td className="num px-4 py-2 text-end font-semibold">{formatMoney(s.mrrCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : <EmptyState title="No sales agents yet">Add one below. They get an email to set their password.</EmptyState>}
      {adminCan(ctx.role, 'agents') && (
        <Card id="add">
          <h2 className="text-lg font-bold">Add a sales agent</h2>
          <p className="mt-1 text-sm text-muted">We create their login and email them a link to set a password. They sign in at the normal login page and land on their partner page.</p>
          <ActionForm action={addAgent} className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="an"><Input id="an" name="name" required maxLength={120} /></Field>
            <Field label="Email" htmlFor="ae"><Input id="ae" name="email" type="email" required maxLength={200} /></Field>
            <Field label="Phone (optional)" htmlFor="ap"><Input id="ap" name="phone" type="tel" maxLength={40} /></Field>
            <Field label="Referral code" htmlFor="ac" hint="Goes on their link, e.g. retailnexa.com/?ref=MARIA. Letters and numbers."><Input id="ac" name="ref_code" required maxLength={20} pattern="[A-Za-z0-9]{4,20}" className="uppercase" /></Field>
            <div className="sm:col-span-2"><SubmitButton>Add agent and send password link</SubmitButton></div>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
