import { afterAll, describe, expect, it } from 'vitest';
import { as, sys, createUser, createOrg, expectDenied, closeDb, verifyMfa } from './helpers';

afterAll(closeDb);

describe('billing waiver (#32)', () => {
  it('lets a pre-trial org write only while a superadmin-granted, expiring waiver is active', async () => {
    const owner = await createUser('waiver-owner');
    const org = await createOrg(owner, 'Waiver Co', 'retail', { subscribe: false });
    const vendor = () => as(owner, `insert into public.vendors (organization_id, name) values ($1, 'V' || floor(random()*1e9)::text)`, [org]);
    await expectDenied(vendor());

    const sa = await createUser('waiver-sa'); const ba = await createUser('waiver-ba');
    await verifyMfa(sa); await verifyMfa(ba);
    await sys(`insert into public.platform_admins (user_id, role) values ($1, 'superadmin'), ($2, 'billing')`, [sa.id, ba.id]);
    const setWaiver = (who: typeof sa, expires: string | null) =>
      as({ ...who, aal: 'aal2' }, `select public.admin_set_feature_override($1, 'billing.exempt', true, 'QA testing build', $2::timestamptz)`, [org, expires]);

    await expectDenied(setWaiver(ba, new Date(Date.now() + 7 * 864e5).toISOString()), /only a superadmin/);
    await expectDenied(setWaiver(sa, null), /end date within 90 days/);
    await expectDenied(setWaiver(sa, new Date(Date.now() + 120 * 864e5).toISOString()), /within 90 days/);

    await setWaiver(sa, new Date(Date.now() + 14 * 864e5).toISOString());
    await vendor();

    // Expired waiver no longer grants writes.
    await sys(`update public.feature_overrides set expires_at = now() - interval '1 minute' where organization_id = $1`, [org]);
    await expectDenied(vendor());
  });

  it('members cannot grant themselves a waiver', async () => {
    const u = await createUser('waiver-self');
    const o = await createOrg(u, 'Self Waiver', 'retail', { subscribe: false });
    await expectDenied(as(u, `insert into public.feature_overrides (organization_id, feature, enabled, reason, expires_at) values ($1, 'billing.exempt', true, 'me', now() + interval '1 day')`, [o]));
    await expectDenied(as(u, `select public.admin_set_feature_override($1, 'billing.exempt', true, 'me', now() + interval '1 day')`, [o]));
  });
});

describe('period close uses the business time zone (#38)', () => {
  it('compares against the org-local date', async () => {
    const u = await createUser('tz-owner');
    const o = await createOrg(u, 'TZ Co', 'retail');
    // Far east of UTC: local "today" is ahead of or equal to UTC; yesterday-local must be closable, local today must not.
    await sys(`update public.organizations set timezone = 'Pacific/Kiritimati' where id = $1`, [o]);
    const [{ d: localToday }] = await sys<{ d: string }>(`select to_char(private.org_today($1), 'YYYY-MM-DD') as d`, [o]);
    await expectDenied(as(u, `select public.close_books_through($1, $2::date)`, [o, localToday]), /periods that have ended/);
    await as(u, `select public.close_books_through($1, ($2::date - 1))`, [o, localToday]);
    const [{ d: utc }] = await sys<{ d: string }>(`select to_char((now() at time zone 'UTC')::date, 'YYYY-MM-DD') as d`);
    expect(localToday >= utc).toBe(true);
  });
});
