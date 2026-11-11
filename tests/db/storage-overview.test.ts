import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createUser, createOrg, addMember, expectDenied, closeDb, type TestUser } from './helpers';

// Batch E: storage overview (#116).
let owner: TestUser, admin: TestUser, mgr: TestUser, outsider: TestUser, org: string;
beforeAll(async () => {
  owner = await createUser('so-owner'); admin = await createUser('so-admin'); mgr = await createUser('so-mgr'); outsider = await createUser('so-out');
  org = await createOrg(owner, 'Storage Co', 'retail');
  await addMember(owner, org, admin, 'admin');
  await addMember(owner, org, mgr, 'manager');
  await as(owner, `insert into public.vendors (organization_id, name) values ($1, 'SO Vendor')`, [org]);
});
afterAll(closeDb);

describe('storage_overview (#116)', () => {
  it('owners and admins get counts for their business', async () => {
    const [{ r }] = await as<{ r: Record<string, number> }>(owner, `select public.storage_overview($1) as r`, [org]);
    expect(r.vendors).toBe(1);
    expect(r.invoice_bytes).toBe(0);
    expect(Object.keys(r)).toContain('maintenance_tasks');
    await as(admin, `select public.storage_overview($1)`, [org]);
  });
  it('managers, outsiders and anon are refused', async () => {
    await expectDenied(as(mgr, `select public.storage_overview($1)`, [org]));
    await expectDenied(as(outsider, `select public.storage_overview($1)`, [org]));
    await expectDenied(as({ kind: 'anon' } as never, `select public.storage_overview($1)`, [org]));
  });
});
