/** Feature keys a platform admin can override for one business (single source for the admin form and checks). */
export const FEATURE_KEYS = [
  { key: 'billing.exempt', label: 'Billing waiver (full access without a subscription)' },
  { key: 'retail', label: 'Retail module' },
  { key: 'wholesale', label: 'Wholesale module' },
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number]['key'];
export const isFeatureKey = (v: string): v is FeatureKey => FEATURE_KEYS.some((f) => f.key === v);

/**
 * Last selectable end date for a billing waiver, in days from today. The DB trigger
 * allows at most 90 days from now and the waiver ends at 23:59:59 UTC of the chosen
 * day, so day 89 is the last one that always fits.
 */
export const WAIVER_MAX_DAYS = 89;
export const WAIVER_DEFAULT_DAYS = 30;

/** Checks the "Until" date for a feature override. Returns an error message or null. */
export function overrideUntilError(feature: string, enabling: boolean, until: string | null, today: string): string | null {
  if (until && until < today) return 'Pick a date from today on.';
  if (feature !== 'billing.exempt' || !enabling) return null;
  if (!until) return `A billing waiver needs an end date (up to ${WAIVER_MAX_DAYS} days from today).`;
  const days = (Date.parse(`${until}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  if (days > WAIVER_MAX_DAYS) return `A billing waiver can last at most ${WAIVER_MAX_DAYS} days. Pick an earlier date and extend it later.`;
  return null;
}

export function addDays(day: string, n: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
