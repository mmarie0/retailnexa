import type { Metadata } from 'next';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, Eyebrow, Field, Input, Notice, PageHeader, Select, Textarea } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { formatMoney } from '@/lib/billing/plans';
import { todayIn } from '@/lib/time';
import { pageAll } from '@/lib/page-all';
import { TEMPLATES, everyText, schedule, spent, type Due, type LogRow, type Task } from '@/lib/upkeep';
import { fmtDate } from '../bills/format';
import { ReadOnlyNotice } from '../read-only-notice';
import { Stat } from '../_dashboard/tiles';
import { markDone, removeUpkeepItem, saveTask } from './actions';

export const metadata: Metadata = { title: 'Upkeep' };
const PILL = { late: ['danger', 'Overdue'], soon: ['warning', 'Due soon'], ok: ['good', 'On track'] } as const;
const dueText = (t: Due) => (t.days < 0 ? `${-t.days} day${t.days === -1 ? '' : 's'} overdue` : t.days === 0 ? 'Due today' : `Due ${fmtDate(t.due)} · in ${t.days} day${t.days === 1 ? '' : 's'}`);

function TaskFields({ t, stores, today }: { t?: Due; stores: { id: string; name: string }[]; today: string }) {
  const p = t?.id ?? 'new';
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <input type="hidden" name="id" value={t?.id ?? ''} />
      <Field label="Task" htmlFor={`${p}-name`}><Input id={`${p}-name`} name="name" defaultValue={t?.name} required maxLength={80} placeholder="HVAC filter change" /></Field>
      <Field label="Every" htmlFor={`${p}-n`}>
        <span className="flex gap-2">
          <Input id={`${p}-n`} name="every_n" type="number" min={1} max={120} defaultValue={t?.every_n ?? 1} className="w-20" required />
          <Select name="every_unit" defaultValue={t?.every_unit ?? 'months'} aria-label="Days, weeks, months or years">{['days', 'weeks', 'months', 'years'].map((u) => <option key={u} value={u}>{u}</option>)}</Select>
        </span>
      </Field>
      <Field label="Last done (optional)" htmlFor={`${p}-last`}><Input id={`${p}-last`} name="last_done" type="date" max={today} defaultValue={t?.last_done ?? ''} /></Field>
      <Field label="Area (optional)" htmlFor={`${p}-area`}><Input id={`${p}-area`} name="area" defaultValue={t?.area ?? ''} maxLength={40} placeholder="HVAC" /></Field>
      <Field label="Who does it (optional)" htmlFor={`${p}-vendor`}><Input id={`${p}-vendor`} name="vendor" defaultValue={t?.vendor ?? ''} maxLength={80} /></Field>
      {stores.length > 1 ? (
        <Field label="Store" htmlFor={`${p}-loc`}><Select id={`${p}-loc`} name="location_id" defaultValue={t?.location_id ?? ''}><option value="">Every store</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
      ) : <input type="hidden" name="location_id" value="" />}
      <div className="sm:col-span-3"><Field label="Notes (optional)" htmlFor={`${p}-notes`}><Textarea id={`${p}-notes`} name="notes" rows={2} defaultValue={t?.notes ?? ''} maxLength={500} /></Field></div>
      {t && (
        <label className="flex items-center gap-2 text-[15px]"><input type="hidden" name="active" value="false" /><input type="checkbox" name="active" value="true" defaultChecked={t.is_active} className="size-4 accent-[#3f63de]" />Active (untick to pause)</label>
      )}
    </div>
  );
}

/** #115 Upkeep: recurring maintenance with what's overdue and coming up, a log with costs, and suggested tasks. */
export default async function UpkeepPage() {
  const ctx = await getOrgContext();
  if (!(['maintenance.view', 'tasks.view'] as const).some((p) => can(ctx, p))) return <Notice tone="warning">You don’t have access to maintenance.</Notice>;
  const sb = await getSupabase();
  const [{ data: tz }, tasks, log, { data: locs }] = await Promise.all([
    sb.from('organizations').select('timezone').eq('id', ctx.org.id).maybeSingle(),
    pageAll<Task>((a, b) => sb.from('maintenance_tasks').select('id, name, area, every_n, every_unit, last_done, vendor, notes, is_active, location_id, created_at').eq('organization_id', ctx.org.id).order('id').range(a, b)),
    pageAll<LogRow>((a, b) => sb.from('maintenance_log').select('id, task_id, done_on, cost_cents, note').eq('organization_id', ctx.org.id).order('id').range(a, b)),
    sb.rpc('my_locations', { p_org: ctx.org.id }),
  ]);
  const today = todayIn(tz?.timezone);
  const stores = (locs ?? []) as { id: string; name: string }[];
  const { active, paused } = schedule(tasks, log, today);
  const cost = spent(log, today);
  const manage = can(ctx, 'tasks.manage') && ctx.access.canWrite, complete = can(ctx, 'maintenance.complete') && ctx.access.canWrite;
  const storeName = new Map(stores.map((s) => [s.id, s.name]));
  const have = new Set(tasks.map((t) => t.name.toLowerCase()));
  const suggestions = TEMPLATES.map((t, i) => ({ ...t, i })).filter((t) => !have.has(t.name.toLowerCase()));

  const row = (t: Due) => (
    <li key={t.id}>
      <Card className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-bold">{t.name} <span className="font-normal text-muted">· {everyText(t)}</span></p>
            <p className="text-sm text-muted">{[t.area, stores.length > 1 ? (t.location_id ? storeName.get(t.location_id) : 'Every store') : null, t.lastDone ? `Last done ${fmtDate(t.lastDone)}` : 'Not done yet', t.vendor].filter(Boolean).join(' · ')}</p>
          </div>
          <span className="text-end"><Badge tone={PILL[t.status][0]}>{PILL[t.status][1]}</Badge><span className="block text-xs text-muted">{t.is_active ? dueText(t) : 'Paused'}</span></span>
        </div>
        {t.notes && <p className="text-sm text-muted">{t.notes}</p>}
        <div className="flex flex-col gap-1.5">
          {complete && t.is_active && (
            <details>
              <summary className="cursor-pointer font-semibold text-accent-strong">Mark done</summary>
              <ActionForm action={markDone} className="mt-2 grid gap-2 sm:grid-cols-4">
                <input type="hidden" name="task_id" value={t.id} />
                <Field label="Done on" htmlFor={`d-${t.id}`}><Input id={`d-${t.id}`} name="done_on" type="date" defaultValue={today} max={today} required /></Field>
                <Field label="Cost (optional)" htmlFor={`c-${t.id}`}><Input id={`c-${t.id}`} name="cost" inputMode="decimal" className="num" placeholder="0.00" /></Field>
                <div className="sm:col-span-2"><Field label="Note (optional)" htmlFor={`n-${t.id}`}><Input id={`n-${t.id}`} name="note" maxLength={300} /></Field></div>
                <div className="sm:col-span-4"><SubmitButton size="sm">Save</SubmitButton></div>
              </ActionForm>
            </details>
          )}
          {t.history.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-muted">History · {t.history.length} time{t.history.length === 1 ? '' : 's'}{t.spentCents ? ` · ${formatMoney(t.spentCents)}` : ''}</summary>
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {t.history.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>{fmtDate(h.done_on)}{h.note ? ` · ${h.note}` : ''}</span>
                    <span className="flex items-center gap-2"><span className="num">{h.cost_cents ? formatMoney(h.cost_cents) : '—'}</span>
                      {manage && <ActionForm action={removeUpkeepItem} className="contents"><input type="hidden" name="kind" value="log" /><input type="hidden" name="id" value={h.id} /><SubmitButton variant="ghost" size="sm" aria-label={`Remove the ${fmtDate(h.done_on)} entry`}>Remove</SubmitButton></ActionForm>}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {manage && (
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-muted">Edit</summary>
              <ActionForm action={saveTask} className="mt-2 flex flex-col gap-3"><TaskFields t={t} stores={stores} today={today} /><div><SubmitButton size="sm">Save changes</SubmitButton></div></ActionForm>
              <ActionForm action={removeUpkeepItem} className="mt-2"><input type="hidden" name="kind" value="task" /><input type="hidden" name="id" value={t.id} /><SubmitButton variant="danger" size="sm">Delete this task and its history</SubmitButton></ActionForm>
            </details>
          )}
        </div>
      </Card>
    </li>
  );
  const group = (title: string, list: Due[]) => list.length ? <section className="flex flex-col gap-2"><Eyebrow>{title}</Eyebrow><ul className="flex flex-col gap-2">{list.map(row)}</ul></section> : null;

  return (
    <>
      <PageHeader title="Maintenance" description="Recurring jobs for the store, when each is due and what upkeep has cost. Costs here are records only, not bills." />
      <ReadOnlyNotice show={can(ctx, 'tasks.manage') && !ctx.access.canWrite} />
      {tasks.length > 0 && (
        <div className="grid grid-cols-3 gap-3 max-[520px]:grid-cols-1">
          <Stat block={active.some((t) => t.status === 'late') ? 'coral' : undefined} label="Overdue" value={String(active.filter((t) => t.status === 'late').length)} />
          <Stat label="Next 14 days" value={String(active.filter((t) => t.days >= 0 && t.days <= 14).length)} />
          <Stat label={`Spent ${today.slice(0, 4)}`} value={formatMoney(cost.year)} sub={`${formatMoney(cost.month)} this month`} />
        </div>
      )}
      {group('Overdue', active.filter((t) => t.days < 0))}
      {group('Coming up (30 days)', active.filter((t) => t.days >= 0 && t.days <= 30))}
      {group('Later', active.filter((t) => t.days > 30))}
      {group('Paused', paused)}

      {manage && suggestions.length > 0 && (
        <Card>
          <h2 className="text-lg font-bold">{tasks.length ? 'Suggested tasks' : 'Set up your maintenance schedule'}</h2>
          <p className="mt-1 text-sm text-muted">Tap one to add it. Each starts as due now; mark it done or set when it was last done.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestions.map((t) => (
              <ActionForm key={t.i} action={saveTask} className="contents" quiet>
                <input type="hidden" name="template" value={t.i} />
                <button type="submit" className="rounded-full bg-soft px-3.5 py-1.5 text-sm font-semibold hover:bg-line">+ {t.name} <span className="font-normal text-muted">· {everyText(t)}</span></button>
              </ActionForm>
            ))}
          </div>
        </Card>
      )}
      {manage && (
        <Card id="add">
          <h2 className="text-lg font-bold">Add a task</h2>
          <ActionForm action={saveTask} className="mt-3 flex flex-col gap-3"><TaskFields stores={stores} today={today} /><div><SubmitButton>Add task</SubmitButton></div></ActionForm>
        </Card>
      )}
      {!manage && tasks.length === 0 && <Notice>No maintenance tasks yet. A manager can add them.</Notice>}
    </>
  );
}
