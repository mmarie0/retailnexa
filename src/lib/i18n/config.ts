/**
 * Languages. English text is the key: t('Create order') looks up the Arabic
 * and falls back to the English when a phrase isn't translated yet. A unit
 * test (i18n.test.ts) fails if a t('…') phrase in the code has no Arabic.
 */
export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];
export const LANG_COOKIE = 'rn_lang';
export const isLocale = (v: unknown): v is Locale => LOCALES.includes(v as Locale);
export const dirOf = (l: Locale) => (l === 'ar' ? 'rtl' : 'ltr');
export const LANGUAGE_NAMES: Record<Locale, string> = { en: 'English', ar: 'العربية' };

export type Vars = Record<string, string | number>;
export type Dict = Record<string, string>;
export type T = (text: string, vars?: Vars) => string;

/** Build t() for a dictionary: lookup, then fill {name} placeholders. */
export function makeT(dict: Dict | null): T {
  return (text, vars) => {
    let out = (dict && dict[text]) || text;
    if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
    return out;
  };
}
