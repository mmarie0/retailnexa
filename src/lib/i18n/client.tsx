'use client';
import { createContext, useContext, useMemo } from 'react';
import { makeT, type Dict, type Locale, type T } from './config';

const Ctx = createContext<{ locale: Locale; t: T }>({ locale: 'en', t: makeT(null) });

/** Gives client components t() for the current language (dictionary passed from the server). */
export function I18nProvider({ locale, dict, children }: { locale: Locale; dict: Dict | null; children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, t: makeT(dict) }), [locale, dict]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useT = () => useContext(Ctx).t;
export const useLocale = () => useContext(Ctx).locale;
