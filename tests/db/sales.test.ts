import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, sys, createUser, createOrg, addMember, expectDenied, closeDb, type TestUser } from './helpers';

let owner: TestUser, mgr: TestUser, emp: TestUser, viewer: TestUser, other: TestUser;
let org: string, otherOrg: string, store: string, otherStore: string;

const balance = async (o: string, r: string) =>
  Number((await sys<{ b: string }>(
    `select coalesce(sum(l.debit_cents - l.credit_cents), 0) as b from public.journal_lines l
       join public.accounts a on a.id = l.account_id where l.organization_id = $1 and a.role = $2`, [o, r]))[0].b);

type Day = { gross: number; disc?: number; tax?: number; cash?: number; card?: number; credit?: number; register?: string; date?: string; cats?: object[] };
const record = (u: TestUser, o: string, loc: string, d: Day, source = 'manual', batch: string | null = null) =>
  as<{ id: string }>(u,
    `select public.record_sales_day($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, null, $11, $12, $13::jsonb) as id`,
    [o, loc, d.date ?? '2026-11-06', d.gross, d.disc ?? 0, d.tax ?? 0, d.cash ?? 0, d.card ?? 0, d.credit ?? 0,
     d.register ?? 'Register 1', source, batch, d.cats ? JSON.stringify(d.cats) : null]);

beforeAll(async () => {
  owner = await createUser('sales-owner');
  mgr = await createUser('sales-mgr');
  emp = await createUser('sales-emp');
  viewer = await createUser('sales-viewer');
  other = await createUser('sales-other');
  org = await createOrg(owner, 'Sales Co', 'retail');
  otherOrg = await createOrg(other, 'Other Sales Co', 'retail');
  await addMember(owner, org, mgr, 'manager');
  await addMember(owner, org, emp, 'employee');
  await addMember(owner, org, viewer, 'viewer');
  [{ id: store }] = await sys<{ id: string }>(`select id from public.locations where organization_id = $1 limit 1`, [org]);
  [{ id: otherStore }] = await sys<{ id: string }>(`select id from public.locations where organization_id = $1 limit 1`, [otherOrg]);
});
afterAll(closeDb);

describe('recording a sales day', () => {
  it('posts revenue excluding tax, tax as a liability, tenders to cash/card clearing', async () => {
    // $1,000 gross, $50 discounts, $71.25 tax → $1,021.25 taken: $300 cash, $701.25 card, $20 store credit
    const [{ id }] = await record(mgr, org, store, { gross: 100_000, disc: 5_000, tax: 7_125, cash: 30_000, card: 70_125, credit: 2_000 });
    expect(id).toBeTruthy();
    expect(await balance(org, 'sales')).toBe(-100_000);
    expect(await balance(org, 'sales_discounts')).toBe(5_000);
    expect(await balance(org, 'sales_tax_payable')).toBe(-7_125);
    expect(await balance(org, 'cash_on_hand')).toBe(30_000);
    expect(await balance(org, 'card_clearing')).toBe(70_125);
    expect(await balance(org, 'customer_credits')).toBe(2_000);
  });

  it('rejects tenders that don’t match sales − discounts + tax', async () => {
    await expectDenied(record(mgr, org, store, { gross: 1_000, tax: 70, cash: 1_000, register: 'Register 2' }), /must equal/);
  });

  it('rejects negative amounts and discounts above gross', async () => {
    await expectDenied(record(mgr, org, store, { gross: 1_000, cash: 1_100, disc: -100, register: 'Register 2' }), /negative/);
    await expectDenied(record(mgr, org, store, { gross: 100, disc: 200, register: 'Register 2' }), /exceed gross/);
  });

  it('a location/register/date can only be recorded once (case-insensitive register)', async () => {
    await expectDenied(record(mgr, org, store, { gross: 500, cash: 500, register: ' register 1 ' }), /already recorded/);
    // A different register on the same day is fine.
    await record(mgr, org, store, { gross: 500, cash: 500, register: 'Register 2' });
  });

  it('rejects another business’s location and future dates', async () => {
    await expectDenied(record(mgr, org, otherStore, { gross: 100, cash: 100 }), /location not found/);
    await expectDenied(record(mgr, org, store, { gross: 100, cash: 100, date: '2099-01-01', register: 'R9' }), /future/);
  });

  it('requires sales.import: employees, viewers and outsiders cannot record', async () => {
    await expectDenied(record(emp, org, store, { gross: 100, cash: 100, register: 'E' }));
    await expectDenied(record(viewer, org, store, { gross: 100, cash: 100, register: 'V' }));
    await expectDenied(record(other, org, store, { gross: 100, cash: 100, register: 'O' }));
  });

  it('respects closed periods', async () => {
    await as(owner, `select public.close_books_through($1, '2026-10-31'::date)`, [org]);
    await expectDenied(record(mgr, org, store, { gross: 100, cash: 100, date: '2026-10-15', register: 'Closed' }), /closed through/);
  });

  it('stores an optional category breakdown', async () => {
    const [{ id }] = await record(mgr, org, store, {
      gross: 3_000, cash: 3_000, register: 'Register 3',
      cats: [{ category: 'Braiding hair', net_sales_cents: 2_000, quantity: 4 }, { category: 'Wigs', net_sales_cents: 1_000, quantity: 1 }],
    });
    const cats = await as<{ category: string }>(mgr, `select category from public.sales_day_categories where sales_day_id = $1 order by category`, [id]);
    expect(cats.map((c) => c.category)).toEqual(['Braiding hair', 'Wigs']);
  });
});

describe('visibility and immutability', () => {
  it('sales.view roles can read; employees and outsiders cannot', async () => {
    expect((await as(viewer, `select id from public.sales_days where organization_id = $1`, [org])).length).toBeGreaterThan(0);
    expect(await as(emp, `select id from public.sales_days where organization_id = $1`, [org])).toHaveLength(0);
    expect(await as(other, `select id from public.sales_days where organization_id = $1`, [org])).toHaveLength(0);
  });

  it('clients cannot write sales days directly; amounts can’t be changed even by the superuser', async () => {
    await expectDenied(as(owner, `insert into public.sales_days (organization_id, location_id, business_date, gross_sales_cents, source, journal_entry_id) values ($1, $2, '2026-11-01', 0, 'manual', gen_random_uuid())`, [org, store]));
    await expectDenied(as(owner, `update public.sales_days set gross_sales_cents = 1 where organization_id = $1`, [org]));
    await expect(sys(`update public.sales_days set gross_sales_cents = 1 where organization_id = $1`, [org])).rejects.toThrow(/immutable/);
    await expect(sys(`delete from public.sales_days where organization_id = $1`, [org])).rejects.toThrow(/immutable/);
  });
});

describe('voiding and re-recording', () => {
  it('managers cannot void (sales.edit is owner/admin); owners can, which reverses the posting', async () => {
    const [{ id }] = await record(mgr, org, store, { gross: 10_000, tax: 700, card: 10_700, register: 'Register 4' });
    const salesBefore = await balance(org, 'sales');
    await expectDenied(as(mgr, `select public.void_sales_day($1, 'typo in total')`, [id]));
    await as(owner, `select public.void_sales_day($1, 'typo in total')`, [id]);
    expect(await balance(org, 'sales') - salesBefore).toBe(10_000);
    await expectDenied(as(owner, `select public.void_sales_day($1, 'again')`, [id]), /already void/);
    // The day can now be recorded again with the right numbers.
    await record(mgr, org, store, { gross: 11_000, tax: 770, card: 11_770, register: 'Register 4' });
  });

  it('sales entries cannot be reversed directly through the journal', async () => {
    const [{ id }] = await record(mgr, org, store, { gross: 100, cash: 100, register: 'Register 5' });
    const [{ e }] = await sys<{ e: string }>(`select journal_entry_id as e from public.sales_days where id = $1`, [id]);
    await expectDenied(as(owner, `select public.reverse_journal_entry($1, '2026-11-09'::date, 'manual undo')`, [e]), /void the sales day/);
  });
});

describe('import batches', () => {
  it('tracks how many days each import recorded; batches are per business', async () => {
    const [{ id: batch }] = await as<{ id: string }>(mgr, `select public.create_sales_import_batch($1, 'vela', 'z-report.csv') as id`, [org]);
    await record(mgr, org, store, { gross: 200, cash: 200, register: 'Register 1', date: '2026-11-07' }, 'vela', batch);
    await record(mgr, org, store, { gross: 300, cash: 300, register: 'Register 2', date: '2026-11-07' }, 'vela', batch);
    const [{ row_count }] = await sys<{ row_count: number }>(`select row_count from public.sales_import_batches where id = $1`, [batch]);
    expect(row_count).toBe(2);
    const [{ id: theirs }] = await as<{ id: string }>(other, `select public.create_sales_import_batch($1, 'csv') as id`, [otherOrg]);
    await expectDenied(record(mgr, org, store, { gross: 1, cash: 1, register: 'X', date: '2026-11-07' }, 'csv', theirs), /batch not found/);
  });
});
