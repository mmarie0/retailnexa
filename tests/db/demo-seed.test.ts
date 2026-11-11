import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, sys, createUser, verifyMfa, closeDb, type Actor } from './helpers';
import { seedRetail, seedWholesale, type DemoDb } from '../../src/lib/demo/seed';

// Demo accounts: the seed runs through the real RPCs as the superadmin who owns the demo businesses.
let admin: Actor;
const enc = (v: unknown) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
const db = (): DemoDb => ({
  async rpc<T>(fn: string, args: Record<string, unknown>) {
    const keys = Object.keys(args);
    const rows = await as<{ r: T }>(admin, `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, keys.map((k) => enc(args[k])));
    return rows[0].r;
  },
  async select<T>(table: string, cols: string, eq: Record<string, unknown>) {
    const keys = Object.keys(eq);
    return as<T>(admin, `select ${cols} from public.${table} where ${keys.map((k, i) => `${k} = $${i + 1}`).join(' and ')}`, keys.map((k) => eq[k])) as Promise<T[]>;
  },
  async insert<T>(table: string, rows: Record<string, unknown>[], cols: string) {
    const names = Object.keys(rows[0]);
    return as<T>(admin, `insert into public.${table} (${names.join(', ')}) select ${names.join(', ')} from jsonb_populate_recordset(null::public.${table}, $1) returning ${cols}`, [JSON.stringify(rows)]) as Promise<T[]>;
  },
});
const today = () => new Date().toISOString().slice(0, 10);

async function demoOrg(name: string, type: string) {
  const [{ id }] = await as<{ id: string }>(admin, `select public.create_organization($1, $2::public.business_type) as id`, [name, type]);
  const until = new Date(Date.now() + 80 * 86_400_000).toISOString();
  await as(admin, `select public.admin_set_feature_override($1, 'billing.exempt', true, 'Demo account', $2)`, [id, until]);
  await as(admin, `select public.admin_mark_demo($1)`, [id]);
  return id;
}

beforeAll(async () => {
  const u = await createUser('demo-admin');
  await verifyMfa(u);
  await sys(`insert into public.platform_admins (user_id, role) values ($1, 'superadmin')`, [u.id]);
  admin = { ...u, aal: 'aal2' };
});
afterAll(closeDb);

describe('demo accounts', () => {
  it('a demo Retail business fills with sales, bills, staff and upkeep', async () => {
    const org = await demoOrg('Demo Retail', 'retail');
    await seedRetail(db(), org, today());
    const [c] = await sys<{ days: number; bills: number; paid: number; staff: number; tasks: number }>(`select
      (select count(*)::int from public.sales_days where organization_id = $1) as days,
      (select count(*)::int from public.bills where organization_id = $1) as bills,
      (select count(*)::int from public.bill_payments where organization_id = $1) as paid,
      (select count(*)::int from public.employees where organization_id = $1) as staff,
      (select count(*)::int from public.maintenance_tasks where organization_id = $1) as tasks`, [org]);
    expect(c.days).toBeGreaterThan(30);
    expect(c).toMatchObject({ bills: 9, paid: 4, staff: 3, tasks: 2 });
  });

  it('a demo Wholesale business fills with customers, items, orders, invoices and payments', async () => {
    const org = await demoOrg('Demo Wholesale', 'wholesale');
    await seedWholesale(db(), org, today());
    const [c] = await sys<{ customers: number; items: number; open: number; invoices: number; payments: number; plan: number }>(`select
      (select count(*)::int from public.customers where organization_id = $1) as customers,
      (select count(*)::int from public.items where organization_id = $1) as items,
      (select count(*)::int from public.sales_orders where organization_id = $1 and status in ('open','picking','ready')) as open,
      (select count(*)::int from public.customer_invoices where organization_id = $1) as invoices,
      (select count(*)::int from public.customer_payments where organization_id = $1) as payments,
      (select count(*)::int from public.expected_payments where organization_id = $1) as plan`, [org]);
    expect(c).toEqual({ customers: 6, items: 14, open: 3, invoices: 7, payments: 4, plan: 2 });
  });
});
