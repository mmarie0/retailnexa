'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getAgentContext } from '@/lib/auth/context';
import { fail, failFrom, ok, type ActionState } from '@/lib/actions';
import { getT } from '@/lib/i18n/server';

const STATUSES = ['new', 'contacted', 'demo', 'trial', 'won', 'lost'] as const;

export async function saveProspect(_p: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  try {
    const { supabase } = await getAgentContext();
    const f = z.object({
      id: z.string().uuid().or(z.literal('')).default(''), business_name: z.string().trim().min(1, t('Enter the business name')).max(120),
      contact: z.string().max(80).default(''), email: z.string().trim().max(200).email(t('Check the email')).or(z.literal('')).default(''), phone: z.string().max(40).default(''),
      business_type: z.enum(['retail', 'wholesale', 'both']).or(z.literal('')).default(''), status: z.enum(STATUSES).default('new'),
      follow_up: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).default(''), notes: z.string().max(2000).default(''),
    }).safeParse(Object.fromEntries(form));
    if (!f.success) return fail(t('Check the highlighted fields.'), Object.fromEntries(f.error.issues.map((i) => [String(i.path[0]), i.message])));
    const { id, ...p } = f.data;
    const { error } = await supabase.rpc('save_agent_prospect', { p_id: id || null, p });
    if (error) throw error;
    revalidatePath('/partner');
    return ok(id ? 'Saved.' : `Added ${p.business_name}.`);
  } catch (e) { return failFrom(e); }
}

export async function deleteProspect(_p: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  try {
    const { supabase } = await getAgentContext();
    const id = z.string().uuid().safeParse(form.get('id'));
    if (!id.success) return fail(t('Not found.'));
    const { error } = await supabase.rpc('delete_agent_prospect', { p_id: id.data });
    if (error) throw error;
    revalidatePath('/partner');
    return ok(t('Removed.'));
  } catch (e) { return failFrom(e); }
}

/** Pick the one Wholesale account that gets 50% off (once). */
export async function chooseDiscountAccount(_p: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  try {
    const { supabase } = await getAgentContext();
    const id = z.string().uuid().safeParse(form.get('org'));
    if (!id.success) return fail(t('Pick your Wholesale account.'));
    const { error } = await supabase.rpc('agent_set_discount_org', { p_org: id.data });
    if (error) throw error;
    revalidatePath('/partner');
    return ok(t('Saved. Your 50% partner discount applies when you start the Wholesale plan for that account.'));
  } catch (e) { return failFrom(e); }
}
