import { describe, expect, it } from 'vitest';
import { leadSchema } from './schema';

describe('leadSchema', () => {
  it('normalizes and accepts a valid demo request', () => {
    const r = leadSchema.parse({ kind: 'demo', name: ' Ana ', email: 'ANA@Example.com', business_type: 'both', locations_count: '3', website: '' });
    expect(r).toMatchObject({ name: 'Ana', email: 'ana@example.com', business_type: 'both', locations_count: 3 });
  });
  it('rejects bad emails and oversized messages', () => {
    expect(leadSchema.safeParse({ kind: 'contact', name: 'A', email: 'nope' }).success).toBe(false);
    expect(leadSchema.safeParse({ kind: 'contact', name: 'A', email: 'a@b.co', message: 'x'.repeat(4001) }).success).toBe(false);
  });
  it('flags the honeypot', () => {
    expect(leadSchema.parse({ kind: 'demo', name: 'Bot', email: 'b@b.co', website: 'http://spam' }).website).toBe('BOT');
  });
});
