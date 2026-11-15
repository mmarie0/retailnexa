import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { LANG_COOKIE, isLocale, makeT, type Locale, type T } from './config';
import { AR } from './ar';

/** The visitor's language from the rn_lang cookie (English by default). */
export const getLocale = cache(async (): Promise<Locale> => {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return isLocale(v) ? v : 'en';
});

export const dictFor = (l: Locale) => (l === 'ar' ? AR : null);

/** t() for server components and actions. */
export const getT = cache(async (): Promise<T> => makeT(dictFor(await getLocale())));
