import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, sys, createUser, createOrg, addMember, setSubscription, expectDenied, closeDb, type TestUser } from './helpers';

// #105 invoices: private bucket, upload only to your own pending path, read with invoices.view + store access.
let owner: TestUser, mgrA: TestUser, emp: TestUser, outsider: TestUser;
let org: string, other: string, A: string, B: string, vendor: string;

beforeAll(async () => {
  owner = await createUser('inv-owner'); mgrA = await createUser('inv-mgrA'); emp = await createUser('inv-emp'); outsider = await createUser('inv-out');
  org = await createOrg(owner, 'Invoice Co', 'retail');
  other = await createOrg(outsider, 'Other Invoice Co', 'retail');
  [{ id: A }] = await sys<{ id: string }>(`select id from public.locations where organization_id = $1 limit 1`, [org]);
  [{ id: B }] = await as<{ id: string }>(owner, `insert into public.locations (organization_id, name, kind) values ($1, 'Inv Store B', 'store') returning id`, [org]);
  const m = await addMember(owner, org, mgrA, 'manager');
  await as(owner, `select public.set_member_locations($1, $2::uuid[])`, [m, [A]]);
  await addMember(owner, org, emp, 'employee');
  [{ id: vendor }] = await as<{ id: string }>(owner, `insert into public.vendors (organization_id, name) values ($1, 'Inv Vendor') returning id`, [org]);
});
afterAll(closeDb);

const begin = (u: TestUser, o = org, mime = 'image/jpeg', size = 2000, loc: string | null = null) =>
  as<{ id: string; storage_path: string }>(u, `select * from public.begin_invoice_upload($1, 'scan.jpg', $2, $3, $4)`, [o, mime, size, loc]);
// Storage records the uploaded file's type and size in metadata; by default the declared ones.
const put = async (u: TestUser, path: string, meta?: object) => {
  const m = meta ?? (await sys<{ m: object }>(`select jsonb_build_object('mimetype', mime_type, 'size', size_bytes) as m from public.invoice_files where storage_path = $1`, [path]))[0]?.m ?? {};
  return as(u, `insert into storage.objects (bucket_id, name, metadata) values ('invoices', $1, $2)`, [path, JSON.stringify(m)]);
};
const canRead = async (u: TestUser, path: string) => (await as(u, `select 1 from storage.objects where bucket_id = 'invoices' and name = $1`, [path])).length === 1;

describe('#105 invoices', () => {
  it('the bucket is private with a size and type limit', async () => {
    const [b] = await sys<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'invoices'`);
    expect(b.public).toBe(false);
    expect(b.file_size_limit).toBe('10485760');
    expect(b.allowed_mime_types).toEqual(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']);
  });

  it('upload: begin → put to that exact path → finish; the file then needs review', async () => {
    const [{ id, storage_path }] = await begin(owner);
    expect(storage_path).toBe(`${org}/${id}.jpg`);
    await expectDenied(as(owner, `select public.finish_invoice_upload($1)`, [id]), /didn.t finish uploading/);
    await put(owner, storage_path);
    await as(owner, `select public.finish_invoice_upload($1)`, [id]);
    const [f] = await sys<{ status: string; location_id: string | null }>(`select status, location_id from public.invoice_files where id = $1`, [id]);
    expect(f).toEqual({ status: 'needs_review', location_id: null });
  });

  it('nobody can write anywhere else: another path, someone else’s pending path, a finished path, no permission', async () => {
    await expectDenied(put(owner, `${org}/whatever.jpg`));
    await expectDenied(put(owner, `${other}/x.jpg`));
    const [{ storage_path }] = await begin(owner);
    await expectDenied(put(mgrA, storage_path)); // not the uploader
    await put(owner, storage_path);
    await expect(put(owner, storage_path)).rejects.toThrow(); // already there; no overwrite
    await expectDenied(as(owner, `update storage.objects set name = name || 'x' where name = $1`, [storage_path]).then((r) => { if (!r.length) throw new Error('permission denied'); }));
    await expectDenied(begin(emp)); // employees can't upload
    await expectDenied(begin(outsider));
  });

  it('only photos and PDFs up to 10 MB', async () => {
    await expectDenied(begin(owner, org, 'text/html'), /photo|PDF/);
    await expectDenied(begin(owner, org, 'application/pdf', 10485761), /10 MB/);
    await expectDenied(begin(owner, org, 'application/pdf', 0), /10 MB/);
  });

  it('reading needs invoices.view and access to the invoice’s store', async () => {
    const [{ id: wb, storage_path: whole }] = await begin(owner); await put(owner, whole); await as(owner, `select public.finish_invoice_upload($1)`, [wb]);
    const [{ id: ib, storage_path: inB }] = await begin(owner, org, 'application/pdf', 5000, B); await put(owner, inB); await as(owner, `select public.finish_invoice_upload($1)`, [ib]);
    const [{ id: ia, storage_path: inA }] = await begin(mgrA); await put(mgrA, inA); await as(mgrA, `select public.finish_invoice_upload($1)`, [ia]);
    // a one-store manager's upload lands in their store (#78 rule)
    expect((await sys<{ l: string }>(`select location_id as l from public.invoice_files where id = $1`, [ia]))[0].l).toBe(A);
    expect(await canRead(owner, inB)).toBe(true);
    expect(await canRead(mgrA, inA)).toBe(true);
    expect(await canRead(mgrA, inB)).toBe(false);
    expect(await canRead(mgrA, whole)).toBe(false);
    expect(await canRead(emp, inA)).toBe(false);
    expect(await canRead(outsider, inA)).toBe(false);
    expect((await as(mgrA, `select id from public.invoice_files where organization_id = $1`, [org])).map((r) => (r as { id: string }).id)).toContain(ia);
    expect(await as(mgrA, `select 1 from public.invoice_files where id = $1`, [ib])).toHaveLength(0);
    expect(await as(outsider, `select 1 from public.invoice_files where organization_id = $1`, [org])).toHaveLength(0);
    // a manager can't put an upload into a store they don't have
    await expectDenied(begin(mgrA, org, 'image/png', 100, B), /store you don.t have access to/);
  });

  it('review fills in the details; bad vendors, bills, dates and amounts are refused; tables are RPC-only', async () => {
    const [{ id, storage_path }] = await begin(owner); await put(owner, storage_path); await as(owner, `select public.finish_invoice_upload($1)`, [id]);
    const [{ id: otherVendor }] = await as<{ id: string }>(outsider, `insert into public.vendors (organization_id, name) values ($1, 'Not Yours') returning id`, [other]);
    await expectDenied(as(owner, `select public.review_invoice($1, $2, 'INV-9', '2026-11-01', 1000)`, [id, otherVendor]), /vendor not found/);
    await expectDenied(as(owner, `select public.review_invoice($1, $2, 'INV-9', 'infinity', 1000)`, [id, vendor]), /out of range/);
    await expectDenied(as(owner, `select public.review_invoice($1, $2, 'INV-9', '2026-11-01', 0)`, [id, vendor]), /amount/);
    await expectDenied(as(emp, `select public.review_invoice($1, $2, 'INV-9', '2026-11-01', 1000)`, [id, vendor]), /not found/);
    await as(owner, `select public.review_invoice($1, $2, ' INV-9 ', '2026-11-01', 193400)`, [id, vendor]);
    const [f] = await sys<{ status: string; invoice_number: string; amount_cents: string; reviewed_by: string }>(`select status, invoice_number, amount_cents, reviewed_by from public.invoice_files where id = $1`, [id]);
    expect(f).toEqual({ status: 'reviewed', invoice_number: 'INV-9', amount_cents: '193400', reviewed_by: owner.id });
    await expectDenied(as(owner, `insert into public.invoice_files (organization_id, storage_path, file_name, mime_type, size_bytes) values ($1, 'x', 'x', 'image/png', 1)`, [org]));
    await expectDenied(as(owner, `update public.invoice_files set status = 'reviewed' where id = $1`, [id]).then((r) => { if (!r.length) throw new Error('permission denied'); }));
    expect(await sys(`select 1 from public.audit_logs where organization_id = $1 and target_type = 'invoice_files'`, [org])).not.toHaveLength(0);
  });

  it('discarded invoices disappear from the list and can’t be opened; a linked bill must be unlinked first', async () => {
    const [{ id, storage_path }] = await begin(owner); await put(owner, storage_path); await as(owner, `select public.finish_invoice_upload($1)`, [id]);
    await as(owner, `select public.discard_invoice($1)`, [id]);
    expect(await canRead(owner, storage_path)).toBe(false);
  });

  it('a read-only business can’t upload or review', async () => {
    const u = await createUser('inv-ro');
    const ro = await createOrg(u, 'RO Invoice Co', 'retail');
    const [{ id, storage_path }] = await begin(u, ro); await put(u, storage_path); await as(u, `select public.finish_invoice_upload($1)`, [id]);
    await setSubscription(ro, 'canceled');
    await expectDenied(begin(u, ro));
    await expectDenied(as(u, `select public.review_invoice($1, null, 'X', null, null)`, [id]));
    expect(await canRead(u, storage_path)).toBe(true);
  });

  it('#142 list_invoices and invoice_months filter in the database, past 1000 invoices, under the caller’s RLS', async () => {
    const u = await createUser('inv-many');
    const o = await createOrg(u, 'Many Invoices Co', 'retail');
    await sys(`insert into public.invoice_files (organization_id, storage_path, file_name, mime_type, size_bytes, status, created_at)
               select $1::uuid, $1::text || '/' || g || '.jpg', 'scan-' || g || '.jpg', 'image/jpeg', 100, 'reviewed', '2026-10-15'::timestamptz
                 from generate_series(1, 1001) g`, [o]);
    await sys(`insert into public.invoice_files (organization_id, storage_path, file_name, mime_type, size_bytes, status, invoice_date, invoice_number)
               values ($1::uuid, $1::text || '/old.pdf', 'oldest_100%.pdf', 'application/pdf', 100, 'needs_review', '2024-01-05', 'OLD-1')`, [o]);
    const months = await as<{ month: string; invoices: number }>(u, `select * from public.invoice_months($1)`, [o]);
    expect(months).toEqual([{ month: '2026-10', invoices: 1001 }, { month: '2024-01', invoices: 1 }]);
    const list = (m: string | null, q: string | null, review = false) =>
      as<{ file_name: string }>(u, `select file_name from public.list_invoices($1, $2, $3, $4)`, [o, m, q, review]);
    expect((await list('2024-01', null)).map((r) => r.file_name)).toEqual(['oldest_100%.pdf']);
    expect((await list(null, 'old-1')).map((r) => r.file_name)).toEqual(['oldest_100%.pdf']);
    expect((await list(null, '100%')).map((r) => r.file_name)).toEqual(['oldest_100%.pdf']); // % is literal
    expect(await list(null, '_')).toHaveLength(1); // _ is literal too: only 'oldest_100%.pdf'
    expect((await list(null, null, true)).map((r) => r.file_name)).toEqual(['oldest_100%.pdf']);
    expect(await list(null, null)).toHaveLength(200);
    expect(await as(outsider, `select * from public.list_invoices($1)`, [o])).toHaveLength(0);
    expect(await as(outsider, `select * from public.invoice_months($1)`, [o])).toHaveLength(0);
  });

  it('#142 search finds vendor names; store-limited members only see their store', async () => {
    const [{ id, storage_path }] = await begin(owner, org, 'image/png', 100, B); await put(owner, storage_path); await as(owner, `select public.finish_invoice_upload($1)`, [id]);
    await as(owner, `select public.review_invoice($1, $2, 'VN-1', '2026-11-02', 500, null, null, false)`, [id, vendor]);
    expect((await as<{ id: string }>(owner, `select id from public.list_invoices($1, null, 'inv vendor')`, [org])).map((r) => r.id)).toContain(id);
    expect((await as<{ id: string }>(mgrA, `select id from public.list_invoices($1, null, 'inv vendor')`, [org])).map((r) => r.id)).not.toContain(id);
  });

  it('#145 the stored file must match the declared type and size', async () => {
    const [{ id, storage_path }] = await begin(owner, org, 'application/pdf', 2000);
    await put(owner, storage_path, { mimetype: 'image/jpeg', size: 9_000_000 });
    await expectDenied(as(owner, `select public.finish_invoice_upload($1)`, [id]), /doesn.t match/);
    const [f] = await sys<{ status: string }>(`select status from public.invoice_files where id = $1`, [id]);
    expect(f.status).toBe('uploading');
  });

  it('#145 an uploader without invoices.view can upload (reads back only their own pending file); linking a bill needs bills.view', async () => {
    const up = await createUser('inv-upload-only');
    const m = await addMember(owner, org, up, 'manager');
    await sys(`insert into public.member_permission_overrides (organization_id, membership_id, permission, granted) values ($1, $2, 'invoices.view', false), ($1, $2, 'bills.view', false)`, [org, m]);
    const [{ id, storage_path }] = await begin(up);
    await put(up, storage_path);
    expect(await canRead(up, storage_path)).toBe(true); // own pending file
    await as(up, `select public.finish_invoice_upload($1)`, [id]);
    expect(await canRead(up, storage_path)).toBe(false); // no invoices.view once it's done
    const [{ id: bill }] = await sys<{ id: string }>(`select id from public.bills where organization_id = $1 limit 1`, [org]).then((r) => r.length ? r : [{ id: '00000000-0000-4000-8000-000000000000' }]);
    await expectDenied(as(up, `select public.review_invoice($1, $2, 'X', null, null, $3)`, [id, vendor, bill]), /needs access to bills|not found/);
  });

  it('#145 another business’s store is “store not found”, not a database error', async () => {
    const [{ id: otherStore }] = await sys<{ id: string }>(`select id from public.locations where organization_id = $1 limit 1`, [other]);
    await expectDenied(begin(owner, org, 'image/png', 100, otherStore), /store not found/);
  });
});