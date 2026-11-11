import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Fills a new demo business with made-up records through the same database
 * functions the app uses (so every rule and total is real). Runs as the
 * signed-in superadmin, who owns the demo business. All names are fictional.
 */

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (today: string, n: number) => ymd(new Date(Date.parse(`${today}T12:00:00Z`) - n * 86_400_000));
/** Small deterministic "random" so every demo looks the same. */
const wobble = (i: number, spread: number) => Math.round(((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * spread);

/** The few database calls the seed needs, so tests can run it straight against Postgres. */
export interface DemoDb {
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
  select<T = Record<string, unknown>>(table: string, cols: string, eq: Record<string, unknown>): Promise<T[]>;
  insert<T = Record<string, unknown>>(table: string, rows: Record<string, unknown>[], cols: string): Promise<T[]>;
}

/** DemoDb over the signed-in user's Supabase client (RLS and RPC checks apply). */
export function supabaseDemoDb(sb: SupabaseClient): DemoDb {
  return {
    async rpc<T>(fn: string, args: Record<string, unknown>) {
      const { data, error } = await sb.rpc(fn, args);
      if (error) throw new Error(`${fn}: ${error.message}`);
      return data as T;
    },
    async select<T>(table: string, cols: string, eq: Record<string, unknown>) {
      let q = sb.from(table).select(cols);
      for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
      const { data, error } = await q;
      if (error) throw new Error(`${table}: ${error.message}`);
      return (data ?? []) as T[];
    },
    async insert<T>(table: string, rows: Record<string, unknown>[], cols: string) {
      const { data, error } = await sb.from(table).insert(rows).select(cols);
      if (error) throw new Error(`${table}: ${error.message}`);
      return (data ?? []) as T[];
    },
  };
}
const rpc = <T = unknown>(db: DemoDb, fn: string, args: Record<string, unknown>) => db.rpc<T>(fn, args);

export async function seedRetail(sb: DemoDb, org: string, today: string) {
  const [loc] = await sb.select<{ id: string }>('locations', 'id', { organization_id: org });
  const location = loc.id;

  // Daily sales for the last 45 days (closed Sundays).
  for (let i = 45; i >= 1; i--) {
    const day = daysAgo(today, i);
    if (new Date(`${day}T12:00:00Z`).getUTCDay() === 0) continue;
    const weekend = new Date(`${day}T12:00:00Z`).getUTCDay() === 6;
    const gross = (weekend ? 260000 : 165000) + wobble(i, 90000);
    const disc = Math.round(gross * 0.02), tax = Math.round((gross - disc) * 0.075);
    const card = Math.round((gross - disc + tax) * 0.68);
    await rpc(sb, 'record_sales_day', {
      p_org: org, p_location_id: location, p_business_date: day, p_gross_sales_cents: gross, p_discounts_cents: disc, p_sales_tax_cents: tax,
      p_cash_cents: gross - disc + tax - card, p_card_cents: card, p_customer_credit_cents: 0, p_register: 'All registers',
      p_transaction_count: 60 + wobble(i + 7, 70), p_source: 'manual',
    });
  }

  // Vendors and bills.
  const vendors = [
    { name: 'Glow Hair Distributors', payment_terms_days: 30 }, { name: 'Prime Beauty Wholesale', payment_terms_days: 15 },
    { name: 'Sunrise Cosmetics Co.', payment_terms_days: 30 }, { name: 'Bayview Properties', payment_terms_days: 0 }, { name: 'City Power & Light', payment_terms_days: 10 },
  ];
  const vs = await sb.insert<{ id: string; name: string }>('vendors', vendors.map((v) => ({ ...v, organization_id: org })), 'id, name');
  const vid = (n: string) => vs.find((v) => v.name === n)!.id;
  const accts = await sb.select<{ id: string; name: string; type: string; role: string | null }>('accounts', 'id, name, type, role', { organization_id: org, is_active: true });
  const inventory = accts.find((a) => a.role === 'inventory')?.id;
  const expense = (word: RegExp) => (accts.find((a) => a.type === 'expense' && word.test(a.name)) ?? accts.find((a) => a.type === 'expense'))!.id;
  const bills: [string, number, number, string | undefined, boolean][] = [
    ['Glow Hair Distributors', 48, 412500, inventory, true], ['Prime Beauty Wholesale', 40, 186040, inventory, true], ['Sunrise Cosmetics Co.', 33, 97520, inventory, false],
    ['Glow Hair Distributors', 20, 358900, inventory, false], ['Prime Beauty Wholesale', 9, 143275, inventory, false], ['Bayview Properties', 41, 450000, expense(/rent/i), true],
    ['Bayview Properties', 11, 450000, expense(/rent/i), false], ['City Power & Light', 26, 38714, expense(/utilit/i), true], ['City Power & Light', 4, 41230, expense(/utilit/i), false],
  ];
  let n = 1000;
  for (const [vendor, ago, cents, account, paid] of bills) {
    const id = await rpc<string>(sb, 'create_bill', {
      p_org: org, p_vendor: vid(vendor), p_bill_number: `D-${++n}`, p_bill_date: daysAgo(today, ago), p_due_date: null,
      p_lines: [{ account_id: account ?? expense(/./), description: 'Demo bill', amount_cents: cents }], p_memo: 'Demo data', p_location_id: location,
    });
    await rpc(sb, 'approve_bill', { p_bill: id }).catch(() => undefined);
    if (paid) await rpc(sb, 'record_bill_payment', { p_bill: id, p_paid_on: daysAgo(today, Math.max(ago - 5, 1)), p_amount_cents: cents, p_source: 'bank', p_idempotency_key: `demo-${id}` });
  }

  // Staff and upkeep.
  for (const [name, title] of [['Tasha Reed', 'Store manager'], ['Marco Diaz', 'Cashier'], ['Ivy Chen', 'Stock & wigs']]) {
    await rpc(sb, 'save_employee', { p_org: org, p_id: null, p_name: name, p_role_title: title, p_location: location, p_start: daysAgo(today, 400), p_active: true });
  }
  for (const t of [{ name: 'HVAC filter change', area: 'HVAC', every_n: 3, every_unit: 'months', last_done: daysAgo(today, 80) },
    { name: 'Deep clean wig displays', area: 'Sales floor', every_n: 2, every_unit: 'weeks', last_done: daysAgo(today, 10) }]) {
    await rpc(sb, 'save_maintenance_task', { p_org: org, p_id: null, p: t });
  }
}

export async function seedWholesale(sb: DemoDb, org: string, today: string) {
  await rpc(sb, 'save_wholesale_settings', { p_org: org, p: { default_terms: 30, tax_rate: 0, pay_instructions: 'Checks payable to Demo Wholesale Co. · Zelle: demo@example.com' } });
  await rpc(sb, 'save_price_tiers', { p_org: org, p: [{ name: 'Standard', pct: 0 }, { name: 'Volume', pct: 5 }, { name: 'Distributor', pct: 10 }] });
  const tiers = await sb.select<{ id: string; name: string }>('price_tiers', 'id, name', { organization_id: org });
  const tier = (n: string) => tiers.find((t) => t.name === n)!.id;

  const customers: Record<string, string> = {};
  for (const [name, t, terms, limit, exempt] of [
    ['Corner Beauty Mart', 'Volume', 30, 500000, true], ['Queen City Hair Supply', 'Distributor', 45, 1500000, true], ['Main St. Salon & Spa', 'Standard', 15, 200000, false],
    ['Bella Braids Studio', 'Standard', 0, null, false], ['Eastside Beauty Depot', 'Volume', 30, 300000, true], ['Crown & Glory Boutique', 'Standard', 30, 150000, true],
  ] as [string, string, number, number | null, boolean][]) {
    customers[name] = await rpc<string>(sb, 'save_customer', {
      p_org: org, p_id: null,
      p: { name, contact: 'Demo contact', phone: '(555) 010-' + String(Object.keys(customers).length + 10).padStart(4, '0'), terms, tier_id: tier(t), credit_limit_cents: limit, tax_exempt: exempt, resale_cert: exempt ? `RC-${1000 + Object.keys(customers).length}` : null },
    });
  }

  const items: Record<string, string> = {};
  for (const [name, sku, brand, cat, sub, cost, price, pack, qty, reorderAt] of [
    ['Silkline Braid 82" #1B', 'SB-82-1B', 'Silkline', 'Hair', 'Braiding hair', 150, 299, 12, 480, 120], ['Silkline Braid 82" #4', 'SB-82-4', 'Silkline', 'Hair', 'Braiding hair', 150, 299, 12, 96, 120],
    ['Nova Spring Twist 18"', 'NV-ST18', 'Nova', 'Hair', 'Crochet', 260, 449, 12, 144, 48], ['Nova Water Wave Crochet', 'NV-WW', 'Nova', 'Hair', 'Crochet', 280, 499, 12, 60, 36],
    ['Aria Lace Front Wig "Leah"', 'AR-LF-LEAH', 'Aria', 'Hair', 'Wigs', 1450, 2499, null, 24, 10], ['Aria Half Wig "Jo"', 'AR-HW-JO', 'Aria', 'Hair', 'Wigs', 980, 1799, null, 8, 10],
    ['Royal Remy Bundle 14"', 'RR-B14', 'Royal Remy', 'Hair', 'Bundles', 2100, 3499, null, 40, 12], ['Royal Remy Closure 4x4', 'RR-C44', 'Royal Remy', 'Hair', 'Closures', 2600, 4299, null, 15, 6],
    ['Smooth Edge Gel 4oz', 'SE-G4', 'Smooth Edge', 'Care', 'Styling', 120, 249, 24, 600, 144], ['Argan Shine Shampoo 12oz', 'AS-SH12', 'Argan Shine', 'Care', 'Shampoo', 210, 399, 12, 180, 48],
    ['Argan Shine Conditioner 12oz', 'AS-CO12', 'Argan Shine', 'Care', 'Conditioner', 220, 419, 12, 30, 48], ['Satin Bonnet XL', 'TL-BON', 'Daily Basics', 'Accessories', 'Bonnets', 90, 199, 12, 300, 60],
    ['Wide Tooth Comb', 'TL-COMB', 'Daily Basics', 'Accessories', 'Tools', 25, 79, 24, 720, 120], ['Wig Cap 2-pack', 'TL-CAP', 'Daily Basics', 'Accessories', 'Wig care', 30, 99, 24, 0, 96],
  ] as [string, string, string, string, string, number, number, number | null, number, number][]) {
    items[sku] = await rpc<string>(sb, 'save_item', {
      p_org: org, p_id: null,
      p: { name, sku, brand, category: cat, subcategory: sub, vendor: `${brand} Imports`, cost_cents: cost, price_cents: price, case_pack: pack, qty, reorder_at: reorderAt, reorder_qty: reorderAt * 2 },
    });
  }

  const order = (customer: string, lines: [string, number, number][], extra: Record<string, unknown> = {}) => rpc<string>(sb, 'save_sales_order', {
    p_org: org, p_id: null,
    p: { customer_id: customers[customer], lines: lines.map(([sku, q, price]) => ({ item_id: items[sku], qty: q, price_cents: price })), ...extra },
  });
  // Past orders, invoiced on their dates; some paid.
  const history: [string, number, [string, number, number][], number][] = [
    ['Queen City Hair Supply', 62, [['SB-82-1B', 240, 269], ['NV-ST18', 96, 404], ['SE-G4', 144, 224]], 1],
    ['Corner Beauty Mart', 55, [['SB-82-4', 120, 284], ['AS-SH12', 48, 379], ['TL-BON', 60, 189]], 1],
    ['Main St. Salon & Spa', 40, [['AS-SH12', 24, 399], ['AS-CO12', 24, 419], ['TL-COMB', 48, 79]], 0.5],
    ['Eastside Beauty Depot', 34, [['AR-LF-LEAH', 6, 2374], ['RR-B14', 10, 3324], ['TL-CAP', 48, 94]], 0],
    ['Queen City Hair Supply', 21, [['SB-82-1B', 360, 269], ['NV-WW', 48, 449], ['RR-C44', 6, 3869]], 0],
    ['Crown & Glory Boutique', 12, [['AR-HW-JO', 4, 1799], ['SE-G4', 48, 249], ['TL-BON', 24, 199]], 0],
    ['Bella Braids Studio', 5, [['SB-82-1B', 72, 299], ['SB-82-4', 48, 299]], 1],
  ];
  for (const [cust, ago, lines, paid] of history) {
    const date = daysAgo(today, ago);
    const o = await order(cust, lines, { order_date: date, customer_po: `PO-${4400 + ago}` });
    const inv = await rpc<string>(sb, 'invoice_order', { p_org: org, p_order: o, p_date: date });
    if (paid > 0) {
      const [i] = await sb.select<{ total_cents: number }>('customer_invoices', 'total_cents', { id: inv });
      const amount = Math.round(Number(i.total_cents) * paid);
      const on = daysAgo(today, Math.max(ago - 20, 1));
      await rpc(sb, 'record_customer_payment', { p_org: org, p_invoice: inv, p_paid_on: on, p_amount_cents: amount, p_method: 'check', p_check_no: String(5100 + ago), p_bank: 'Demo Bank', p_deposit_date: ago > 10 ? on : null });
    }
  }
  // A payment plan for Eastside's balance.
  await rpc(sb, 'add_expected_payments', { p_org: org, p_customer: customers['Eastside Beauty Depot'], p: [
    { due_date: daysAgo(today, 3), amount_cents: 25000, method: 'check', check_no: '7781' },
    { due_date: daysAgo(today, -11), amount_cents: 25000, method: 'check', check_no: '7782' },
  ] });
  // Open work: a quote, an order being picked, an order ready to ship.
  await order('Crown & Glory Boutique', [['AR-LF-LEAH', 3, 2499], ['RR-B14', 4, 3499]], { kind: 'quote', valid_until: daysAgo(today, -14) });
  const picking = await order('Corner Beauty Mart', [['SB-82-1B', 120, 284], ['NV-ST18', 36, 427], ['TL-COMB', 48, 75]], { need_by: daysAgo(today, -3) });
  await rpc(sb, 'set_order_status', { p_org: org, p_id: picking, p_status: 'picking' });
  const ready = await order('Queen City Hair Supply', [['SE-G4', 288, 224], ['AS-SH12', 96, 359]], { need_by: daysAgo(today, -1) });
  await rpc(sb, 'set_order_status', { p_org: org, p_id: ready, p_status: 'ready' });
  await rpc(sb, 'save_catalog_layout', { p_org: org, p: { view: 'list', size: 'm', images: true } });
}
