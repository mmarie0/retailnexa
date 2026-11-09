import { z } from 'zod';

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

export const leadSchema = z.object({
  kind: z.enum(['demo', 'contact']),
  name: z.string().trim().min(1, 'Enter your name').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
  company: optionalText(160),
  phone: optionalText(40),
  business_type: z.enum(['retail', 'wholesale', 'both']).optional().or(z.literal('').transform(() => undefined)),
  locations_count: z.coerce.number().int().min(1).max(10000).optional().or(z.literal('').transform(() => undefined)),
  message: optionalText(4000),
  source_path: optionalText(300),
  // Honeypot: real people never see or fill this field.
  website: z.string().max(0).optional().or(z.string().min(1).transform(() => 'BOT' as const)),
});

export type LeadInput = z.infer<typeof leadSchema>;
