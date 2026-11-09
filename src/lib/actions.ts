import { unstable_rethrow } from 'next/navigation';
import { ConfigError } from '@/lib/env';

export type ActionState = { ok: boolean; message: string | null; fieldErrors?: Record<string, string>; data?: Record<string, string> };
export const initialActionState: ActionState = { ok: false, message: null };

export const ok = (message: string): ActionState => ({ ok: true, message });
export const fail = (message: string, fieldErrors?: Record<string, string>): ActionState => ({ ok: false, message, fieldErrors });

/**
 * Turns database / integration errors into safe user-facing text. Messages we
 * raise ourselves in SQL are plain sentences and pass through; anything that
 * looks like an internal error (identifiers, quotes, SQL) is replaced.
 */
export function friendlyError(err: unknown): string {
  if (err instanceof ConfigError) return 'This feature is not configured yet. An administrator needs to add its credentials.';
  const e = err as { message?: string; code?: string } | null;
  const msg = e?.message ?? '';
  if (/row-level security/i.test(msg) || msg === 'permission denied' || /^permission denied for/i.test(msg)) {
    return 'You don’t have permission to do that.';
  }
  if (e?.code === '23505') return 'That already exists.';
  if (msg && msg.length <= 160 && /^[a-z0-9 ,.;’'()-]+$/i.test(msg) && !/[_"]/.test(msg)) {
    return msg.charAt(0).toUpperCase() + msg.slice(1).replace(/\.?$/, '.');
  }
  console.error('[action error]', err);
  return 'Something went wrong. Please try again.';
}

/** Use in catch blocks: lets Next.js redirect/notFound signals through, converts real errors. */
export function failFrom(err: unknown): ActionState {
  unstable_rethrow(err);
  return fail(friendlyError(err));
}
