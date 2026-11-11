import type { Metadata } from 'next';
import Link from 'next/link';
import { getOrgContext, getSupabase } from '@/lib/auth/context';
import { Card, Eyebrow, PageHeader } from '@/components/ui';
import { TILES, cleanLayout } from '@/lib/dashboard/overview';
import { StepButton } from './step-button';

export const metadata: Metadata = { title: 'Customize Overview' };

/** #108: choose and order the boxes on your Overview. Saved for you only, in this business. */
export default async function CustomizePage() {
  const ctx = await getOrgContext();
  const { data } = await (await getSupabase()).from('overview_layouts').select('layout').eq('organization_id', ctx.org.id).eq('user_id', ctx.user.id).maybeSingle();
  const cur = cleanLayout(data?.layout ?? null);
  const name = new Map(TILES.map((t) => [t.id as string, t]));
  const avail = TILES.filter((t) => !cur.includes(t.id));
  return (
    <>
      <PageHeader title="Customize Overview" description="Pick the boxes on your Overview and their order. Only you see this layout. Boxes you don’t have access to stay hidden." />
      <Eyebrow>On your Overview (top to bottom)</Eyebrow>
      <Card className="flex flex-col divide-y divide-line p-0">
        {cur.length ? cur.map((id, i) => (
          <div key={id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="min-w-0 font-semibold">{name.get(id)!.name}</span>
            <span className="flex shrink-0 gap-1">
              <StepButton op="up" id={id} label={`Move ${name.get(id)!.name} up`} disabled={i === 0}>↑</StepButton>
              <StepButton op="down" id={id} label={`Move ${name.get(id)!.name} down`} disabled={i === cur.length - 1}>↓</StepButton>
              <StepButton op="remove" id={id} label={`Remove ${name.get(id)!.name}`}>✕</StepButton>
            </span>
          </div>
        )) : <p className="px-4 py-3 text-muted">Nothing yet. Add boxes below.</p>}
      </Card>
      <Eyebrow>Add a box</Eyebrow>
      <Card className="flex flex-col divide-y divide-line p-0">
        {avail.length ? avail.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="flex min-w-0 flex-col"><span className="font-semibold">{t.name}</span><span className="text-sm text-muted">{t.note}</span></span>
            <StepButton op="add" id={t.id} label={`Add ${t.name}`} wide>+ Add</StepButton>
          </div>
        )) : <p className="px-4 py-3 text-muted">Every box is already on your Overview.</p>}
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StepButton op="reset" id="" label="Reset to the standard layout" wide>Reset to standard</StepButton>
        <Link href="/app" className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white">Done</Link>
      </div>
      <p className="text-sm text-muted">Half-size boxes (Projected payroll, Projected profit) sit side by side when they’re next to each other. Cash boxes aren’t offered.</p>
    </>
  );
}
