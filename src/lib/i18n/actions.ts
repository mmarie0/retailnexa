'use server';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { LANG_COOKIE, isLocale } from './config';

/** Switch the interface language for this browser (saved for a year). */
export async function setLanguage(form: FormData): Promise<void> {
  const lang = form.get('lang');
  if (!isLocale(lang)) return;
  (await cookies()).set(LANG_COOKIE, lang, { maxAge: 365 * 86_400, path: '/', sameSite: 'lax', httpOnly: false, secure: process.env.NODE_ENV === 'production' });
  revalidatePath('/', 'layout');
}
