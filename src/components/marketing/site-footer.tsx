import Link from 'next/link';
import { Logo } from '@/components/ui';

const cols = [
  { title: 'Product', links: [['Features', '/features'], ['Pricing', '/pricing'], ['Live demo', '/demo'], ['Request a demo', '/request-demo']] },
  { title: 'Solutions', links: [['Retail stores', '/solutions/retail'], ['Wholesale', '/solutions/wholesale'], ['Accounting', '/solutions/accounting']] },
  { title: 'Support', links: [['Help center', '/help'], ['Contact', '/contact'], ['Log in', '/login']] },
  { title: 'Legal', links: [['Terms of service', '/legal/terms'], ['Privacy policy', '/legal/privacy'], ['Subscription terms', '/legal/billing']] },
];

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line bg-card">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-[1.4fr_repeat(4,1fr)]">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-muted">Sales, bills, inventory, staff and bookkeeping for independent retail stores and wholesale distributors.</p>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <p className="font-bold">{c.title}</p>
            <ul className="mt-3 space-y-2">
              {c.links.map(([label, href]) => <li key={href}><Link href={href} className="text-muted hover:text-ink">{label}</Link></li>)}
            </ul>
          </div>
        ))}
      </div>
      <p className="mx-auto max-w-6xl px-4 pb-8 text-sm text-muted">© {new Date().getFullYear()} RetailNexa</p>
    </footer>
  );
}
