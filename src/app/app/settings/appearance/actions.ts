'use server';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { THEME_COOKIE, themeFrom } from '@/lib/themes';
import { ok, type ActionState } from '@/lib/actions';

/** Save the theme on this device (a cookie; nothing about it is stored on the server). */
export async function setTheme(_p: ActionState, form: FormData): Promise<ActionState> {
  const t = themeFrom(String(form.get('theme') ?? ''));
  (await cookies()).set(THEME_COOKIE, t, { path: '/', maxAge: 60 * 60 * 24 * 400, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  revalidatePath('/app', 'layout');
  return ok('Theme saved on this device.');
}
