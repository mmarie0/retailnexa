import { z } from 'zod';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date');
/** Optional form fields may be missing entirely (e.g. the Store picker is hidden with one store, #75). */
const optionalUuid = uuid.or(z.literal('')).optional().transform((v) => v || null);

export const recurringBillForm = z.object({
  id: optionalUuid,
  vendor_id: uuid.or(z.literal('')).refine((v) => v !== '', 'Pick a vendor'),
  name: z.string().trim().min(1, 'Name it, e.g. Rent').max(80),
  frequency: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']),
  next_date: date,
  due_days: z.coerce.number().int().min(0).max(365),
  end_date: date.or(z.literal('')).optional().transform((v) => v || null),
  account_id: uuid.or(z.literal('')).refine((v) => v !== '', 'Pick an account'),
  description: z.string().trim().max(300).optional().transform((v) => v || null),
  location_id: optionalUuid,
  is_active: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
});
