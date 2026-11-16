import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** Text attributes people read; their literal values must go through t(). */
const TEXT_ATTRS = new Set(['label', 'title', 'description', 'placeholder', 'hint', 'aria-label', 'pendingText', 'summary', 'footnote', 'sub', 'alt']);
const words = (s: string) => /[A-Za-z]{2,}/.test(s);

/** English shown on screen without t(): JSX text, and literal text attributes. Returns "line: text" entries. */
export function untranslatedText(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const at = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (n: ts.Node) => {
    if (n.kind === ts.SyntaxKind.JsxText && words(n.getText(sf)) && n.getText(sf).trim()) out.push(`${at(n)}: ${n.getText(sf).trim().slice(0, 60)}`);
    if (ts.isJsxAttribute(n) && n.initializer && ts.isStringLiteral(n.initializer) && TEXT_ATTRS.has(n.name.getText(sf)) && words(n.initializer.text)) out.push(`${at(n)}: ${n.initializer.text.slice(0, 60)}`);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Every .tsx file under src (paths relative to the project, with forward slashes). */
export function allTsx(root = 'src'): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.tsx') && !e.name.includes('.test.')) out.push(p.split(path.sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}
