/**
 * Plan catalog shown on the pricing page and used to build Stripe Checkout.
 *
 * Amounts mirror the prices configured in Stripe (Stripe is the source of truth
 * for what is charged). They were carried over from the RetailNexa Online
 * Reporting prototype and must be confirmed by the owner before launch — see
 * docs/PROJECT_STATUS.md. Keep these in sync with the Stripe Price objects
 * referenced by STRIPE_PRICE_* env vars.
 */
export const TRIAL_DAYS = 7;

export type ProductKey = 'retail' | 'wholesale';

export interface PlanDef {
  key: ProductKey;
  name: string;
  monthlyCents: number;
  extraLocationCents: number | null;
  summary: string;
  includes: string[];
}

export const PLANS: Record<ProductKey, PlanDef> = {
  retail: {
    key: 'retail',
    name: 'Retail',
    monthlyCents: 12999,
    extraLocationCents: 9999,
    summary: 'For stores: sales, bills, vendors, inventory, staff and bookkeeping.',
    includes: [
      'First store location included',
      'Daily sales and register reports',
      'Bills, vendors and invoice imports',
      'Inventory, labels and stock counts',
      'Staff schedules, time clock and tasks',
      'Double-entry bookkeeping and reports',
    ],
  },
  wholesale: {
    key: 'wholesale',
    name: 'Wholesale',
    monthlyCents: 14999,
    extraLocationCents: null,
    summary: 'For distributors: catalog, customers, sales reps, ordering and fulfillment.',
    includes: [
      'One warehouse location included',
      'Customer pricing tiers and credit terms',
      'Sales rep logins and commissions',
      'Branded ordering portal with case packs',
      'Picking, packing, invoicing and returns',
      'Double-entry bookkeeping and reports',
    ],
  },
};

export interface PlanSelection {
  retail: boolean;
  wholesale: boolean;
  /** Additional retail locations beyond the first (retail only). */
  extraLocations: number;
}

export const MAX_EXTRA_LOCATIONS = 49;

export function normalizeSelection(input: Partial<PlanSelection>): PlanSelection {
  const retail = !!input.retail;
  const wholesale = !!input.wholesale;
  const raw = Math.floor(Number(input.extraLocations ?? 0));
  const extraLocations = retail && Number.isFinite(raw) ? Math.min(Math.max(raw, 0), MAX_EXTRA_LOCATIONS) : 0;
  return { retail, wholesale, extraLocations };
}

export function monthlyTotalCents(sel: PlanSelection): number {
  let total = 0;
  if (sel.retail) total += PLANS.retail.monthlyCents + sel.extraLocations * (PLANS.retail.extraLocationCents ?? 0);
  if (sel.wholesale) total += PLANS.wholesale.monthlyCents;
  return total;
}

export function selectionProducts(sel: PlanSelection): ProductKey[] {
  return (['retail', 'wholesale'] as const).filter((k) => sel[k]);
}

export interface PriceIds {
  retail: string;
  retailExtraLocation: string;
  wholesale: string;
}

export function checkoutLineItems(sel: PlanSelection, prices: PriceIds) {
  if (!sel.retail && !sel.wholesale) throw new Error('Choose at least one product');
  const items: { price: string; quantity: number }[] = [];
  if (sel.retail) {
    items.push({ price: prices.retail, quantity: 1 });
    if (sel.extraLocations > 0) items.push({ price: prices.retailExtraLocation, quantity: sel.extraLocations });
  }
  if (sel.wholesale) items.push({ price: prices.wholesale, quantity: 1 });
  return items;
}

/** Maps Stripe price IDs on a subscription back to products and extra locations. */
export function productsFromPrices(items: { priceId: string; quantity: number }[], prices: PriceIds) {
  const products = new Set<ProductKey>();
  let extraLocations = 0;
  for (const it of items) {
    if (it.priceId === prices.retail) products.add('retail');
    else if (it.priceId === prices.wholesale) products.add('wholesale');
    else if (it.priceId === prices.retailExtraLocation) {
      products.add('retail');
      extraLocations += it.quantity;
    }
  }
  return { products: [...products].sort(), extraLocations };
}

export function formatMoney(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}
