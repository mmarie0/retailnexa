import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, sys, createUser, createOrg, addMember, verifyMfa, expectDenied, closeDb, type Actor, type TestUser } from './helpers';

// Sales agents: admin-created logins, referral credit, own-client summary, prospects, one 50%-off wholesale account.
let sa: TestUser, billing: TestUser, support: TestUser, agent: TestUser, agent2: TestUser, owner: TestUser, other: TestUser;
let clientOrg: string, oldOrg: string, agentWs: string, agentRetail: string, agentWs2: string;
const aal2 = (u: TestUser): Actor => ({ ...u, aal: 'aal2' });
const save = (who: Actor, user: string, code: string, active = true) =>
  as(who, `select public.admin_save_sales_agent($1, 'Pat Agent', '555-0100', $2, $3, null)`, [user, code, active]);

beforeAll(async () => {
  sa = await createUser('ag-sa'); billing = await createUser('ag-billing'); support = await createUser('ag-support');
  agent = await createUser('ag-agent'); agent2 = await createUser('ag-agent2'); owner = await createUser('ag-owner'); other = await createUser('ag-other');
  for (const u of [sa, billing, support]) await verifyMfa(u);
  await sys(`insert into public.platform_admins (user_id, role) values ($1, 'superadmin'), ($2, 'billing'), ($3, 'support')`, [sa.id, billing.id, support.id]);
  clientOrg = await createOrg(owner, 'Referred Mart', 'retail');
  oldOrg = await createOrg(other, 'Old Shop', 'retail');
  await sys(`update public.organizations set created_at = now() - interval '10 days' where id = $1`, [oldOrg]);
  agentWs = await createOrg(agent, 'Agent Wholesale', 'wholesale');
  agentRetail = await createOrg(agent, 'Agent Retail', 'retail');
  agentWs2 = await createOrg(agent, 'Agent Wholesale 2', 'both');
});
afterAll(closeDb);

describe('sales agents', () => {
  it('only a superadmin with two-factor adds agents; codes are unique', async () => {
    await expectDenied(save(sa, agent.id, 'PAT01'));
    await expectDenied(save(aal2(billing), agent.id, 'PAT01'));
    await expectDenied(save(agent, agent.id, 'PAT01'));
    await save(aal2(sa), agent.id, 'pat01');
    expect((await sys(`select ref_code, email from public.sales_agents where user_id = $1`, [agent.id]))[0]).toEqual({ ref_code: 'PAT01', email: agent.email });
    await expectDenied(save(aal2(sa), agent2.id, 'PAT01'), /taken/);
    await expectDenied(save(aal2(sa), agent2.id, 'no!'), /referral code/);
    await save(aal2(sa), agent2.id, 'SAM02');
  });

  it('a new business owner can claim a referral once; old, self and bad codes do nothing', async () => {
    await expectDenied(as(other, `select public.claim_referral($1, 'PAT01')`, [clientOrg]));
    expect((await as<{ r: boolean }>(owner, `select public.claim_referral($1, 'nope') as r`, [clientOrg]))[0].r).toBe(false);
    expect((await as<{ r: boolean }>(owner, `select public.claim_referral($1, 'pat01') as r`, [clientOrg]))[0].r).toBe(true);
    expect((await as<{ r: boolean }>(owner, `select public.claim_referral($1, 'SAM02') as r`, [clientOrg]))[0].r).toBe(false);
    expect((await as<{ r: boolean }>(other, `select public.claim_referral($1, 'PAT01') as r`, [oldOrg]))[0].r).toBe(false);
    expect((await as<{ r: boolean }>(agent, `select public.claim_referral($1, 'PAT01') as r`, [agentWs]))[0].r).toBe(false);
    expect((await sys(`select sales_agent_id, sales_agent_source from public.organizations where id = $1`, [clientOrg]))[0]).toEqual({ sales_agent_id: agent.id, sales_agent_source: 'referral' });
    // Owners can't set it directly.
    await expectDenied(as(owner, `update public.organizations set sales_agent_id = null where id = $1`, [clientOrg]));
  });

  it('agents see a summary of only their own accounts', async () => {
    await as(aal2(billing), `select public.admin_assign_sales_agent($1, $2)`, [oldOrg, agent2.id]);
    await expectDenied(as(aal2(support), `select public.admin_assign_sales_agent($1, $2)`, [oldOrg, agent.id]));
    const mine = await as<{ name: string; sub_status: string; products: string[] }>(agent, `select name, sub_status, products from public.agent_clients()`);
    expect(mine).toEqual([{ name: 'Referred Mart', sub_status: 'active', products: ['retail'] }]);
    expect((await as(agent2, `select name from public.agent_clients()`)).map((r) => r.name)).toEqual(['Old Shop']);
    expect(await as(owner, `select name from public.agent_clients()`)).toEqual([]);
    // Agents can't read the client's records.
    expect(await as(agent, `select id from public.locations where organization_id = $1`, [clientOrg])).toEqual([]);
    // Deactivated agents see nothing.
    await save(aal2(sa), agent2.id, 'SAM02', false);
    expect(await as(agent2, `select name from public.agent_clients()`)).toEqual([]);
  });

  it('one 50%-off account: a Wholesale business the agent owns, chosen once', async () => {
    await expectDenied(as(agent, `select public.agent_set_discount_org($1)`, [agentRetail]), /Wholesale account you own/);
    await expectDenied(as(agent, `select public.agent_set_discount_org($1)`, [clientOrg]), /Wholesale account you own/);
    await expectDenied(as(owner, `select public.agent_set_discount_org($1)`, [agentWs]));
    await as(agent, `select public.agent_set_discount_org($1)`, [agentWs]);
    await expectDenied(as(agent, `select public.agent_set_discount_org($1)`, [agentWs2]), /already have/);
    expect((await as<{ r: boolean }>(agent, `select public.org_agent_discount($1) as r`, [agentWs]))[0].r).toBe(true);
    expect((await as<{ r: boolean }>(agent, `select public.org_agent_discount($1) as r`, [agentWs2]))[0].r).toBe(false);
    expect((await as<{ r: boolean }>(owner, `select public.org_agent_discount($1) as r`, [agentWs]))[0].r).toBe(false); // not a member
    // Support (billing role) can move it; another agent can't take the same account.
    await as(aal2(billing), `select public.admin_set_agent_discount($1, $2)`, [agent.id, agentWs2]);
    await expectDenied(as(aal2(billing), `select public.admin_set_agent_discount($1, $2)`, [agent.id, clientOrg]), /Wholesale account the agent owns/);
    await addMember(agent, agentWs2, agent2, 'admin');
    await expectDenied(as(aal2(billing), `select public.admin_set_agent_discount($1, $2)`, [agent2.id, agentWs2]), /Wholesale account the agent owns/);
    expect((await sys(`select discount_org_id from public.sales_agents where user_id = $1`, [agent.id]))[0].discount_org_id).toBe(agentWs2);
  });

  it('prospects are private to each agent', async () => {
    const [{ id }] = await as<{ id: string }>(agent, `select public.save_agent_prospect(null, $1::jsonb) as id`, [JSON.stringify({ business_name: 'Glam Supply', status: 'demo', business_type: 'retail', follow_up: '2026-11-20' })]);
    await expectDenied(as(agent, `select public.save_agent_prospect(null, $1::jsonb)`, [JSON.stringify({ business_name: ' ' })]), /business name/);
    await expectDenied(as(owner, `select public.save_agent_prospect(null, $1::jsonb)`, [JSON.stringify({ business_name: 'X' })]));
    expect(await as(owner, `select id from public.agent_prospects`)).toEqual([]);
    await expectDenied(as(agent2, `select public.save_agent_prospect($1, $2::jsonb)`, [id, JSON.stringify({ business_name: 'Mine now' })]));
    await expectDenied(as(owner, `select public.delete_agent_prospect($1)`, [id]), /not found/);
    await expectDenied(as(agent, `insert into public.agent_prospects (agent_id, business_name) values ($1, 'x')`, [agent.id]));
    await as(agent, `select public.delete_agent_prospect($1)`, [id]);
  });

  it('agent rows: own row and admins only; no direct writes', async () => {
    expect((await as(agent, `select user_id from public.sales_agents`)).map((r) => r.user_id)).toEqual([agent.id]);
    expect(await as(owner, `select user_id from public.sales_agents`)).toEqual([]);
    expect((await as(aal2(support), `select user_id from public.sales_agents`)).length).toBeGreaterThanOrEqual(2);
    await expectDenied(as(agent, `update public.sales_agents set discount_org_id = null where user_id = $1`, [agent.id]));
    await expectDenied(as({ kind: 'anon' }, `select * from public.agent_clients()`));
  });
});
