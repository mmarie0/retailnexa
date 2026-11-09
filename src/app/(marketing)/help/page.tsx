import type { Metadata } from 'next';
import { PageIntro } from '@/components/marketing/feature-grid';
import { HELP_ARTICLES } from '@/content/help';
import { HelpSearch } from './help-search';

export const metadata: Metadata = { title: 'Help center' };

export default function HelpPage() {
  return (
    <>
      <PageIntro title="Help center"><p>Short guides for setting up and running your account.</p></PageIntro>
      <div className="mx-auto max-w-6xl px-4"><HelpSearch articles={HELP_ARTICLES} /></div>
    </>
  );
}
