'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getOrgContext, getSupabase } from '@/lib/auth/context';
import { fail, failFrom, ok, type ActionState } from '@/lib/actions';
import { DEFAULT_LAYOUT, cleanLayout, editLayout } from '@/lib/dashboard/overview';

const Step = z.object({ op: z.enum(['up', 'down', 'remove', 'add', 'reset']), id: z.string().max(30).default('') });

/** One customize step on the caller's own Overview layout (#108). Saved per person, per business. */
export async function editOverview(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const step = Step.safeParse({ op: form.get('op'), id: form.get('id') ?? '' });
    if (!step.success) return fail('That change isn’t valid.');
    const ctx = await getOrgContext();
    const supabase = await getSupabase();
    if (step.data.op === 'reset') {
      const { error } = await supabase.rpc('save_overview_layout', { p_org: ctx.org.id, p_layout: [] });
      if (error) throw error;
      revalidatePath('/app'); revalidatePath('/app/customize');
      return ok('Back to the standard layout.');
    }
    const { data } = await supabase.from('overview_layouts').select('layout').eq('organization_id', ctx.org.id).eq('user_id', ctx.user.id).maybeSingle();
    const cur = cleanLayout(data?.layout ?? DEFAULT_LAYOUT);
    const next = editLayout(cur, step.data.op, step.data.id);
    if (next === cur) return ok('');
    // An empty list is saved as "none" so it isn't read back as "use the default".
    const { error } = await supabase.rpc('save_overview_layout', { p_org: ctx.org.id, p_layout: next.length ? next : ['none'] });
    if (error) throw error;
    revalidatePath('/app'); revalidatePath('/app/customize');
    return ok('Saved.');
  } catch (e) {
    return failFrom(e);
  }
}
