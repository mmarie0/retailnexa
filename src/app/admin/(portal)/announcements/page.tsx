import { requestNow } from '@/lib/time';
import type { Metadata } from 'next';
import { getAdminContext } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, Field, Input, PageHeader, Select, Textarea } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { createAnnouncement, endAnnouncement } from '../actions';

export const metadata: Metadata = { title: 'Announcements' };

export default async function AnnouncementsPage() {
  const { supabase } = await getAdminContext();
  const { data } = await supabase.from('announcements').select('*').order('created_at', { ascending: false }).limit(50);
  const now = requestNow();
  return (
    <>
      <PageHeader title="Announcements" description="Messages shown on customers’ overview page." />
      <Card>
        <ActionForm action={createAnnouncement} className="flex flex-col gap-3">
          <Field label="Title" htmlFor="title"><Input id="title" name="title" required maxLength={160} /></Field>
          <Field label="Message" htmlFor="body"><Textarea id="body" name="body" required maxLength={4000} /></Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Severity" htmlFor="severity"><Select id="severity" name="severity"><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></Select></Field>
            <Field label="Who sees it" htmlFor="audience"><Select id="audience" name="audience"><option value="all">Everyone</option><option value="retail">Retail accounts</option><option value="wholesale">Wholesale accounts</option></Select></Field>
            <Field label="Show until (optional)" htmlFor="ends"><Input id="ends" name="ends" type="date" /></Field>
          </div>
          <SubmitButton className="self-start" pendingText="Publishing…">Publish</SubmitButton>
        </ActionForm>
      </Card>
      <ul className="flex flex-col gap-3">
        {(data ?? []).map((a) => {
          const live = new Date(a.starts_at).getTime() <= now && (!a.ends_at || new Date(a.ends_at).getTime() > now);
          return (
            <li key={a.id}><Card className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="font-bold">{a.title} <Badge tone={a.severity === 'critical' ? 'danger' : a.severity === 'warning' ? 'warning' : 'info'}>{a.severity}</Badge></p><p className="mt-1 text-muted">{a.body}</p></div>
              {live ? <ActionForm action={endAnnouncement}><input type="hidden" name="id" value={a.id} /><SubmitButton size="sm" variant="secondary" pendingText="…">End now</SubmitButton></ActionForm> : <Badge>Ended</Badge>}
            </Card></li>
          );
        })}
      </ul>
    </>
  );
}
