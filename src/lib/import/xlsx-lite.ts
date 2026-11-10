/**
 * A small, forgiving .xlsx reader used when exceljs can't read a workbook (files
 * from Google Sheets, Numbers or older tools sometimes trip it up). Reads every
 * visible tab's cell values as text, with dates as YYYY-MM-DD. No formulas are
 * evaluated: the cached value Excel saved is used, which is what we want.
 */
import JSZip from 'jszip';

export interface LiteSheet { name: string; rows: string[][] }

const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
const attr = (tag: string, name: string) => tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];
/** Text of every <t> inside a fragment (shared strings and inline strings, rich text included). */
const texts = (frag: string) => [...frag.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((m) => unescape(m[1])).join('');
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
const BUILTIN_DATE = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
function serialToDate(v: number): string {
  // Excel's 1900 date system (with its fake Feb 29, 1900); time of day dropped.
  const ms = Math.round((v - 25569) * 86_400_000);
  return new Date(ms).toISOString().slice(0, 10);
}

export async function readXlsxLite(data: ArrayBuffer | Uint8Array, maxRows = 20_000): Promise<LiteSheet[]> {
  const zip = await JSZip.loadAsync(data);
  const read = async (p: string) => (await zip.file(p)?.async('string')) ?? null;
  const wb = await read('xl/workbook.xml');
  if (!wb) throw new Error('not an Excel workbook');
  const rels = (await read('xl/_rels/workbook.xml.rels')) ?? '';
  const target = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id') ?? '', attr(m[0], 'Target') ?? '']));

  const sst = await read('xl/sharedStrings.xml');
  const shared = sst ? [...sst.matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((m) => texts(m[1])) : [];

  // Which cell styles are dates.
  const styles = (await read('xl/styles.xml')) ?? '';
  const customDate = new Set([...styles.matchAll(/<numFmt\b[^>]*>/g)]
    .filter((m) => /[dmy]/i.test((attr(m[0], 'formatCode') ?? '').replace(/"[^"]*"|\[[^\]]*\]/g, '')))
    .map((m) => Number(attr(m[0], 'numFmtId'))));
  const xfs = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? '';
  const dateStyle = [...xfs.matchAll(/<xf\b[^>]*\/?>/g)].map((m) => { const id = Number(attr(m[0], 'numFmtId') ?? 0); return BUILTIN_DATE.has(id) || customDate.has(id); });

  const out: LiteSheet[] = [];
  let total = 0;
  for (const m of wb.matchAll(/<(?:\w+:)?sheet\b[^>]*\/?>/g)) {
    const tag = m[0];
    const state = attr(tag, 'state');
    if (state === 'hidden' || state === 'veryHidden') continue;
    const rid = attr(tag, 'r:id') ?? attr(tag, 'id') ?? '';
    let path = target.get(rid) ?? '';
    if (!path) continue;
    path = path.startsWith('/') ? path.slice(1) : `xl/${path.replace(/^\.\//, '')}`;
    const xml = await read(path);
    if (!xml) continue;
    const rows: string[][] = [];
    for (const rm of xml.matchAll(/<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
      if (total >= maxRows + 1) break;
      const row: string[] = [];
      for (const cm of rm[1].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
        const a = cm[1], inner = cm[2] ?? '';
        const ref = attr(a, 'r');
        const i = ref ? colIndex(ref) : row.length;
        const t = attr(a, 't'), s = Number(attr(a, 's') ?? 0);
        const v = inner.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1];
        let val = '';
        if (t === 's') val = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') val = texts(inner);
        else if (t === 'str') val = unescape(v ?? '');
        else if (t === 'b') val = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
        else if (t === 'e') val = '';
        else if (v !== undefined) val = dateStyle[s] && !Number.isNaN(Number(v)) ? serialToDate(Number(v)) : unescape(v);
        while (row.length < i) row.push('');
        row[i] = val;
      }
      if (row.some((c) => c.trim() !== '')) { rows.push(row); total++; }
    }
    out.push({ name: unescape(attr(tag, 'name') ?? `Sheet${out.length + 1}`), rows });
  }
  return out;
}
