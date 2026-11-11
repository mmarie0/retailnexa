import type { Customer, Item, Tier } from '../_data';
import type { BuilderCustomer, BuilderItem } from './builder';

/** Customers and items shaped for the order screen (shared with New invoice). */
export function builderData(customers: Customer[], tiers: Tier[], items: Item[], freeOf: (id: string) => number, warn: (c: Customer) => string[], keep?: string) {
  const tier = new Map(tiers.map((t) => [t.id, t]));
  const bc: BuilderCustomer[] = customers.filter((c) => c.is_active || c.id === keep).map((c) => ({
    id: c.id, name: c.name, tierName: c.tier_id ? tier.get(c.tier_id)?.name ?? null : null, pct: c.tier_id ? tier.get(c.tier_id)?.pct ?? 0 : 0,
    taxExempt: c.tax_exempt, terms: c.terms, warnings: warn(c),
  }));
  const bi: BuilderItem[] = items.filter((i) => i.is_active).map((i) => ({ id: i.id, name: i.name, sku: i.sku, brand: i.brand, category: i.category, price: i.price_cents, free: freeOf(i.id), casePack: i.case_pack }));
  return { bc, bi };
}

