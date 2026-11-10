import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { findArticle, HELP_ARTICLES } from '@/content/help';

export function generateStaticParams() {
  return HELP_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: PageProps<'/help/[slug]'>): Promise<Metadata> {
  const a = findArticle((await params).slug);
  return { title: a ? a.title : 'Help' };
}

export default async function HelpArticlePage({ params }: PageProps<'/help/[slug]'>) {
  const a = findArticle((await params).slug);
  if (!a) notFound();
  return (
    <article className="mx-auto max-w-2xl px-4 pt-12">
      <Link href="/help" className="font-semibold text-accent-strong">Help center</Link>
      <h1 className="mt-4 text-[34px] font-extrabold leading-tight">{a.title}</h1>
      <div className="mt-6 space-y-4 text-[17px] leading-relaxed">{a.body.map((p) => <p key={p}>{p}</p>)}</div>
    </article>
  );
}
