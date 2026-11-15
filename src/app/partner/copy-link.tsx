'use client';
import { useState } from 'react';
import { useT } from '@/lib/i18n/client';

/** The agent's referral link with a Copy button. */
export function CopyLink({ url }: { url: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <div className="flex gap-2">
      <input readOnly value={url} aria-label={t('Your referral link')} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 rounded-[12px] border border-line bg-card px-3 py-2 font-mono text-sm" />
      <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(url); setDone(true); setTimeout(() => setDone(false), 2000); } catch { /* clipboard blocked */ } }}
        className="rounded-[12px] bg-accent px-4 py-2 text-sm font-semibold text-on-accent">{done ? t('Copied') : t('Copy')}</button>
    </div>
  );
}
