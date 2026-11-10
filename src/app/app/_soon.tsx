import { Block } from '@/components/ui';

/** Placeholder for a section of the RetailNexa app that isn't built here yet. */
export function ComingSoon({ title, intro, items, tracking }: { title: string; intro: string; items: string[]; tracking: string }) {
  return (
    <>
      <Block tone="sunset" className="flex flex-col gap-1.5">
        <span className="eyebrow text-[11px] font-semibold uppercase tracking-[.08em]">Coming soon</span>
        <h1 className="text-[26px] font-extrabold tracking-[-.02em]">{title}</h1>
        <p className="text-[14px] text-white/90">{intro}</p>
      </Block>
      <div className="overflow-hidden rounded-[18px] bg-card shadow-[var(--shadow-card)]">
        {items.map((t, i) => (
          <p key={t} className={`px-3.5 py-3 text-[15px] ${i ? 'border-t border-soft' : ''}`}>{t}</p>
        ))}
      </div>
      <p className="text-[13px] text-muted">Being built now ({tracking}). It will appear here when it’s ready.</p>
    </>
  );
}
