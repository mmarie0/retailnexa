'use client';
import { useMemo, useState, useTransition } from 'react';
import { Button, Field, FormMessage, Notice, Select } from '@/components/ui';
import { formatMoney } from '@/lib/billing/plans';
import { parseCsv } from '@/lib/sales/csv';
import { BANK_FIELDS, guessBankMapping, rowsToBankLines, type BankField, type BankMapping } from '@/lib/bank/import';
import { importBankStatement } from './actions';

export function StatementImporter() {
  const [file, setFile] = useState<{ name: string; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<BankMapping>({});
  const [flip, setFlip] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; message: string | null }>({ ok: false, message: null });
  const [pending, start] = useTransition();
  const preview = useMemo(() => (file ? rowsToBankLines(file.rows.slice(1), mapping, { flipSign: flip }) : null), [file, mapping, flip]);
  const ready = mapping.date !== undefined && mapping.description !== undefined && (mapping.amount !== undefined || mapping.moneyIn !== undefined || mapping.moneyOut !== undefined);
  const totals = preview ? preview.lines.reduce((a, l) => (l.amountCents > 0 ? { ...a, in: a.in + l.amountCents } : { ...a, out: a.out - l.amountCents }), { in: 0, out: 0 }) : null;

  async function onFile(f?: File) {
    setMsg({ ok: false, message: null }); setFile(null);
    if (!f) return;
    if (f.size > 3_000_000) return setMsg({ ok: false, message: 'That file is larger than 3 MB. Export a shorter date range.' });
    const rows = parseCsv(await f.text());
    if (rows.length < 2) return setMsg({ ok: false, message: 'That file has no data rows.' });
    setFile({ name: f.name, rows }); setMapping(guessBankMapping(rows[0]));
  }

  return (
    <div className="flex flex-col gap-4">
      <Field label="Bank statement (CSV)" htmlFor="bank-file" hint="From your bank’s website: download transactions as CSV.">
        <input id="bank-file" type="file" accept=".csv,.txt,text/csv" onChange={(e) => onFile(e.target.files?.[0])}
          className="text-[15px] file:mr-3 file:rounded-full file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:font-semibold file:text-indigo" />
      </Field>
      {file && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {BANK_FIELDS.map((f) => (
              <Field key={f.key} label={f.label + (f.required ? '' : ' (optional)')} htmlFor={`bm-${f.key}`}>
                <Select id={`bm-${f.key}`} value={mapping[f.key] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [f.key as BankField]: e.target.value === '' ? undefined : Number(e.target.value) }))}>
                  <option value="">— not in file —</option>
                  {file.rows[0].map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </Select>
              </Field>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[15px]"><input type="checkbox" checked={flip} onChange={(e) => setFlip(e.target.checked)} className="size-4 accent-[#3f63de]" />
            My bank shows money out as positive numbers (flip signs)</label>
          {!ready ? <Notice tone="warning">Match the date, description and an amount column.</Notice> : preview && totals && (
            <>
              <p className="text-[15px]"><strong>{preview.lines.length}</strong> lines · money in <strong className="num">{formatMoney(totals.in)}</strong> · money out <strong className="num">{formatMoney(totals.out)}</strong>
                {preview.errors.length > 0 && <> · <strong className="text-late">{preview.errors.length}</strong> skipped</>}</p>
              {preview.errors.length > 0 && <ul className="max-h-32 overflow-auto rounded-xl bg-late-soft px-4 py-2 text-sm text-late">{preview.errors.slice(0, 30).map((e) => <li key={e.line}>Line {e.line}: {e.message}</li>)}</ul>}
              <p className="text-sm text-muted">Check a deposit shows as money in. If not, tick “flip signs”.</p>
              <Button type="button" className="self-start" disabled={pending || !preview.lines.length} aria-busy={pending}
                onClick={() => start(async () => {
                  const r = await importBankStatement({ filename: file.name, lines: preview.lines });
                  setMsg({ ok: r.ok, message: r.message }); if (r.ok) setFile(null);
                })}>{pending ? 'Importing…' : `Import ${preview.lines.length} lines`}</Button>
            </>
          )}
        </>
      )}
      <FormMessage state={msg} />
    </div>
  );
}
