'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Input } from '@/components/ui';
import type { HelpArticle } from '@/content/help';

export function HelpSearch({ articles }: { articles: Pick<HelpArticle, 'slug' | 'title' | 'summary' | 'category' | 'body'>[] }) {
  const [q, setQ] = useState('');
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const results = articles.filter((a) => {
    const text = `${a.title} ${a.summary} ${a.body.join(' ')}`.toLowerCase();
    return terms.every((t) => text.includes(t));
  });
  const groups = [...new Set(results.map((a) => a.category))];
  return (
    <div>
      <Input type="search" aria-label="Search help articles" placeholder="Search, e.g. cancel, invite, export" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xl py-3 text-base" />
      {results.length === 0 && <p className="mt-6 text-muted">No articles match “{q}”. Try fewer words, or <Link href="/contact" className="font-semibold text-accent-strong underline">contact us</Link>.</p>}
      {groups.map((g) => (
        <section key={g} className="mt-10">
          <h2 className="text-xl font-extrabold">{g}</h2>
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {results.filter((a) => a.category === g).map((a) => (
              <li key={a.slug}><Link href={`/help/${a.slug}`} className="block py-4 hover:bg-card/60"><span className="font-bold">{a.title}</span><span className="block text-muted">{a.summary}</span></Link></li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
