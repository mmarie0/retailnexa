'use client';
import { useState } from 'react';
import { Badge, Button, Card, Field, Notice, Select } from '@/components/ui';
import { parseCsv } from '@/lib/sales/csv';
import { planFromBackup, type ImportKind, type Row } from '@/lib/import/backup';
import { planFromSheet, SHEET_KINDS } from '@/lib/import/sheet';
import { planFromTables, TEMPLATE_CSV } from '@/lib/import/bundle';
import { readBundle } from '@/lib/import/read-bundle';
import { importChunk, type ChunkResult } from './actions';

type Source = 'retailnexa_backup' | 'csv';
type SheetKind = ImportKind | 'all';
interface Prepared { notes?: string[]; source: Source; fileName: string; rows: Partial<Record<ImportKind, Row[]>>; warnings: string[]; notYet: { name: string; count: number; why: string }[]; rowErrors: { line: number; message: string }[] }
type Tally = Record<string, { imported: number; skipped: number; failed: number; errors: { row: number; key?: string; error: string }[]; message?: string }>;

const ORDER: ImportKind[] = ['vendor', 'recurring', 'bill', 'sales_day', 'bank_line'];
const LABEL: Record<ImportKind, string> = { vendor: 'Vendors', recurring: 'Fixed costs', bill: 'Bills', sales_day: 'Sales days', bank_line: 'Bank lines' };
const CHUNK = 200;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/** Excel is read by the server route (size and zip-bomb limits live there). */
/**
 * Excel is read here in the browser first (no upload size limit: the hosting
 * platform refuses request bodies over ~4.5 MB with a 413). The server route is
 * only a fallback for small files the browser reader can't handle.
 */
async function excelSheets(name: string, data: Blob): Promise<{ name: string; rows: string[][] }[]> {
  const named = (sheets: { name: string; rows: string[][] }[]) =>
    // A tab's own name ("Bills", "Bank") decides what it holds; one-tab workbooks keep the file name.
    sheets.length === 1 ? [{ name, rows: sheets[0].rows }] : sheets.map((s) => ({ name: `${name} › ${s.name}`, rows: s.rows }));
  if (data.size > 50 * 1024 * 1024) throw new Error(`${name}: Excel files up to 50 MB. Split it or save it as CSV.`);
  const head = new Uint8Array(await data.slice(0, 4).arrayBuffer());
  if (head[0] === 0xd0 && head[1] === 0xcf) throw new Error(`${name}: this is an old .xls file (or it has a password). Open it in Excel and use Save As → Excel Workbook (.xlsx) or CSV.`);
  try {
    const { readXlsxLite } = await import('@/lib/import/xlsx-lite');
    const sheets = await readXlsxLite(await data.arrayBuffer(), 200_000, 6_000_000);
    if (sheets.some((s) => s.rows.length)) return named(sheets);
  } catch (e) {
    const { LiteLimitError } = await import('@/lib/import/xlsx-lite');
    if (e instanceof LiteLimitError) throw new Error(`${name}: can’t be read safely (${e.message}). Save it as CSV or split it.`);
    if (data.size > 4 * 1024 * 1024) throw new Error(`${name}: couldn’t be read. Open it in Excel and use Save As → CSV, then upload the CSV.`);
  }
  // The server can only take files under ~4 MB (#155).
  if (data.size > 4 * 1024 * 1024) throw new Error(`${name}: no data found in this workbook. Check it opens in Excel, or save it as CSV.`);
  const fd = new FormData(); fd.set('file', new File([data], name.split('/').pop() || 'sheet.xlsx'));
  const res = await fetch('/admin/import/xlsx', { method: 'POST', body: fd });
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  if (!isJson) throw new Error(res.redirected || res.status === 404
    ? 'Your admin session has ended. Sign in again (with your two-factor code), then try again.'
    : `${name}: the server couldn’t read it (error ${res.status}). Try again, or save it as CSV.`);
  const r = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; sheets?: { name: string; rows: string[][] }[]; message?: string };
  if (!r.ok || !r.sheets) throw new Error(`${name}: ${r.message ?? 'couldn’t be read'}`);
  return named(r.sheets);
}
const excelRows = async (name: string, data: Blob) => (await excelSheets(name, data))[0]?.rows ?? [];

export function ImportClient({ orgs }: { orgs: { id: string; name: string }[] }) {
  const [org, setOrg] = useState(orgs[0]?.id ?? '');
  const [source, setSource] = useState<Source>('csv');
  // "Everything" (the default) takes one sheet with a Type column, or a .zip of sheets and backups.
  const [kind, setKind] = useState<SheetKind>('all');
  const all = source === 'csv' && kind === 'all';
  const [file, setFile] = useState<File | null>(null);
  const [prep, setPrep] = useState<Prepared | null>(null);
  const [tally, setTally] = useState<Tally | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [store, setStore] = useState('');

  const reset = () => { setPrep(null); setTally(null); setChecked(false); setErr(null); };

  async function prepare(): Promise<Prepared | null> {
    if (!file) { setErr('Choose a file.'); return null; }
    try {
      if (all) {
        // Everything in one file: a .zip of sheets and/or the old app's backup, or one sheet with a Type column.
        const read = await readBundle(file, excelSheets);
        const plan = planFromTables(read.tables, { today: today() });
        const rows: Prepared['rows'] = { ...plan.rows };
        const warnings: string[] = [], notYet: Prepared['notYet'] = [];
        for (const b of read.backups) {
          const bp = planFromBackup(b.data, { today: today() });
          for (const k of ORDER) if (bp.rows[k]?.length) rows[k] = [...(rows[k] ?? []), ...bp.rows[k]!];
          warnings.push(...bp.warnings.map((w) => `${b.name}: ${w}`)); notYet.push(...bp.notYet);
        }
        if (read.skipped.length) warnings.push(`Skipped (not CSV, Excel or JSON): ${read.skipped.join(', ')}`);
        if (!ORDER.some((k) => rows[k]?.length) && plan.errors.length === 0) { setErr('Nothing to import was found in that file.'); return null; }
        return { source: read.backups.length && !read.tables.length ? 'retailnexa_backup' : 'csv', fileName: file.name, rows, warnings, notYet,
          rowErrors: plan.errors, notes: [...plan.notes, ...read.backups.map((b) => `${b.name}: old app backup`)] };
      }
      if (source === 'retailnexa_backup') {
        const plan = planFromBackup(JSON.parse(await file.text()), { today: today() });
        return { source, fileName: file.name, rows: plan.rows, warnings: plan.warnings, notYet: plan.notYet, rowErrors: [] };
      }
      let rows: string[][];
      if (/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
        rows = await excelRows(file.name, file);
      } else rows = parseCsv(await file.text());
      const plan = planFromSheet(kind as ImportKind, rows, { today: today() });
      return { source, fileName: file.name, rows: { [kind]: plan.rows }, warnings: [], notYet: [], rowErrors: plan.errors };
    } catch (e) {
      setErr(e instanceof SyntaxError ? 'That file isn’t valid JSON.' : e instanceof Error ? e.message : 'That file couldn’t be read.');
      return null;
    }
  }

  async function run(dryRun: boolean) {
    setErr(null);
    if (!org) { setErr('Choose a business.'); return; }
    // Reading a big workbook can take a while: say so and lock the buttons first (#155).
    setBusy('Reading the file…');
    await new Promise((r) => setTimeout(r, 0));
    const p = dryRun || !prep ? await prepare() : prep;
    if (!p) { setBusy(null); return; }
    setPrep(p);
    const t: Tally = {};
    for (const k of ORDER) {
      const rows = p.rows[k] ?? [];
      if (!rows.length) continue;
      t[k] = { imported: 0, skipped: 0, failed: 0, errors: [] };
      // Sales days belong to a store (#131): the chosen store goes on every row; the database
      // checks it exists and makes it part of each row's key.
      const send = k === 'sales_day' && store.trim() ? rows.map((r) => ({ ...r, location: store.trim() })) : rows;
      for (let i = 0; i < send.length; i += CHUNK) {
        setBusy(`${dryRun ? 'Checking' : 'Importing'} ${LABEL[k].toLowerCase()} ${Math.min(i + CHUNK, rows.length)} of ${rows.length}…`);
        const r: ChunkResult = await importChunk({ org, kind: k, source: p.source, fileName: p.fileName, dryRun, rows: send.slice(i, i + CHUNK) });
        if (!r.ok) { t[k].message = r.message; break; }
        t[k].imported += r.imported; t[k].skipped += r.skipped; t[k].failed += r.failed;
        t[k].errors.push(...r.errors.map((e) => ({ ...e, row: e.row ? e.row + i : e.row })));
        setTally({ ...t });
      }
    }
    setTally({ ...t }); setBusy(null); setChecked(dryRun);
  }

  const total = (k: keyof Tally[string]) => Object.values(tally ?? {}).reduce((a, x) => a + (typeof x[k] === 'number' ? (x[k] as number) : 0), 0);
  const orgName = orgs.find((o) => o.id === org)?.name ?? 'this business';

  return (
    <Card className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Business" htmlFor="imp-org">
          <Select id="imp-org" value={org} onChange={(e) => { setOrg(e.target.value); reset(); }}>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
        </Field>
        <Field label="What are you importing?" htmlFor="imp-src">
          <Select id="imp-src" value={source} onChange={(e) => { setSource(e.target.value as Source); reset(); }}>
            <option value="csv">Spreadsheets (.csv, .xlsx or a .zip of them)</option>
            <option value="retailnexa_backup">Old RetailNexa app backup (.json)</option>
          </Select>
        </Field>
        {source === 'csv' && (
          <Field label="This sheet has" htmlFor="imp-kind" hint={all ? 'Vendors, bills, sales, bank and fixed costs together: a “Type” column on each row, or a .zip with one sheet per kind.' : SHEET_KINDS.find((s) => s.kind === kind)?.columns}>
            <Select id="imp-kind" value={kind} onChange={(e) => { setKind(e.target.value as SheetKind); reset(); }}>
              <option value="all">Everything (all in one shot)</option>
              {SHEET_KINDS.map((s) => <option key={s.kind} value={s.kind}>Only {s.label.toLowerCase()}</option>)}
            </Select>
          </Field>
        )}
        {(source !== 'csv' || kind === 'all' || kind === 'sales_day') && (
          <Field label="Store for sales days" htmlFor="imp-store" hint="Type the store’s name exactly as it is in the business. Leave empty if the business has one store.">
            <input id="imp-store" value={store} maxLength={120} onChange={(e) => { setStore(e.target.value); reset(); }}
              className="w-full rounded-xl bg-soft px-3 py-2 text-[15px]" placeholder="Main store" />
          </Field>
        )}
        <Field label="File" htmlFor="imp-file" hint={all
          ? 'One .csv or .xlsx with a “Type” column, an .xlsx with one tab per kind (Vendors, Bills, Sales, Bank, Fixed costs), or a .zip of sheets and the old app backup.'
          : source === 'csv' ? 'One kind of record per sheet; the first row is the header.' : 'The backup downloaded from the old RetailNexa app.'}>
          <input id="imp-file" type="file" accept={all ? '.zip,.csv,.txt,.xlsx,.xlsm,.xls,.json' : source === 'csv' ? '.csv,.txt,.xlsx,.xlsm,.xls' : '.json,application/json'} onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset(); }}
            className="w-full rounded-xl bg-soft px-3 py-2 text-sm" />
        </Field>
      </div>

      {all && (
        <p className="text-sm text-muted">One sheet for everything: add a <b>Type</b> column (Vendor, Bill, Sales, Bank, Fixed cost) and the columns each type needs.{' '}
          <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE_CSV)}`} download="retailnexa-import-template.csv" className="font-semibold text-accent-strong">Download a template</a></p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={!!busy || !file} onClick={() => run(true)}>Check (nothing is saved)</Button>
        <Button type="button" disabled={!!busy || !checked} onClick={() => { if (confirm(`Import into ${orgName}? Rows already imported are skipped.`)) void run(false); }}>Import into {orgName}</Button>
      </div>
      {busy && <p className="text-sm text-muted" role="status">{busy}</p>}
      {err && <Notice tone="danger">{err}</Notice>}

      {prep && (prep.warnings.length > 0 || prep.notYet.length > 0 || prep.rowErrors.length > 0 || (prep.notes?.length ?? 0) > 0) && (
        <div className="flex flex-col gap-2 text-sm">
          {prep.rowErrors.slice(0, 20).map((e, i) => <p key={i} className="text-late">Line {e.line}: {e.message}</p>)}
          {prep.rowErrors.length > 20 && <p className="text-muted">+ {prep.rowErrors.length - 20} more lines with problems</p>}
          {prep.warnings.map((w) => <p key={w} className="text-soon">{w}</p>)}
          {prep.notes?.map((n) => <p key={n} className="text-muted">{n}</p>)}
          {prep.notYet.length > 0 && <p className="text-muted">Not imported yet: {prep.notYet.map((n) => `${n.count} ${n.why}`).join('; ')}.</p>}
        </div>
      )}

      {tally && (
        <div className="flex flex-col gap-3">
          <p className="font-bold">{checked ? 'Check result: nothing was saved' : 'Import finished'} · {total('imported')} {checked ? 'would import' : 'imported'} · {total('skipped')} already there · {total('failed')} with problems</p>
          <ul className="divide-y divide-line rounded-xl bg-soft text-sm">
            {ORDER.filter((k) => tally[k]).map((k) => (
              <li key={k} className="flex flex-col gap-1 px-3 py-2">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <strong>{LABEL[k]}</strong>
                  <span className="flex gap-1.5"><Badge tone="good">{tally[k].imported} ok</Badge>{tally[k].skipped > 0 && <Badge>{tally[k].skipped} skipped</Badge>}{tally[k].failed > 0 && <Badge tone="danger">{tally[k].failed} problems</Badge>}</span>
                </span>
                {tally[k].message && <span className="text-late">{tally[k].message}</span>}
                {tally[k].errors.slice(0, 10).map((e, i) => <span key={i} className="text-late">{e.key ? `${e.key}: ` : `Row ${e.row}: `}{e.error}</span>)}
                {tally[k].errors.length > 10 && <span className="text-muted">+ {tally[k].errors.length - 10} more</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
