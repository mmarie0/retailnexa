import { monthlyTotalCents, normalizeSelection } from './billing/plans';
import { revenueSummary } from './billing/revenue';

/** One of an agent's accounts, as returned by agent_clients() (or the admin equivalent). */
export interface AgentClient {
  organization_id: string; name: string; business_type: string; org_status: string; created_at: string;
  source: string | null; since: string | null; sub_status: string | null; products: string[]; extra_locations: number;
  trial_end: string | null; current_period_end: string | null; cancel_at_period_end: boolean;
}

export type ClientStage = 'paying' | 'trial' | 'past_due' | 'no_plan' | 'canceled';
export const STAGE: Record<ClientStage, { label: string; tone: 'good' | 'info' | 'danger' | 'neutral' | 'warning' }> = {
  paying: { label: 'Paying', tone: 'good' }, trial: { label: 'Free trial', tone: 'info' }, past_due: { label: 'Payment failed', tone: 'danger' },
  no_plan: { label: 'No plan yet', tone: 'warning' }, canceled: { label: 'Canceled', tone: 'neutral' },
};

export function stageOf(c: Pick<AgentClient, 'sub_status' | 'org_status'>): ClientStage {
  if (c.org_status === 'closed') return 'canceled';
  switch (c.sub_status) {
    case 'active': return 'paying';
    case 'trialing': return 'trial';
    case 'past_due': return 'past_due';
    case null: case undefined: case 'incomplete': return 'no_plan';
    default: return 'canceled';
  }
}

/** Monthly list price of a client's plan (before discounts and tax). */
export const planCents = (c: Pick<AgentClient, 'products' | 'extra_locations'>) =>
  monthlyTotalCents(normalizeSelection({ retail: c.products.includes('retail'), wholesale: c.products.includes('wholesale'), extraLocations: c.extra_locations }));

/** MRR, trials and the rest for an agent's book of accounts; MRR at list prices. */
export function bookSummary(clients: AgentClient[], now = new Date()) {
  const r = revenueSummary(clients.filter((c) => c.sub_status).map((c) => ({ status: c.sub_status!, products: c.products, extra_locations: c.extra_locations, cancel_at_period_end: c.cancel_at_period_end })));
  const month = now.toISOString().slice(0, 7);
  return { ...r, accounts: clients.length, newThisMonth: clients.filter((c) => (c.since ?? c.created_at).startsWith(month)).length, noPlan: clients.filter((c) => stageOf(c) === 'no_plan').length };
}
