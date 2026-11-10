/**
 * Legal pages. The text below is a starting template written for review by the
 * owner's attorney before public launch (tracked in docs/PROJECT_STATUS.md).
 */
export function LegalPage({ title, updated, sections }: { title: string; updated: string; sections: { heading: string; body: string[] }[] }) {
  return (
    <article className="mx-auto max-w-2xl px-4 pt-12">
      <h1 className="text-[36px] font-extrabold leading-tight">{title}</h1>
      <p className="mt-2 text-muted">Last updated {updated}</p>
      {sections.map((s) => (
        <section key={s.heading} className="mt-8">
          <h2 className="text-xl font-bold">{s.heading}</h2>
          <div className="mt-2 space-y-3 leading-relaxed">{s.body.map((p) => <p key={p}>{p}</p>)}</div>
        </section>
      ))}
    </article>
  );
}
