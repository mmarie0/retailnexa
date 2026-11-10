import type { Metadata } from 'next';
import Link from 'next/link';
import { getAdminContext } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, EmptyState, PageHeader, Select, Textarea, cx } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { updateLead } from '../actions';

export const metadata: Metadata = { title: 'Leads' };
const STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost', 'spam'] as const;

export default async function LeadsPage({ searchParams }: PageProps<'/admin/leads'>) {
  const { supabase } = await getAdminContext();
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status as (typeof STATUSES)[number]) ? (sp.status as string) : 'new';
  const { data } = await supabase.from('leads').select('*').eq('status', status).order('created_at', { ascending: false }).limit(200);
  return (
    <>
      <PageHeader title="Leads" description="Demo requests and contact-form messages from the website." />
      <nav aria-label="Lead status" className="flex flex-wrap gap-1.5">
        {STATUSES.map((s) => (
          <Link key={s} href={`/admin/leads?status=${s}`} aria-current={s === status ? 'page' : undefined}
            className={cx('rounded-full px-3 py-1 text-sm font-semibold', s === status ? 'bg-ink text-white' : 'bg-card text-muted')}>{s}</Link>
        ))}
      </nav>
      {(data ?? []).length === 0 ? <EmptyState title={`No ${status} leads`} /> : (
        <ul className="flex flex-col gap-3">
          {(data ?? []).map((l) => (
            <li key={l.id}>
              <Card className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold">{l.name}{l.company && <span className="font-normal text-muted"> · {l.company}</span>}</p>
                  <span className="flex gap-2"><Badge tone="info">{l.kind}</Badge>{l.business_type && <Badge>{l.business_type}</Badge>}{l.locations_count && <Badge>{l.locations_count} locations</Badge>}</span>
                </div>
                <p className="text-[15px]"><a href={`mailto:${l.email}`} className="font-semibold text-accent-strong">{l.email}</a>{l.phone && ` · ${l.phone}`} · {new Date(l.created_at).toLocaleString()}</p>
                {l.message && <p className="whitespace-pre-wrap rounded-lg bg-soft p-3 text-[15px]">{l.message}</p>}
                <ActionForm action={updateLead} className="flex flex-col gap-2 sm:flex-row sm:items-start">
                  <input type="hidden" name="id" value={l.id} />
                  <Select name="status" defaultValue={l.status} aria-label="Status" className="sm:w-40">{STATUSES.map((s) => <option key={s}>{s}</option>)}</Select>
                  <Textarea name="notes" defaultValue={l.notes ?? ''} aria-label="Notes" placeholder="Notes" className="min-h-10 flex-1" />
                  <SubmitButton variant="secondary" pendingText="Saving…">Save</SubmitButton>
                </ActionForm>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
