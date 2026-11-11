import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { adminUrl, TEST_DB, as, sys, createUser, createOrg, addMember, setSubscription, expectDenied, closeDb, type TestUser } from './helpers';

// Batch C: monthly sales reports (#103) and category reports (#112).
let owner: TestUser, mgrA: TestUser, viewer: TestUser, emp: TestUser, outsider: TestUser;
let org: string, A: string, B: string;

beforeAll(async () => {
  owner = await createUser('sm-owner'); mgrA = await createUser('sm-mgrA'); viewer = await createUser('sm-viewer'); emp = await createUser('sm-emp'); outsider = await createUser('sm-out');
  org = await createOrg(owner, 'Sales Months Co', 'retail');
  [{ id: A }] = await sys<{ id: string }>(`select id from public.locations where organization_id = $1 limit 1`, [org]);
  [{ id: B }] = await as<{ id: string }>(owner, `insert into public.locations (organization_id, name, kind) values ($1, 'SM Store B', 'store') returning id`, [org]);
  const m = await addMember(owner, org, mgrA, 'manager');
  await as(owner, `select public.set_member_locations($1, $2::uuid[])`, [m, [A]]);
  await addMember(owner, org, viewer, 'viewer');
  await addMember(owner, org, emp, 'employee');
});
afterAll(closeDb);

const month = (u: TestUser, loc: string | null, m: string, p: object) => as<{ id: string }>(u, `select public.save_sales_month($1, $2, $3, $4::jsonb) as id`, [org, loc, m, JSON.stringify(p)]);

describe('sales_months', () => {
  it('saves and replaces a store’s month; any day in the month is the 1st', async () => {
    await month(owner, A, '2026-10-17', { sales_cents: 7000000, tax_cents: 490000, cash_cents: 3000000, card_cents: 4490000, transactions: 2140, points_cents: 1200 });
    await month(owner, A, '2026-10-01', { sales_cents: 7100000, transactions: 2150 });
    const rows = await as<{ month: string; sales_cents: string; transactions: number }>(viewer, `select to_char(month, 'YYYY-MM-DD') as month, sales_cents, transactions from public.sales_months where organization_id = $1`, [org]);
    expect(rows).toEqual([{ month: '2026-10-01', sales_cents: '7100000', transactions: 2150 }]);
  });

  it('needs sales.import and store access; reads follow the store limit; future months are refused', async () => {
    await expectDenied(month(emp, A, '2026-10-01', { sales_cents: 1 }));
    await expectDenied(month(outsider, A, '2026-10-01', { sales_cents: 1 }));
    await expectDenied(month(mgrA, B, '2026-10-01', { sales_cents: 1 }), /store you don.t have access to/);
    await month(owner, B, '2026-10-01', { sales_cents: 500 });
    expect(await as(mgrA, `select 1 from public.sales_months where organization_id = $1`, [org])).toHaveLength(1);
    expect(await as(emp, `select 1 from public.sales_months where organization_id = $1`, [org])).toHaveLength(0);
    await expectDenied(month(owner, A, '2099-01-01', { sales_cents: 1 }), /has started/);
    await expectDenied(month(owner, A, '2026-10-01', { sales_cents: -5 }), /sales/);
    await expectDenied(month(owner, null, '2026-10-01', { sales_cents: 5 }), /pick the store/); // two stores, no store given
    await expectDenied(as(owner, `insert into public.sales_months (organization_id, location_id, month, sales_cents) values ($1, $2, '2026-09-01', 1)`, [org, A]));
  });
});

describe('category_sales', () => {
  it('replaces a month’s categories, merging the same name; read follows the store limit', async () => {
    const rows = [{ category: 'Wigs', sales_cents: 100000, quantity: 10 }, { category: 'wigs ', sales_cents: 5000, quantity: 1 }, { category: 'Braiding hair', sales_cents: 80000 }];
    const [{ n }] = await as<{ n: number }>(owner, `select public.save_category_month($1, $2, '2026-10-01', $3::jsonb) as n`, [org, A, JSON.stringify(rows)]);
    expect(n).toBe(2);
    await as(owner, `select public.save_category_month($1, $2, '2026-10-01', $3::jsonb)`, [org, A, JSON.stringify([{ category: 'Wigs', sales_cents: 1 }])]);
    expect(await as(viewer, `select category, sales_cents from public.category_sales where organization_id = $1`, [org])).toEqual([{ category: 'Wigs', sales_cents: '1' }]);
    await expectDenied(as(mgrA, `select public.save_category_month($1, $2, '2026-10-01', $3::jsonb)`, [org, B, JSON.stringify(rows)]), /store you don.t have access to/);
    await expectDenied(as(owner, `select public.save_category_month($1, $2, '2026-10-01', '[{"category":""}]'::jsonb)`, [org, A]), /category and sales/);
  });

  it('two simultaneous first uploads of a month end with exactly one of them (#163)', async () => {
    const open: Client[] = [];
    const session = async () => {
      const c = new Client({ connectionString: adminUrl(TEST_DB) });
      await c.connect(); open.push(c);
      await c.query('begin');
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: owner.id, role: 'authenticated', aal: 'aal1' })]);
      await c.query('set local role authenticated');
      return c;
    };
    try {
      const save = (c: Client, names: string[]) => c.query(`select public.save_category_month($1, $2, '2026-08-01', $3::jsonb)`,
        [org, B, JSON.stringify(names.map((category) => ({ category, sales_cents: 100 })))]);
      const a = await session(), b = await session();
      await save(a, ['Alpha', 'Beta']);
      const second = save(b, ['Gamma', 'Delta']);
      await new Promise((r) => setTimeout(r, 150)); // b waits on a's lock instead of seeing an empty month
      await a.query('commit');
      await second;
      await b.query('commit');
      const left = await sys<{ category: string }>(`select category from public.category_sales where organization_id = $1 and location_id = $2 and month = '2026-08-01' order by category`, [org, B]);
      expect(left.map((r) => r.category)).toEqual(['Delta', 'Gamma']);
    } finally {
      await Promise.all(open.map((c) => c.end().catch(() => {})));
    }
  });

  it('a read-only business can’t save', async () => {
    const u = await createUser('sm-ro');
    const ro = await createOrg(u, 'RO Sales Months', 'retail');
    await setSubscription(ro, 'canceled');
    await expectDenied(as(u, `select public.save_sales_month($1, null, '2026-10-01', '{"sales_cents":1}'::jsonb)`, [ro]));
  });
});
