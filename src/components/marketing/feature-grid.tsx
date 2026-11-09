import { Badge } from '@/components/ui';
import type { Feature } from '@/content/features';

export function FeatureGrid({ features }: { features: Feature[] }) {
  return (
    <ul className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
      {features.map((f) => (
        <li key={f.title} className="border-t-2 border-ink pt-4">
          <h3 className="flex flex-wrap items-center gap-2 text-lg font-bold">
            {f.title}
            {f.status === 'in_development' && <Badge tone="info">In development</Badge>}
          </h3>
          <p className="mt-1.5 text-muted">{f.body}</p>
        </li>
      ))}
    </ul>
  );
}

export function PageIntro({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-10 pt-14 sm:pt-20">
      <h1 className="max-w-3xl text-[40px] font-extrabold leading-[1.05] sm:text-[56px]">{title}</h1>
      <div className="mt-5 max-w-2xl text-lg text-muted">{children}</div>
    </section>
  );
}
