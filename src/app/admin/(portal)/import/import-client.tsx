'use client';
import { useState } from 'react';
import { Badge, Button, Card, Field, Notice, Select } from '@/components/ui';
import { parseCsv } from '@/lib/sales/csv';
import { planFromBackup, type ImportKind, type Row } from '@/lib/import/backup';
import { planFromSheet, SHEET_KINDS } from '@/lib/import/sheet';
import { importChunk, readExcel, type ChunkResult } from './actions';

type Source = 'retailnexa_backup' | 'csv';
interface Prepared { source: Source; fileName: string; rows: Partial<Record<ImportKind, Row[]>>; warnings: string[]; notYet: { name: string; count: number; why: string }[]; rowErrors: { line: number; message: string }[] }
type Tally = Record<string, { imported: number; skipped: number; failed: number; errors: { row: number; key?: string; error: string }[]; message?: string }>;

const ORDER: ImportKind[] = ['vendor', 'recurring', 'bill', 'sales_day', 'bank_line'];
const LABEL: Record<ImportKind, string> = { vendor: 'Vendors', recurring: 'Fixed costs', bill: 'Bills', sales_day: 'Sales days', bank_line: 'Bank lines' };
const CHUNK = 200;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

export function ImportClient({ orgs }: { orgs: { id: string; name: string }[] }) {
  const [org, setOrg] = useState(orgs[0]?.id ?? '');
  const [source, setSource] = useState<Source>('retailnexa_backup');
  const [kind, setKind] = useState<ImportKind>('bill');
  const [file, setFile] = useState<File | null>(null);
  const [prep, setPrep] = useState<Prepared | null>(null);
  const [tally, setTally] = useState<Tally | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reset = () => { setPrep(null); setTally(null); setChecked(false); setErr(null); };

  async function prepare(): Promise<Prepared | null> {
    if (!file) { setErr('Choose a file.'); return null; }
    try {
      if (source === 'retailnexa_backup') {
        const plan = planFromBackup(JSON.parse(await file.text()), { today: today() });
        return { source, fileName: file.name, rows: plan.rows, warnings: plan.warnings, notYet: plan.notYet, rowErrors: [] };
      }
      let rows: string[][];
      if (/\.xlsx$/i.test(file.name)) {
        const fd = new FormData(); fd.set('file', file);
        const r = await readExcel(fd);
        if (!r.ok || !r.rows) { setErr(r.message ?? 'That file couldn’t be read.'); return null; }
        rows = r.rows;
      } else rows = parseCsv(await file.text());
      const plan = planFromSheet(kind, rows, { today: today() });
      return { source, fileName: file.name, rows: { [kind]: plan.rows }, warnings: [], notYet: [], rowErrors: plan.errors };
    } catch (e) {
      setErr(e instanceof SyntaxError ? 'That file isn’t valid JSON.' : e instanceof Error ? e.message : 'That file couldn’t be read.');
      return null;
    }
  }

  async function run(dryRun: boolean) {
    setErr(null);
    if (!org) { setErr('Choose a business.'); return; }
    const p = dryRun || !prep ? await prepare() : prep;
    if (!p) return;
    setPrep(p);
    const t: Tally = {};
    for (const k of ORDER) {
      const rows = p.rows[k] ?? [];
      if (!rows.length) continue;
      t[k] = { imported: 0, skipped: 0, failed: 0, errors: [] };
      for (let i = 0; i < rows.length; i += CHUNK) {
        setBusy(`${dryRun ? 'Checking' : 'Importing'} ${LABEL[k].toLowerCase()} ${Math.min(i + CHUNK, rows.length)} of ${rows.length}…`);
        const r: ChunkResult = await importChunk({ org, kind: k, source: p.source, fileName: p.fileName, dryRun, rows: rows.slice(i, i + CHUNK) });
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
            <option value="retailnexa_backup">Old RetailNexa app backup (.json)</option>
            <option value="csv">Spreadsheet (.csv or .xlsx)</option>
          </Select>
        </Field>
        {source === 'csv' && (
          <Field label="This sheet has" htmlFor="imp-kind" hint={SHEET_KINDS.find((s) => s.kind === kind)?.columns}>
            <Select id="imp-kind" value={kind} onChange={(e) => { setKind(e.target.value as ImportKind); reset(); }}>
              {SHEET_KINDS.map((s) => <option key={s.kind} value={s.kind}>{s.label}</option>)}
            </Select>
          </Field>
        )}
        <Field label="File" htmlFor="imp-file" hint={source === 'csv' ? 'One kind of record per sheet; the first row is the header.' : 'The backup downloaded from the old RetailNexa app.'}>
          <input id="imp-file" type="file" accept={source === 'csv' ? '.csv,.txt,.xlsx' : '.json,application/json'} onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset(); }}
            className="w-full rounded-xl bg-soft px-3 py-2 text-sm" />
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={!!busy || !file} onClick={() => run(true)}>Check (nothing is saved)</Button>
        <Button type="button" disabled={!!busy || !checked} onClick={() => { if (confirm(`Import into ${orgName}? Rows already imported are skipped.`)) void run(false); }}>Import into {orgName}</Button>
      </div>
      {busy && <p className="text-sm text-muted" role="status">{busy}</p>}
      {err && <Notice tone="danger">{err}</Notice>}

      {prep && (prep.warnings.length > 0 || prep.notYet.length > 0 || prep.rowErrors.length > 0) && (
        <div className="flex flex-col gap-2 text-sm">
          {prep.rowErrors.slice(0, 20).map((e) => <p key={e.line} className="text-late">Line {e.line}: {e.message}</p>)}
          {prep.rowErrors.length > 20 && <p className="text-muted">+ {prep.rowErrors.length - 20} more lines with problems</p>}
          {prep.warnings.map((w) => <p key={w} className="text-soon">{w}</p>)}
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
