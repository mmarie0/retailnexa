import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { PrintButton } from '@/components/print-button';
import { Card, Notice, cx } from '@/components/ui';
import { formatMoney } from '@/lib/billing/plans';
import { PAY_METHOD_LABEL } from '@/lib/staff/payroll';

export const metadata: Metadata = { title: 'Paystubs' };
const dl = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
type L = { id: string; employee_id: string; pay_type: string; hours: number; overtime_hours: number; rate_cents: number; regular_cents: number; overtime_cents: number;
  bonus_cents: number; gross_cents: number; advance_cents: number; net_cents: number; employer_tax_cents: number; pay_method: 'cash' | 'check' | 'ach' | null };

/** Printable paystubs for one pay run (save as PDF from the print dialog). */
export default async function RunStubsPage({ params, searchParams }: PageProps<'/app/staff/stubs/[id]'>) {
  const ctx = await getOrgContext();
  if (!can(ctx, 'payroll.view')) return <Notice tone="warning">You don’t have access to payroll.</Notice>;
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const method = sp.method === 'cash' || sp.method === 'check' || sp.method === 'ach' ? sp.method : 'all';
  const withTax = sp.tax === '1';
  const supabase = await getSupabase();
  const [{ data: run }, { data: lines }, { data: emps }, { data: org }] = await Promise.all([
    supabase.from('pay_runs').select('id, pay_date, period_start, period_end, voided_at').eq('id', id).eq('organization_id', ctx.org.id).maybeSingle(),
    supabase.from('pay_run_lines').select('id, employee_id, pay_type, hours, overtime_hours, rate_cents, regular_cents, overtime_cents, bonus_cents, gross_cents, advance_cents, net_cents, employer_tax_cents, pay_method')
      .eq('run_id', id).eq('organization_id', ctx.org.id),
    supabase.from('employees').select('id, name, role_title').eq('organization_id', ctx.org.id),
    supabase.from('organizations').select('name, legal_name').eq('id', ctx.org.id).maybeSingle(),
  ]);
  if (!run) notFound();
  const who = new Map((emps ?? []).map((e) => [e.id, e]));
  const all = (lines ?? []) as L[];
  const shown = all.filter((l) => method === 'all' || l.pay_method === method).sort((a, b) => (who.get(a.employee_id)?.name ?? '').localeCompare(who.get(b.employee_id)?.name ?? ''));
  const q = (o: { method?: string; tax?: boolean }) => {
    const p = new URLSearchParams(); const m = o.method ?? method, t = o.tax ?? withTax;
    if (m !== 'all') p.set('method', m); if (t) p.set('tax', '1');
    const s = p.toString(); return s ? `?${s}` : '';
  };
  const n = (v: unknown) => Number(v ?? 0);
  const business = (org?.legal_name as string | null) || (org?.name as string | undefined) || ctx.org.name;

  return (
    <>
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Link href="/app/staff/stubs" className="font-semibold text-accent-strong">‹ All pay runs</Link>
        <PrintButton label="Print / save as PDF" />
      </div>
      <nav aria-label="Filter" className="no-print flex flex-wrap gap-1.5">
        {(['all', 'cash', 'check', 'ach'] as const).map((m) => (
          <Link key={m} href={`/app/staff/stubs/${id}${q({ method: m })}`} aria-current={method === m ? 'page' : undefined}
            className={cx('rounded-full px-3 py-1.5 text-sm font-semibold', method === m ? 'bg-accent text-white' : 'bg-card text-muted shadow-[var(--shadow-card)]')}>
            {m === 'all' ? `All (${all.length})` : `${PAY_METHOD_LABEL[m]} (${all.filter((l) => l.pay_method === m).length})`}
          </Link>
        ))}
        <Link href={`/app/staff/stubs/${id}${q({ tax: !withTax })}`} className="rounded-full bg-card px-3 py-1.5 text-sm font-semibold text-accent-strong shadow-[var(--shadow-card)]">
          {withTax ? 'Hide employer taxes' : 'Show employer taxes'}
        </Link>
      </nav>
      {run.voided_at && <Notice tone="warning">This pay run was voided.</Notice>}
      {shown.length === 0 ? <p className="rounded-[14px] bg-card p-4 text-center text-sm text-muted">No paystubs for this filter.</p> : shown.map((l, i) => {
        const e = who.get(l.employee_id);
        const rows: [string, number, string?][] = [
          [l.pay_type === 'salary' ? 'Salary' : `Regular ${n(l.hours) - n(l.overtime_hours)} hrs × ${formatMoney(n(l.rate_cents))}`, n(l.regular_cents)],
          ...(n(l.overtime_cents) ? [[`Overtime ${n(l.overtime_hours)} hrs`, n(l.overtime_cents)] as [string, number]] : []),
          ...(n(l.bonus_cents) ? [['Bonus', n(l.bonus_cents)] as [string, number]] : []),
        ];
        return (
          <Card key={l.id} className={cx('flex flex-col gap-3 print:shadow-none', i < shown.length - 1 && 'print-break')}>
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line pb-3">
              <div><p className="text-lg font-bold">{business}</p><p className="text-sm text-muted">Paystub</p></div>
              <div className="text-right text-sm"><p className="font-semibold">Pay date {dl(run.pay_date)}</p><p className="text-muted">Period {dl(run.period_start)} – {dl(run.period_end)}</p></div>
            </div>
            <div className="flex flex-wrap justify-between gap-2 text-[15px]">
              <p><span className="font-semibold">{e?.name ?? 'Employee'}</span>{e?.role_title && <span className="text-muted"> · {e.role_title}</span>}</p>
              <p className="text-muted">Paid by {l.pay_method ? PAY_METHOD_LABEL[l.pay_method] : '—'}</p>
            </div>
            <table className="w-full text-[15px]">
              <tbody>
                {rows.map(([label, c]) => <tr key={label}><td className="py-1">{label}</td><td className="num py-1 text-right">{formatMoney(c)}</td></tr>)}
                <tr className="border-t border-line font-semibold"><td className="py-1">Gross pay</td><td className="num py-1 text-right">{formatMoney(n(l.gross_cents))}</td></tr>
                {n(l.advance_cents) > 0 && <tr><td className="py-1">Advance taken back</td><td className="num py-1 text-right">−{formatMoney(n(l.advance_cents))}</td></tr>}
                <tr className="border-t border-line text-lg font-bold"><td className="py-1.5">Net pay</td><td className="num py-1.5 text-right">{formatMoney(n(l.net_cents))}</td></tr>
                {withTax && <tr className="text-sm text-muted"><td className="py-1">Employer taxes & benefits (paid by the business)</td><td className="num py-1 text-right">{formatMoney(n(l.employer_tax_cents))}</td></tr>}
              </tbody>
            </table>
            <p className="text-xs text-muted">No taxes were withheld from this pay. Keep this for your records.</p>
          </Card>
        );
      })}
    </>
  );
}
