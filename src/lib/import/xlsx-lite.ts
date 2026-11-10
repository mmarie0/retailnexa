/**
 * A small, forgiving .xlsx reader used when exceljs can't read a workbook (files
 * from Google Sheets, Numbers or older tools sometimes trip it up). Reads every
 * visible tab's cell values as text, with dates as YYYY-MM-DD. No formulas are
 * evaluated: the cached value Excel saved is used.
 *
 * Hardened for untrusted files (#148, #150): one forward pass over each XML
 * part (no backtracking regexes), Excel's own limits on columns and rows, caps
 * on unpacked bytes and total cells, and a time budget.
 */
import JSZip from 'jszip';

export interface LiteSheet { name: string; rows: string[][] }
export class LiteLimitError extends Error {}

export const LITE_LIMITS = {
  maxColumns: 16_384,          // Excel's last column, XFD
  maxRowNumber: 1_048_576,     // Excel's last row
  maxCells: 2_000_000,
  maxPartBytes: 60 * 1024 * 1024, // one XML part, unpacked
  timeBudgetMs: 15_000,
};

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
function unescape(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]{1,8}|#[0-9]{1,10}|lt|gt|quot|apos|amp);/g, (_, e: string) => {
    if (e[0] !== '#') return ENTITIES[e];
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return Number.isInteger(n) && n >= 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
  });
}

interface Tag { name: string; attrs: string; close: boolean; selfClose: boolean; start: number; end: number }
/** Yields tags in order with one forward scan; `text(a, b)` reads what's between. */
function* tags(xml: string, deadline: number): Generator<Tag> {
  let i = 0, n = 0;
  for (;;) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) return;
    if ((++n & 0x3fff) === 0 && Date.now() > deadline) throw new LiteLimitError('took too long');
    if (xml.startsWith('<!--', lt)) { const e = xml.indexOf('-->', lt + 4); if (e < 0) return; i = e + 3; continue; }
    if (xml.startsWith('<![CDATA[', lt)) { const e = xml.indexOf(']]>', lt + 9); if (e < 0) return; i = e + 3; continue; }
    if (xml[lt + 1] === '?' || xml[lt + 1] === '!') { const e = xml.indexOf('>', lt + 1); if (e < 0) return; i = e + 1; continue; }
    const gt = xml.indexOf('>', lt + 1);
    if (gt < 0) return;
    let body = xml.slice(lt + 1, gt);
    const close = body.startsWith('/');
    if (close) body = body.slice(1);
    const selfClose = body.endsWith('/');
    if (selfClose) body = body.slice(0, -1);
    const sp = body.search(/[\s]/);
    const full = sp < 0 ? body : body.slice(0, sp);
    const name = full.includes(':') ? full.slice(full.indexOf(':') + 1) : full; // drop namespace prefixes
    yield { name, attrs: sp < 0 ? '' : body.slice(sp), close, selfClose, start: lt, end: gt + 1 };
    i = gt + 1;
  }
}
function attr(attrs: string, name: string): string | undefined {
  // Attributes are short; a bounded search is fine. Matches name="..." or prefix:name="...".
  const re = new RegExp(`(?:^|\\s)(?:[\\w-]+:)?${name}\\s*=\\s*"([^"]*)"`);
  return attrs.match(re)?.[1];
}

/** "AB12" → column index 27, or null when it's outside Excel's grid. */
export function colIndex(ref: string): number | null {
  let n = 0, k = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) { if (++k > 3) return null; n = n * 26 + (c - 64); }
    else if (c >= 97 && c <= 122) { if (++k > 3) return null; n = n * 26 + (c - 96); }
    else break;
  }
  return k === 0 || n > LITE_LIMITS.maxColumns ? null : n - 1;
}

const BUILTIN_DATE = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
function serialToDate(v: number): string | null {
  // Excel's 1900 date system; 1 = 1900-01-01 … 2958465 = 9999-12-31. Time of day dropped.
  if (!Number.isFinite(v) || v < 1 || v > 2_958_465) return null;
  return new Date(Math.round((v - 25569) * 86_400_000)).toISOString().slice(0, 10);
}

export async function readXlsxLite(data: ArrayBuffer | Uint8Array, maxRows = 20_000): Promise<LiteSheet[]> {
  const deadline = Date.now() + LITE_LIMITS.timeBudgetMs;
  const zip = await JSZip.loadAsync(data);
  const read = async (p: string) => {
    const f = zip.file(p);
    if (!f) return null;
    const size = (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (size !== undefined && size > LITE_LIMITS.maxPartBytes) throw new LiteLimitError('a part of the workbook is too large');
    const s = await f.async('string');
    if (s.length > LITE_LIMITS.maxPartBytes) throw new LiteLimitError('a part of the workbook is too large');
    return s;
  };
  const wb = await read('xl/workbook.xml');
  if (!wb) throw new Error('not an Excel workbook');

  const target = new Map<string, string>();
  for (const t of tags((await read('xl/_rels/workbook.xml.rels')) ?? '', deadline)) {
    if (t.name === 'Relationship' && !t.close) target.set(attr(t.attrs, 'Id') ?? '', attr(t.attrs, 'Target') ?? '');
  }

  // Shared strings: the text of every <t> inside each <si>.
  const shared: string[] = [];
  const sst = await read('xl/sharedStrings.xml');
  if (sst) {
    let cur: string[] | null = null, tStart = -1;
    for (const t of tags(sst, deadline)) {
      if (t.name === 'si') { if (!t.close) cur = []; else if (cur) { shared.push(cur.join('')); cur = null; } if (t.selfClose) shared.push(''); }
      else if (t.name === 't' && cur) { if (!t.close && !t.selfClose) tStart = t.end; else if (t.close && tStart >= 0) { cur.push(unescape(sst.slice(tStart, t.start))); tStart = -1; } }
    }
  }

  // Which cell styles are dates.
  const styles = (await read('xl/styles.xml')) ?? '';
  const customDate = new Set<number>();
  const dateStyle: boolean[] = [];
  let inXfs = false;
  for (const t of tags(styles, deadline)) {
    if (t.name === 'numFmt' && !t.close) {
      const code = (attr(t.attrs, 'formatCode') ?? '').replace(/"[^"]*"|\[[^\]]*\]/g, '');
      if (/[dmy]/i.test(unescape(code))) customDate.add(Number(attr(t.attrs, 'numFmtId')));
    } else if (t.name === 'cellXfs') inXfs = !t.close && !t.selfClose;
    else if (t.name === 'xf' && inXfs && !t.close) {
      const id = Number(attr(t.attrs, 'numFmtId') ?? 0);
      dateStyle.push(BUILTIN_DATE.has(id) || customDate.has(id));
    }
  }

  const out: LiteSheet[] = [];
  let totalRows = 0, totalCells = 0;
  for (const st of tags(wb, deadline)) {
    if (st.name !== 'sheet' || st.close) continue;
    const state = attr(st.attrs, 'state');
    if (state === 'hidden' || state === 'veryHidden') continue;
    let path = target.get(attr(st.attrs, 'id') ?? '') ?? '';
    if (!path || path.includes('..')) continue;
    path = path.startsWith('/') ? path.slice(1) : `xl/${path.replace(/^\.\//, '')}`;
    const xml = await read(path);
    if (xml === null) continue;

    const rows: string[][] = [];
    let row: string[] | null = null;
    let cell: { i: number; t?: string; s: number } | null = null;
    let vStart = -1, v: string | undefined, isText: string[] = [], tStart = -1;
    for (const t of tags(xml, deadline)) {
      if (t.name === 'row') {
        if (!t.close) {
          const r = Number(attr(t.attrs, 'r') ?? 0);
          if (r > LITE_LIMITS.maxRowNumber) throw new LiteLimitError('a row is past Excel’s last row');
          row = [];
          if (t.selfClose) row = null;
        } else if (row) {
          if (row.some((c) => c.trim() !== '')) { rows.push(row); totalRows++; }
          row = null;
          if (totalRows >= maxRows + 1) break;
        }
      } else if (t.name === 'c' && row) {
        if (!t.close) {
          const ref = attr(t.attrs, 'r');
          let i: number;
          if (ref) {
            const ci = colIndex(ref);
            if (ci === null) throw new LiteLimitError('a cell is past Excel’s last column (XFD)');
            i = ci;
          } else i = row.length;
          cell = { i, t: attr(t.attrs, 't'), s: Number(attr(t.attrs, 's') ?? 0) };
          v = undefined; isText = [];
          if (t.selfClose) cell = null;
        } else if (cell) {
          let val = '';
          const ty = cell.t;
          if (ty === 's') val = shared[Number(v)] ?? '';
          else if (ty === 'inlineStr') val = isText.join('');
          else if (ty === 'str') val = unescape(v ?? '');
          else if (ty === 'b') val = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
          else if (ty === 'e') val = '';
          else if (v !== undefined) val = (dateStyle[cell.s] && serialToDate(Number(v))) || unescape(v);
          totalCells += Math.max(1, cell.i - row.length + 1);
          if (totalCells > LITE_LIMITS.maxCells) throw new LiteLimitError('the workbook has too many cells');
          while (row.length < cell.i) row.push('');
          row[cell.i] = val;
          cell = null;
        }
      } else if (t.name === 'v' && cell) {
        if (!t.close && !t.selfClose) vStart = t.end; else if (t.close && vStart >= 0) { v = xml.slice(vStart, t.start); vStart = -1; }
      } else if (t.name === 't' && cell) {
        if (!t.close && !t.selfClose) tStart = t.end; else if (t.close && tStart >= 0) { isText.push(unescape(xml.slice(tStart, t.start))); tStart = -1; }
      }
    }
    out.push({ name: unescape(attr(st.attrs, 'name') ?? `Sheet${out.length + 1}`), rows });
    if (totalRows >= maxRows + 1) break;
  }
  return out;
}
