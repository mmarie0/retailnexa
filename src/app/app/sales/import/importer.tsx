'use client';
import { useMemo, useState, useTransition } from 'react';
import { Button, Field, Notice, Select, cx } from '@/components/ui';
import { formatMoney } from '@/lib/billing/plans';
import { parseCsv } from '@/lib/sales/csv';
import { SALES_FIELDS, guessMapping, rowsToSalesDays, type Mapping, type SalesDayRow, type SalesField } from '@/lib/sales/import';
import { looksLikeVelaSummary, parseVelaSummary } from '@/lib/sales/vela';
import { importSalesDays, type ImportResult } from '../actions';

type Loc = { id: string; label: string };
const MAX_BYTES = 2_000_000;

export function SalesImporter({ locations, timeZone }: { locations: Loc[]; timeZone?: string }) {
  const [file, setFile] = useState<{ name: string; rows: string[][] } | null>(null);
  // Vela "Sales Summary" exports: one day per file, several files at once (#39).
  const [vela, setVela] = useState<{ names: string; days: SalesDayRow[]; problems: { file: string; message: string }[] } | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [source, setSource] = useState<'vela' | 'csv'>('vela');
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();

  const headers = file?.rows[0] ?? [];
  const preview = useMemo(() => (file ? rowsToSalesDays(file.rows.slice(1), mapping, 2, { timeZone }) : null), [file, mapping, timeZone]);
  const missing = SALES_FIELDS.filter((f) => f.required && mapping[f.key] === undefined);
  const noTender = mapping.cash === undefined && mapping.card === undefined && mapping.credit === undefined;

  async function onFiles(list: FileList | null) {
    setResult(null); setReadError(null); setFile(null); setVela(null);
    const files = Array.from(list ?? []);
    if (!files.length) return;
    if (files.some((f) => f.size > MAX_BYTES)) return setReadError('A file is larger than 2 MB. Export a shorter date range.');
    const texts = await Promise.all(files.map((f) => f.text()));
    if (texts.some(looksLikeVelaSummary)) {
      const days: SalesDayRow[] = [];
      const problems: { file: string; message: string }[] = [];
      texts.forEach((t, i) => {
        const r = parseVelaSummary(t, { timeZone, line: i + 1 });
        r.errors.forEach((message) => problems.push({ file: files[i].name, message }));
        r.warnings.forEach((message) => problems.push({ file: files[i].name, message: `Note: ${message}` }));
        if (r.day) days.push(r.day);
      });
      const seen = new Set<string>();
      const unique = days.filter((d) => {
        if (seen.has(d.businessDate)) { problems.push({ file: d.businessDate, message: 'The same day appears in two files; only the first is used.' }); return false; }
        seen.add(d.businessDate); return true;
      });
      setSource('vela');
      setVela({ names: files.map((f) => f.name).join(', ').slice(0, 200), days: unique.sort((a, b) => a.businessDate.localeCompare(b.businessDate)), problems });
      return;
    }
    if (files.length > 1) return setReadError('Choose one CSV at a time, or several Vela “Sales Summary” exports.');
    const f = files[0];
    const rows = parseCsv(texts[0]);
    if (rows.length < 2) return setReadError('That file has no data rows. Export it as CSV with a header row.');
    setFile({ name: f.name, rows });
    setMapping(guessMapping(rows[0]));
  }

  function submitVela() {
    if (!vela) return;
    start(async () => {
      setResult(await importSalesDays({ locationId, source: 'vela', filename: vela.names, rows: vela.days }));
    });
  }

  function submit() {
    if (!preview || !file) return;
    start(async () => {
      setResult(await importSalesDays({ locationId, source, filename: file.name, rows: preview.days }));
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="CSV file" htmlFor="file" hint="One row per register per day.">
          <input id="file" type="file" multiple accept=".csv,.txt,.xls,.htm,.html,text/csv" onChange={(e) => onFiles(e.target.files)}
            className="text-[15px] file:mr-3 file:rounded-full file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:font-semibold file:text-indigo" />
        </Field>
        <Field label="Store" htmlFor="loc">
          <Select id="loc" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </Select>
        </Field>
        <Field label="Exported from" htmlFor="src">
          <Select id="src" value={source} onChange={(e) => setSource(e.target.value as 'vela' | 'csv')}>
            <option value="vela">Vela POS</option><option value="csv">Other / spreadsheet</option>
          </Select>
        </Field>
      </div>
      {readError && <Notice tone="danger">{readError}</Notice>}

      {vela && (
        <div className="flex flex-col gap-3">
          <p className="text-[15px]">Vela Sales Summary: <strong>{vela.days.length}</strong> day{vela.days.length === 1 ? '' : 's'} ready, recorded as the whole store (“All registers”).</p>
          {vela.problems.length > 0 && (
            <ul className="max-h-40 overflow-auto rounded-xl bg-soon-soft px-4 py-2 text-sm text-soon">
              {vela.problems.map((p, i) => <li key={i}><strong>{p.file}:</strong> {p.message}</li>)}
            </ul>
          )}
          {vela.days.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-soft text-left text-muted"><tr>
                  <th className="px-3 py-2">Date</th><th className="px-3 text-right">Gross</th><th className="px-3 text-right">Discounts + returns</th>
                  <th className="px-3 text-right">Tax</th><th className="px-3 text-right">Cash</th><th className="px-3 text-right">Card</th><th className="px-3 text-right">Credit</th><th className="px-3 text-right">Txns</th>
                </tr></thead>
                <tbody>
                  {vela.days.map((d) => (
                    <tr key={d.businessDate} className="border-t border-line">
                      <td className="px-3 py-1.5">{d.businessDate}</td>
                      {[d.grossCents, d.discountsCents, d.taxCents, d.cashCents, d.cardCents, d.creditCents].map((c, i) => <td key={i} className="num px-3 text-right">{formatMoney(c)}</td>)}
                      <td className="num px-3 text-right">{d.transactions ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Button type="button" className="self-start" disabled={pending || !vela.days.length || !locationId} aria-busy={pending} onClick={submitVela}>
            {pending ? 'Importing…' : `Import ${vela.days.length} day${vela.days.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      )}

      {file && (
        <>
          <fieldset className="rounded-xl border border-line p-4">
            <legend className="px-1 text-sm font-semibold">Match your columns</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {SALES_FIELDS.map((f) => (
                <Field key={f.key} label={f.label + (f.required ? '' : ' (optional)')} htmlFor={`map-${f.key}`}>
                  <Select id={`map-${f.key}`} value={mapping[f.key] ?? ''}
                    onChange={(e) => setMapping((m) => ({ ...m, [f.key as SalesField]: e.target.value === '' ? undefined : Number(e.target.value) }))}>
                    <option value="">— not in file —</option>
                    {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </Select>
                </Field>
              ))}
            </div>
          </fieldset>

          {missing.length > 0 || noTender ? (
            <Notice tone="warning">Match {[...missing.map((f) => f.label), ...(noTender ? ['at least one payment column (cash, card or store credit)'] : [])].join(', ')}.</Notice>
          ) : preview && (
            <>
              <p className="text-[15px]"><strong>{preview.days.length}</strong> day{preview.days.length === 1 ? '' : 's'} ready
                {preview.errors.length > 0 && <>, <strong className="text-late">{preview.errors.length}</strong> row{preview.errors.length === 1 ? '' : 's'} with problems (they won’t be imported)</>}.</p>
              {preview.errors.length > 0 && (
                <ul className="max-h-40 overflow-auto rounded-xl bg-late-soft px-4 py-2 text-sm text-late">
                  {preview.errors.slice(0, 50).map((e) => <li key={e.line}>Line {e.line}: {e.message}</li>)}
                </ul>
              )}
              {preview.days.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-line">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="bg-soft text-left text-muted"><tr>
                      <th className="px-3 py-2">Date</th><th className="px-3">Register</th><th className="px-3 text-right">Gross</th><th className="px-3 text-right">Discounts</th>
                      <th className="px-3 text-right">Tax</th><th className="px-3 text-right">Cash</th><th className="px-3 text-right">Card</th><th className="px-3 text-right">Credit</th>
                    </tr></thead>
                    <tbody>
                      {preview.days.slice(0, 20).map((d) => (
                        <tr key={d.line} className="border-t border-line">
                          <td className="px-3 py-1.5">{d.businessDate}</td><td className="px-3">{d.register}</td>
                          {[d.grossCents, d.discountsCents, d.taxCents, d.cashCents, d.cardCents, d.creditCents].map((c, i) =>
                            <td key={i} className="num px-3 text-right">{formatMoney(c)}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {preview.days.length > 20 && <p className="px-3 py-2 text-sm text-muted">…and {preview.days.length - 20} more.</p>}
                </div>
              )}
              <Button type="button" className="self-start" disabled={pending || !preview.days.length || !locationId} aria-busy={pending} onClick={submit}>
                {pending ? 'Importing…' : `Import ${preview.days.length} day${preview.days.length === 1 ? '' : 's'}`}
              </Button>
            </>
          )}
        </>
      )}

      {result && (
        <div className={cx('rounded-xl px-4 py-3 text-[15px]', result.ok && !result.failed.length ? 'bg-paid-soft text-paid' : 'bg-soon-soft text-soon')} role="status">
          <p className="font-semibold">{result.message}</p>
          {result.failed.length > 0 && <ul className="mt-1 text-sm">{result.failed.slice(0, 50).map((f) => <li key={f.line}>Line {f.line}: {f.message}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}
