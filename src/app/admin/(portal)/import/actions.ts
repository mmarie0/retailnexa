'use server';
import { z } from 'zod';
import { getAdminContext } from '@/lib/auth/context';
import { friendlyError } from '@/lib/actions';

export interface ChunkResult { ok: boolean; imported: number; skipped: number; failed: number; errors: { row: number; key?: string; error: string }[]; message?: string }

const chunkSchema = z.object({
  org: z.string().uuid(),
  kind: z.enum(['vendor', 'bill', 'recurring', 'sales_day', 'bank_line']),
  source: z.enum(['retailnexa_backup', 'csv']),
  fileName: z.string().max(200).nullable(),
  dryRun: z.boolean(),
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(500),
});

/**
 * Sends one chunk of already-mapped rows to public.admin_import_rows. The
 * database re-checks superadmin + two-factor, the business, and every row.
 */
export async function importChunk(input: z.input<typeof chunkSchema>): Promise<ChunkResult> {
  const empty = { imported: 0, skipped: 0, failed: 0, errors: [] };
  try {
    const ctx = await getAdminContext();
    if (ctx.role !== 'superadmin') return { ok: false, ...empty, message: 'Only a superadmin can import.' };
    const p = chunkSchema.safeParse(input);
    if (!p.success) return { ok: false, ...empty, message: 'The import data is not in the expected shape.' };
    const { data, error } = await ctx.supabase.rpc('admin_import_rows', {
      p_org: p.data.org, p_kind: p.data.kind, p_rows: p.data.rows, p_dry_run: p.data.dryRun, p_source: p.data.source, p_file_name: p.data.fileName,
    });
    if (error) throw error;
    const r = data as Omit<ChunkResult, 'ok'>;
    return { ok: true, imported: r.imported, skipped: r.skipped, failed: r.failed, errors: r.errors ?? [] };
  } catch (e) {
    return { ok: false, ...empty, message: friendlyError(e) };
  }
}
