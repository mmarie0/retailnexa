/**
 * Wholesale order quantity rules (spec §10). Shared by the ordering UI and the
 * server: the server MUST call validateQuantity before accepting an order line.
 * Default rule: minimum 6, increments of 6. Admins may configure e.g. 12/24/48.
 */
export interface QuantityRule {
  min: number;
  increment: number;
  max?: number;
}

export const DEFAULT_QUANTITY_RULE: QuantityRule = { min: 6, increment: 6 };
export const COMMON_INCREMENTS = [1, 6, 12, 24, 48] as const;

export function assertValidRule(rule: QuantityRule): void {
  if (!Number.isInteger(rule.min) || rule.min < 1) throw new Error('Minimum must be a whole number of at least 1');
  if (!Number.isInteger(rule.increment) || rule.increment < 1) throw new Error('Increment must be a whole number of at least 1');
  if (rule.min % rule.increment !== 0) throw new Error('Minimum must be a multiple of the increment');
  if (rule.max !== undefined && (!Number.isInteger(rule.max) || rule.max < rule.min || rule.max % rule.increment !== 0)) {
    throw new Error('Maximum must be a multiple of the increment and at least the minimum');
  }
}

export type QuantityCheck = { ok: true } | { ok: false; reason: string; suggestion: number | null };

export function validateQuantity(qty: number, rule: QuantityRule = DEFAULT_QUANTITY_RULE): QuantityCheck {
  assertValidRule(rule);
  if (!Number.isInteger(qty) || qty < 0) return { ok: false, reason: 'Enter a whole number.', suggestion: rule.min };
  if (qty === 0) return { ok: true };
  if (qty < rule.min) return { ok: false, reason: `Minimum order is ${rule.min}.`, suggestion: rule.min };
  if (rule.max !== undefined && qty > rule.max) return { ok: false, reason: `Maximum per order is ${rule.max}.`, suggestion: rule.max };
  if (qty % rule.increment !== 0) {
    return { ok: false, reason: `Order in multiples of ${rule.increment}.`, suggestion: Math.ceil(qty / rule.increment) * rule.increment };
  }
  return { ok: true };
}

/** Next valid quantity when stepping up or down from the current value. */
export function stepQuantity(current: number, direction: 1 | -1, rule: QuantityRule = DEFAULT_QUANTITY_RULE): number {
  if (direction === 1) {
    const next = current < rule.min ? rule.min : Math.floor(current / rule.increment) * rule.increment + rule.increment;
    return rule.max !== undefined ? Math.min(next, rule.max) : next;
  }
  if (current <= rule.min) return 0;
  return Math.max(rule.min, Math.ceil(current / rule.increment) * rule.increment - rule.increment);
}
