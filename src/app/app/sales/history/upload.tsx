'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Select } from '@/components/ui';
import { parseCsv } from '@/lib/sales/csv';
import { parseCategorySheet, parseMonthSheet } from '@/lib/sales/history';
import { importSalesMonths, saveCategoryReport } from './actions';

/** Reads a CSV or Excel file in the browser (first tab) and returns its rows. */
async function readSheet(file: File): Promise<string[][]> {
  if (file.size > 20 * 1024 * 1024) throw new Error('Files up to 20 MB.');
  if (/\.(xlsx|xlsm)$/i.test(file.name)) {
    const { readXlsxLite } = await import('@/lib/import/xlsx-lite');
    const sheets = await readXlsxLite(await file.arrayBuffer(), 50_000);
    return sheets.find((s) => s.rows.length)?.rows ?? [];
  }
  if (/\.xls$/i.test(file.name)) throw new Error('Old .xls files can’t be read. Save it as .xlsx or CSV.');
  return parseCsv(await file.text());
}

export function MonthUpload({ stores, today }: { stores: { id: string; name: string }[]; today: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [store, setStore] = useState(stores.length === 1 ? stores[0].id : '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  async function go(f: File | undefined) {
    if (!f) return;
    setBusy(true); setMsg(null);
    try {
      const { rows, errors } = parseMonthSheet(await readSheet(f), today);
      if (!rows.length) { setMsg({ ok: false, text: errors.length ? errors.slice(0, 8).map((e) => `Line ${e.line}: ${e.message}`) : ['No months found.'] }); return; }
      const r = await importSalesMonths({ location: store || null, rows });
      setMsg({ ok: r.ok && !errors.length, text: [`Saved ${r.saved} month${r.saved === 1 ? '' : 's'}.`, ...errors.slice(0, 5).map((e) => `Line ${e.line}: ${e.message}`), ...r.errors.slice(0, 5)] });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: [e instanceof Error ? e.message : 'That file couldn’t be read.'] });
    } finally { setBusy(false); if (ref.current) ref.current.value = ''; }
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {stores.length > 1 && <Select aria-label="Store" value={store} onChange={(e) => setStore(e.target.value)} className="w-auto"><option value="">Choose a store…</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}
        <input ref={ref} type="file" accept=".csv,.txt,.xlsx,.xlsm" className="sr-only" onChange={(e) => void go(e.target.files?.[0])} />
        <Button type="button" variant="secondary" disabled={busy || (stores.length > 1 && !store)} onClick={() => ref.current?.click()}>{busy ? 'Reading…' : 'Upload monthly reports'}</Button>
      </div>
      <p className="text-xs text-muted">Columns: Month, Sales, Gross, Tax, Cash, Card, Store card, Points, Transactions. One row per month; a month already there is replaced.</p>
      {msg && <div role="status" className={msg.ok ? 'text-sm text-paid' : 'text-sm text-late'}>{msg.text.map((t) => <p key={t}>{t}</p>)}</div>}
    </div>
  );
}

export function CategoryUpload({ stores, month }: { stores: { id: string; name: string }[]; month: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [store, setStore] = useState(stores.length === 1 ? stores[0].id : '');
  const [m, setM] = useState(month);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function go(f: File | undefined) {
    if (!f) return;
    setBusy(true); setMsg(null);
    try {
      const { rows, errors } = parseCategorySheet(await readSheet(f));
      if (!rows.length) { setMsg({ ok: false, text: errors[0]?.message ?? 'No categories found.' }); return; }
      const r = await saveCategoryReport({ location: store || null, month: m, rows });
      setMsg({ ok: r.ok, text: r.message + (errors.length ? ` ${errors.length} line${errors.length === 1 ? '' : 's'} skipped.` : '') });
      if (r.ok) router.push(`/app/sales/categories?m=${m}`);
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'That file couldn’t be read.' });
    } finally { setBusy(false); if (ref.current) ref.current.value = ''; }
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input type="month" aria-label="Month of the report" value={m} onChange={(e) => setM(e.target.value)} className="rounded-xl bg-soft px-3 py-2 text-[15px]" />
        {stores.length > 1 && <Select aria-label="Store" value={store} onChange={(e) => setStore(e.target.value)} className="w-auto"><option value="">Choose a store…</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}
        <input ref={ref} type="file" accept=".csv,.txt,.xlsx,.xlsm" className="sr-only" onChange={(e) => void go(e.target.files?.[0])} />
        <Button type="button" disabled={busy || !/^\d{4}-\d{2}$/.test(m) || (stores.length > 1 && !store)} onClick={() => ref.current?.click()}>{busy ? 'Reading…' : 'Upload category report'}</Button>
      </div>
      <p className="text-xs text-muted">Columns: Category (or Department) and Sales; Qty is optional. Uploading the same month again replaces it.</p>
      {msg && <p role="status" className={msg.ok ? 'text-sm text-paid' : 'text-sm text-late'}>{msg.text}</p>}
    </div>
  );
}
