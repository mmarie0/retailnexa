/**
 * Static contract test between application code and the database schema.
 *
 * Supabase calls are untyped strings at runtime; a typo in an RPC name, a
 * parameter name or a column only fails in production. This test scans every
 * source file for `.rpc('fn', { ... })` and `.from('table')...` chains and
 * checks them against the migrated test database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { closeDb, sys } from './helpers';

const ROOT = join(__dirname, '..', '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
}

interface Fn { name: string; args: string[]; required: string[] }
let functions: Map<string, Fn>;
let columns: Map<string, Set<string>>;
let userSelectable: Map<string, Set<string>>;
const sources = files(join(ROOT, 'src')).map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, 'utf8') }));

beforeAll(async () => {
  const fns = await sys<{ proname: string; argnames: string[] | null; nargs: number; ndefaults: number }>(`
    select p.proname, p.proargnames as argnames, p.pronargs as nargs, p.pronargdefaults as ndefaults
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`);
  functions = new Map(fns.map((f) => {
    const args = (f.argnames ?? []).slice(0, f.nargs);
    return [f.proname, { name: f.proname, args, required: args.slice(0, f.nargs - f.ndefaults) }];
  }));
  const cols = await sys<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns where table_schema = 'public'`);
  const granted = await sys<{ table_name: string; column_name: string }>(`
    select table_name, column_name from information_schema.columns
    where table_schema = 'public' and has_column_privilege('authenticated', format('public.%I', table_name), column_name, 'SELECT')`);
  userSelectable = new Map();
  for (const c of granted) {
    if (!userSelectable.has(c.table_name)) userSelectable.set(c.table_name, new Set());
    userSelectable.get(c.table_name)!.add(c.column_name);
  }
  columns = new Map();
  for (const c of cols) {
    if (!columns.has(c.table_name)) columns.set(c.table_name, new Set());
    columns.get(c.table_name)!.add(c.column_name);
  }
});
afterAll(closeDb);

/** Finds the balanced {...} starting at index i. */
function objectAt(text: string, i: number): string {
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}' && --depth === 0) return text.slice(i, j + 1);
  }
  return '';
}

/** Top-level keys of an object literal (ignores nested objects and ternaries). */
function topLevelKeys(obj: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  const body = obj.slice(1, -1);
  let token = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if ('{[('.includes(ch)) depth++;
    else if ('}])'.includes(ch)) depth--;
    if (depth === 0 && (ch === ',' || i === body.length - 1)) {
      const part = (ch === ',' ? token : token + ch).trim();
      const m = part.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(:|$)/);
      if (m) keys.push(m[1]);
      token = '';
    } else token += ch;
  }
  return keys;
}

describe('RPC calls match database functions', () => {
  const calls = sources.flatMap(({ path, text }) =>
    [...text.matchAll(/\.rpc\(\s*'([a-z_]+)'\s*(,\s*\{)?/g)].map((m) => ({
      path,
      name: m[1],
      keys: m[2] ? topLevelKeys(objectAt(text, m.index! + m[0].length - 1)) : [],
    })),
  );

  it('found the app’s RPC calls', () => {
    expect(calls.length).toBeGreaterThan(15);
  });

  it('every RPC exists and is called with valid, complete named arguments', () => {
    const problems: string[] = [];
    for (const c of calls) {
      const fn = functions.get(c.name);
      if (!fn) { problems.push(`${c.path}: unknown function ${c.name}`); continue; }
      for (const k of c.keys) if (!fn.args.includes(k)) problems.push(`${c.path}: ${c.name} has no parameter ${k} (has ${fn.args.join(', ')})`);
      for (const r of fn.required) if (!c.keys.includes(r)) problems.push(`${c.path}: ${c.name} call is missing required ${r}`);
    }
    expect(problems).toEqual([]);
  });
});

describe('table queries match database columns', () => {
  const chains = sources.flatMap(({ path, text }) =>
    // `.storage.from('bucket')` is a Storage bucket, not a table.
    [...text.matchAll(/([A-Za-z_]+(?:\(\))?)\s*\.from\(\s*'([a-z_]+)'\s*\)/g)].filter((m) => m[1] !== 'storage').map((m) => {
      const start = m.index! + m[0].length;
      // Service-role receivers bypass RLS and column grants; everything else runs as the signed-in user.
      const serviceRole = ['createAdminClient()', 'db', 'admin'].includes(m[1]);
      // The chain ends at the end of the statement (next ';' or a new .from()).
      const rest = text.slice(start);
      const end = Math.min(...[rest.indexOf(';'), rest.search(/\.from\(/)].filter((n) => n >= 0), rest.length);
      return { path, table: m[2], chain: rest.slice(0, end), serviceRole };
    }),
  );

  function selectColumns(sel: string): { table: string | null; col: string }[] {
    const out: { table: string | null; col: string }[] = [];
    let depth = 0, token = '';
    const flush = () => {
      const t = token.trim();
      token = '';
      if (!t || t === '*') return;
      const embed = t.match(/^([a-z_]+)(![a-z_]+)?\s*\(([\s\S]*)\)$/);
      if (embed) {
        for (const c of selectColumns(embed[3])) out.push({ table: embed[1], col: c.col });
        return;
      }
      out.push({ table: null, col: t.split(':').pop()!.trim() });
    };
    for (const ch of sel) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) flush();
      else token += ch;
    }
    flush();
    return out;
  }

  it('found the app’s table queries', () => {
    expect(chains.length).toBeGreaterThan(30);
  });

  it('every table, selected column and filtered column exists', () => {
    const problems: string[] = [];
    for (const c of chains) {
      const tableCols = columns.get(c.table);
      if (!tableCols) { problems.push(`${c.path}: unknown table ${c.table}`); continue; }
      for (const s of c.chain.matchAll(/\.select\(\s*'([^']*)'/g)) {
        if (!c.serviceRole) {
          const allowed = userSelectable.get(c.table) ?? new Set();
          const wanted = s[1].trim() === '*' ? [...tableCols] : selectColumns(s[1]).filter((x) => !x.table).map((x) => x.col);
          for (const col of wanted) if (tableCols.has(col) && !allowed.has(col)) problems.push(`${c.path}: signed-in users cannot read ${c.table}.${col} (column not granted) — use explicit allowed columns or the server-side client`);
        }
        for (const { table, col } of selectColumns(s[1])) {
          const set = table ? columns.get(table) : tableCols;
          if (!set) problems.push(`${c.path}: unknown embedded table ${table}`);
          else if (!set.has(col)) problems.push(`${c.path}: ${table ?? c.table}.${col} does not exist`);
        }
      }
      for (const f of c.chain.matchAll(/\.(eq|neq|is|in|lt|lte|gt|gte|ilike|order|not)\(\s*'([a-z_]+)'/g)) {
        if (!tableCols.has(f[2])) problems.push(`${c.path}: filter on ${c.table}.${f[2]} which does not exist`);
      }
      const ins = c.chain.match(/\.(insert|update)\(\s*\{/);
      if (ins) {
        const keys = topLevelKeys(objectAt(c.chain, ins.index! + ins[0].length - 1));
        for (const k of keys) if (!tableCols.has(k)) problems.push(`${c.path}: ${ins[1]} writes ${c.table}.${k} which does not exist`);
      }
    }
    expect(problems).toEqual([]);
  });
});
