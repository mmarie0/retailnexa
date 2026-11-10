import type { Metadata } from 'next';
import Link from 'next/link';
import { DemoApp } from './demo-app';
import { buttonClass } from '@/components/ui';

export const metadata: Metadata = { title: 'Interactive demo', description: 'Click through RetailNexa with a fictional store’s data. No signup needed.' };
export const revalidate = 86400;

export default function DemoPage() {
  const anchor = new Date().toISOString().slice(0, 10);
  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[36px] font-extrabold leading-tight sm:text-[44px]">Try it with a sample store</h1>
          <p className="mt-2 max-w-2xl text-muted">Everything here is fictional and resets when you leave. Pick a retail or wholesale account, switch locations and open a vendor. Wholesale also shows inventory and order building.</p>
        </div>
        <Link href="/signup" className={buttonClass('primary')}>Start free trial</Link>
      </div>
      <DemoApp anchor={anchor} />
    </div>
  );
}
