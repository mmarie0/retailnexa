import { NextResponse } from 'next/server';

/** Liveness check for uptime monitoring (#34). No secrets, no database call. */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    { status: 'ok', commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null, time: new Date().toISOString() },
    { headers: { 'cache-control': 'no-store' } },
  );
}
