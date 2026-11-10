import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { cronSecret, isSupabaseConfigured } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 300;

function authorized(request: Request) {
  const secret = cronSecret();
  const got = request.headers.get('authorization') ?? '';
  const want = `Bearer ${secret}`;
  return !!secret && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

/**
 * Daily (Vercel Cron): creates the draft bills that recurring templates owe,
 * for every business whose account is writable, up to each business's local
 * today. Same logic as the "Create due bills" button; the bills are drafts
 * that someone still approves.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'not configured' }, { status: 503 });
  const { data, error } = await createAdminClient().rpc('run_recurring_bills_job');
  if (error) {
    console.error('[cron recurring-bills] failed', error.message);
    return NextResponse.json({ error: 'job failed' }, { status: 500 });
  }
  const result = data as { orgs: number; bills: number; failed: number };
  if (result.failed > 0) {
    // Non-2xx so Vercel shows the run as failed; the bad templates are flagged in the app (#68).
    console.error('[cron recurring-bills] some recurring bills could not be created', result);
    return NextResponse.json(result, { status: 500 });
  }
  return NextResponse.json(result);
}
