import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AR } from './ar';
import { makeT } from './config';
import { allTsx, untranslatedText } from './scan';
import NOT_YET from './not-yet-arabic.json';
import { AREAS, BILLS_MORE, BOTTOM } from '../../app/app/nav';

/** Every literal t('…') phrase in the app, read from the source files. */
function phrases(): Set<string> {
  const out = new Set<string>();
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) {
        const s = fs.readFileSync(p, 'utf8');
        for (const m of s.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) out.add(m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
      }
    }
  };
  walk(path.join(process.cwd(), 'src'));
  return out;
}

describe('Arabic', () => {
  it('has a translation for every t() phrase in the code', () => {
    const missing = [...phrases()].filter((k) => !(k in AR));
    expect(missing).toEqual([]);
  });
  it('translates every menu name', () => {
    const labels = [...AREAS.flatMap((a) => [a.label, ...Object.values(a.labelFor ?? {}), ...a.pages.map((p) => p.label)]), ...BILLS_MORE.map((p) => p.label)];
    expect(labels.filter((l) => !(l in AR))).toEqual([]);
    expect(Object.keys(BOTTOM)).toEqual(['retail', 'wholesale', 'both']);
  });
  it('keeps every {placeholder} in the translation', () => {
    // A placeholder glued to a word ("bill{v1}") is an English plural ending and may be dropped in Arabic.
    const lost = Object.entries(AR).filter(([en, ar]) => (en.match(/\{\w+\}/g) ?? []).some((v) => !en.match(new RegExp(`[A-Za-z]\\${v}`)) && !ar.includes(v)));
    expect(lost.map(([en]) => en)).toEqual([]);
  });
  it('fills placeholders and falls back to English', () => {
    const t = makeT(AR);
    expect(t('{n}% off', { n: 5 })).toBe('خصم 5%');
    expect(t('Not translated yet')).toBe('Not translated yet');
    expect(makeT(null)('{v0} free', { v0: 3 })).toBe('3 free');
  });

  it('every screen outside the not-yet list shows its text through t() (new pages included)', () => {
    const waiting = new Set<string>(NOT_YET);
    const problems = allTsx().filter((f) => !f.startsWith('src/demo/') && !waiting.has(f))
      .flatMap((f) => untranslatedText(f).map((x) => `${f}:${x}`));
    // Wrap the text in t('…') and add its Arabic to src/lib/i18n/ar.ts.
    expect(problems).toEqual([]);
  });
  it('the not-yet list only shrinks: files listed there still have English and still exist', () => {
    const done = (NOT_YET as string[]).filter((f) => !allTsx().includes(f) || untranslatedText(f).length === 0);
    // Remove these from src/lib/i18n/not-yet-arabic.json.
    expect(done).toEqual([]);
  });
});
