import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getOrgContext } from '@/lib/auth/context';
import { isPermission } from '@/lib/auth/permissions';
import { Card, PageHeader } from '@/components/ui';
import { APP_HELP } from '@/content/app-help';

export const metadata: Metadata = { title: 'Help' };

/** #116 In-app help for the business features this person can use. */
export default async function AppHelpPage() {
  const ctx = await getOrgContext();
  const entries = APP_HELP.filter((h) => !h.perm || (isPermission(h.perm) && can(ctx, h.perm)));
  return (
    <>
      <PageHeader title="Help" description="What each part of RetailNexa does, and how to use it." />
      <Card>
        <h2 className="text-lg font-bold">Start here</h2>
        <ol className="mt-2 list-decimal pl-5 text-[15px]">
          <li>Import today’s sales report or enter your bills.</li>
          <li>Set each vendor’s credit terms so due dates fill in.</li>
          <li>Add your team and your monthly fixed costs.</li>
        </ol>
      </Card>
      <ul className="flex flex-col gap-2">
        {entries.map((h) => (
          <li key={h.id}>
            <details id={`help-${h.id}`} className="rounded-[16px] bg-card shadow-[var(--shadow-card)] [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
                <span><span className="block font-semibold">{h.title}</span><span className="text-sm text-muted">{h.what}</span></span>
                <span aria-hidden className="text-muted">›</span>
              </summary>
              <div className="flex flex-col gap-2 px-4 pb-4">
                <ol className="list-decimal pl-5 text-[15px]">{h.steps.map((s) => <li key={s} className="py-0.5">{s}</li>)}</ol>
                {h.tip && <p className="text-sm text-muted">{h.tip}</p>}
                <Link href={h.href} className="self-start rounded-full bg-soft px-3.5 py-1.5 text-sm font-semibold text-accent-strong">Take me there ›</Link>
              </div>
            </details>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">Still stuck? <Link href="/contact" className="font-semibold text-accent-strong">Contact us</Link>.</p>
    </>
  );
}
