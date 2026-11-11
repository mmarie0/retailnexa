import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentClient } from '@/lib/partners';

/** Accounts credited to agents, shaped like agent_clients() (admin read through RLS). */
export async function agentBooks(supabase: SupabaseClient, agentId?: string): Promise<Map<string, AgentClient[]>> {
  let q = supabase.from('organizations').select('id, name, business_type, status, created_at, sales_agent_id, sales_agent_source, sales_agent_since, subscriptions(status, products, extra_locations, trial_end, current_period_end, cancel_at_period_end)').not('sales_agent_id', 'is', null);
  if (agentId) q = q.eq('sales_agent_id', agentId);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(5000);
  if (error) throw error;
  const out = new Map<string, AgentClient[]>();
  for (const o of data ?? []) {
    const raw = o.subscriptions as unknown;
    const s = (Array.isArray(raw) ? raw[0] : raw) as { status: string; products: string[]; extra_locations: number; trial_end: string | null; current_period_end: string | null; cancel_at_period_end: boolean } | null;
    const row: AgentClient = {
      organization_id: o.id, name: o.name, business_type: o.business_type, org_status: o.status, created_at: o.created_at, source: o.sales_agent_source, since: o.sales_agent_since,
      sub_status: s?.status ?? null, products: s?.products ?? [], extra_locations: s?.extra_locations ?? 0, trial_end: s?.trial_end ?? null,
      current_period_end: s?.current_period_end ?? null, cancel_at_period_end: !!s?.cancel_at_period_end,
    };
    out.set(o.sales_agent_id as string, [...(out.get(o.sales_agent_id as string) ?? []), row]);
  }
  return out;
}
