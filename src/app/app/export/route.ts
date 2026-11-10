import { NextResponse } from 'next/server';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Tenant data export. Reads with the user's own client (RLS applies), so the
 * export can never include another tenant's rows.
 */
export async function GET() {
  const ctx = await getOrgContext();
  if (!can(ctx, 'data.export') || !ctx.access.canExport) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const supabase = await getSupabase();
  const org = ctx.org.id;
  const [organization, locations, memberships, subscription, subscriptionEvents, audit] = await Promise.all([
    supabase.from('organizations').select('id, name, legal_name, business_type, timezone, currency, phone, website, created_at').eq('id', org).single(),
    supabase.from('locations').select('*').eq('organization_id', org),
    supabase.from('memberships').select('id, user_id, role, status, created_at').eq('organization_id', org),
    supabase.from('subscriptions').select('status, products, extra_locations, trial_start, trial_end, current_period_start, current_period_end, cancel_at_period_end, canceled_at, ended_at').eq('organization_id', org).maybeSingle(),
    supabase.from('subscription_events').select('kind, from_status, to_status, created_at').eq('organization_id', org).order('created_at'),
    can(ctx, 'audit.view')
      ? supabase.from('audit_logs').select('created_at, actor_user_id, actor_type, action, target_type, target_id, metadata').eq('organization_id', org).order('created_at').limit(10000)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [organization, locations, memberships, subscription, subscriptionEvents, audit]) if (r.error) return NextResponse.json({ error: 'export failed' }, { status: 500 });

  // Financial records (#48). Each section only for people allowed to see it; RLS still applies.
  // Supabase returns at most 1,000 rows per request, so read in pages.
  const all = async (table: string, columns: string, order: string, allowed: boolean) => {
    if (!allowed) return null;
    const out: Record<string, unknown>[] = [];
    for (let from = 0; from < 200_000; from += 1000) {
      const { data, error } = await supabase.from(table).select(columns).eq('organization_id', org).order(order).range(from, from + 999);
      if (error) throw error;
      out.push(...((data ?? []) as unknown as Record<string, unknown>[]));
      if (!data || data.length < 1000) break;
    }
    return out;
  };
  let finance: Record<string, unknown> = {};
  try {
    const books = can(ctx, 'accounting.view');
    const [accounts, periods, entries, lines, vendors, bills, billLines, billPayments, salesDays, salesCategories, salesBatches, paymentVoids, bankBatches, bankLines] = await Promise.all([
      all('accounts', 'id, code, name, type, role, is_active, is_system, created_at', 'code', books),
      all('accounting_periods', 'id, closed_through, closed_by, closed_at, note', 'closed_through', books),
      all('journal_entries', 'id, entry_date, memo, source_type, source_id, location_id, reverses_entry_id, posted_by, posted_by_system, created_at', 'created_at', books),
      all('journal_lines', 'id, entry_id, account_id, debit_cents, credit_cents, memo', 'id', books),
      all('vendors', 'id, name, contact_name, email, phone, payment_terms_days, default_account_id, notes, is_active, created_at', 'name', can(ctx, 'vendors.view')),
      all('bills', 'id, vendor_id, location_id, bill_number, bill_date, due_date, memo, status, total_cents, paid_cents, journal_entry_id, approved_at, voided_at, void_reason, created_at', 'bill_date', can(ctx, 'bills.view')),
      all('bill_lines', 'id, bill_id, account_id, description, amount_cents', 'id', can(ctx, 'bills.view')),
      all('bill_payments', 'id, bill_id, paid_on, amount_cents, source, reference, journal_entry_id, created_at', 'paid_on', can(ctx, 'bills.view')),
      all('sales_days', 'id, location_id, register, business_date, gross_sales_cents, discounts_cents, sales_tax_cents, cash_cents, card_cents, customer_credit_cents, transaction_count, source, import_batch_id, journal_entry_id, voided_at, void_reason, created_at', 'business_date', can(ctx, 'sales.view')),
      all('sales_day_categories', 'id, sales_day_id, category, net_sales_cents, quantity', 'id', can(ctx, 'sales.view')),
      all('sales_import_batches', 'id, source, filename, row_count, created_at', 'created_at', can(ctx, 'sales.view')),
      all('bill_payment_voids', 'payment_id, reversal_entry_id, reason, voided_by, voided_at', 'voided_at', can(ctx, 'bills.view')),
      all('bank_import_batches', 'id, filename, inserted_count, duplicate_count, created_at', 'created_at', can(ctx, 'bank.view')),
      all('bank_lines', 'id, batch_id, posted_on, description, amount_cents, status, journal_entry_id, note, resolved_at, created_at', 'posted_on', can(ctx, 'bank.view')),
    ]);
    const debits = (lines ?? []).reduce((a, l) => a + Number(l.debit_cents), 0);
    const credits = (lines ?? []).reduce((a, l) => a + Number(l.credit_cents), 0);
    finance = {
      chart_of_accounts: accounts, accounting_periods: periods, journal_entries: entries, journal_lines: lines,
      journal_totals: lines ? { debit_cents: debits, credit_cents: credits, balanced: debits === credits } : null,
      vendors, bills, bill_lines: billLines, bill_payments: billPayments,
      sales_days: salesDays, sales_day_categories: salesCategories, sales_import_batches: salesBatches,
      bill_payment_voids: paymentVoids, bank_import_batches: bankBatches, bank_lines: bankLines,
    };
  } catch {
    return NextResponse.json({ error: 'export failed' }, { status: 500 });
  }

  const ids = (memberships.data ?? []).map((m) => m.user_id);
  const { data: profiles } = ids.length ? await supabase.from('profiles').select('id, email, full_name').in('id', ids) : { data: [] };

  await createAdminClient().from('audit_logs').insert({ organization_id: org, actor_user_id: ctx.user.id, actor_type: 'user', action: 'data.exported', metadata: { format: 'json' } });

  const body = JSON.stringify({
    format: 'retailnexa-export', version: 2, exported_at: new Date().toISOString(),
    note: 'Amounts are integer cents. Sections are null when your role cannot see them.',
    organization: organization.data, locations: locations.data,
    team: (memberships.data ?? []).map((m) => ({ ...m, ...(profiles ?? []).find((p) => p.id === m.user_id) })),
    subscription: subscription.data, subscription_events: subscriptionEvents.data, audit_log: audit.data,
    ...finance,
  }, null, 2);
  const safeName = ctx.org.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40) || 'business';
  return new NextResponse(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="retailnexa-${safeName}-${new Date().toISOString().slice(0, 10)}.json"`,
      'cache-control': 'no-store',
    },
  });
}
