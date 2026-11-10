-- =============================================================================
-- Invoices (#105): vendor invoice photos and PDFs in a PRIVATE storage bucket.
--
-- Flow (the browser uploads straight to Storage under the user's own JWT):
--   1. begin_invoice_upload  → creates an invoice_files row (status 'uploading')
--      and returns its storage path  <org id>/<invoice id>.<ext>
--   2. the browser uploads the file to that exact path; the storage.objects
--      insert policy only allows a path that matches the caller's own
--      'uploading' row, so nobody can write anywhere else
--   3. finish_invoice_upload → checks the object exists, status 'needs_review'
--   4. review_invoice        → vendor, number, date, amount, linked bill
-- Files are never public: the app shows them through short-lived signed URLs,
-- which Storage only signs when the storage.objects select policy passes
-- (invoices.view + store access). Type and size are checked here AND by the
-- bucket (10 MB; JPEG, PNG, WebP, HEIC, PDF). No update/delete policies.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoices', 'invoices', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table public.invoice_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid,
  vendor_id uuid,
  bill_id uuid,
  storage_path text not null unique check (char_length(storage_path) <= 200),
  file_name text not null check (char_length(btrim(file_name)) between 1 and 200),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf')),
  size_bytes int not null check (size_bytes between 1 and 10485760),
  status text not null default 'uploading' check (status in ('uploading', 'needs_review', 'reviewed', 'discarded')),
  invoice_number text check (invoice_number is null or char_length(invoice_number) <= 60),
  invoice_date date check (invoice_date is null or invoice_date between '2000-01-01' and '2100-12-31'),
  amount_cents bigint check (amount_cents is null or amount_cents between 1 and 100000000000),
  note text check (note is null or char_length(note) <= 500),
  uploaded_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id),
  foreign key (organization_id, vendor_id) references public.vendors (organization_id, id),
  foreign key (organization_id, bill_id) references public.bills (organization_id, id)
);
create index invoice_files_org_created_idx on public.invoice_files (organization_id, created_at desc);
create index invoice_files_location_idx on public.invoice_files (organization_id, location_id);
create index invoice_files_vendor_idx on public.invoice_files (organization_id, vendor_id);
create index invoice_files_bill_idx on public.invoice_files (organization_id, bill_id);
create index invoice_files_uploaded_by_idx on public.invoice_files (uploaded_by);
create index invoice_files_reviewed_by_idx on public.invoice_files (reviewed_by);
create trigger invoice_files_updated_at before update on public.invoice_files
  for each row execute function private.set_updated_at();
create trigger audit_invoice_files after insert or update or delete on public.invoice_files
  for each row execute function private.audit_row_change();

alter table public.invoice_files enable row level security;
revoke all on public.invoice_files from anon, authenticated;
grant select on public.invoice_files to authenticated;
grant all on public.invoice_files to service_role;
create policy invoice_files_select on public.invoice_files for select to authenticated
  using ((private.has_permission(organization_id, 'invoices.view') and private.can_access_location(organization_id, location_id))
         or private.has_support_access(organization_id));

-- Storage policies: write only to your own pending path; read with invoices.view + store access.
-- The checks live in SECURITY DEFINER helpers so they don't depend on invoice_files RLS.
create or replace function private.invoice_object_writable(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.invoice_files f
     where f.storage_path = p_name and f.status = 'uploading' and f.uploaded_by = auth.uid()
       and f.created_at > now() - interval '1 hour'
       and private.has_permission(f.organization_id, 'invoices.upload') and private.org_is_writable(f.organization_id))
$$;
create or replace function private.invoice_object_readable(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.invoice_files f
     where f.storage_path = p_name and f.status <> 'discarded'
       and ((private.has_permission(f.organization_id, 'invoices.view') and private.can_access_location(f.organization_id, f.location_id))
            or private.has_support_access(f.organization_id)))
$$;
revoke all on function private.invoice_object_writable(text), private.invoice_object_readable(text) from public, anon;
grant execute on function private.invoice_object_writable(text), private.invoice_object_readable(text) to authenticated;
create policy invoices_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'invoices' and private.invoice_object_writable(name));
create policy invoices_select on storage.objects for select to authenticated
  using (bucket_id = 'invoices' and private.invoice_object_readable(name));

-- ---------------------------------------------------------------------------
create or replace function public.begin_invoice_upload(
  p_org uuid, p_file_name text, p_mime text, p_size int, p_location uuid default null
) returns table (id uuid, storage_path text) language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_id uuid := gen_random_uuid(); v_loc uuid; v_path text; v_ext text;
begin
  perform private.require_user();
  if not private.has_permission(p_org, 'invoices.upload') or not private.org_is_writable(p_org) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  v_ext := case p_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
                       when 'image/heic' then 'heic' when 'application/pdf' then 'pdf' end;
  if v_ext is null then raise exception 'upload a photo (JPEG, PNG, WebP, HEIC) or a PDF' using errcode = '22023'; end if;
  if p_size is null or p_size < 1 or p_size > 10485760 then raise exception 'files up to 10 MB' using errcode = '22023'; end if;
  if nullif(btrim(p_file_name), '') is null then raise exception 'the file needs a name' using errcode = '22023'; end if;
  v_loc := private.default_location(p_org, p_location);
  if not private.can_access_location(p_org, v_loc) then
    raise exception 'permission denied: this record belongs to a store you don''t have access to' using errcode = '42501';
  end if;
  if (select count(*) from public.invoice_files f where f.uploaded_by = auth.uid() and f.status = 'uploading'
        and f.created_at > now() - interval '1 hour') >= 50 then
    raise exception 'too many uploads in progress; wait for them to finish' using errcode = '54000';
  end if;
  v_path := p_org::text || '/' || v_id::text || '.' || v_ext;
  insert into public.invoice_files (id, organization_id, location_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values (v_id, p_org, v_loc, v_path, left(btrim(p_file_name), 200), p_mime, p_size, auth.uid());
  return query select v_id, v_path;
end $$;

create or replace function public.finish_invoice_upload(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare f public.invoice_files;
begin
  perform private.require_user();
  select * into f from public.invoice_files where id = p_id;
  if f.id is null or f.uploaded_by is distinct from auth.uid() or not private.has_permission(f.organization_id, 'invoices.upload') then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;
  if f.status <> 'uploading' then return; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'invoices' and o.name = f.storage_path) then
    raise exception 'the file didn''t finish uploading; try again' using errcode = 'P0002';
  end if;
  update public.invoice_files set status = 'needs_review' where id = p_id;
end $$;

-- Fill in or correct what the invoice says. p_reviewed=false keeps it in "Needs review".
create or replace function public.review_invoice(
  p_id uuid, p_vendor uuid, p_invoice_number text, p_invoice_date date, p_amount_cents bigint,
  p_bill uuid default null, p_note text default null, p_reviewed boolean default true
) returns void language plpgsql security definer set search_path = '' as $$
declare f public.invoice_files;
begin
  perform private.require_user();
  select * into f from public.invoice_files where id = p_id;
  if f.id is null or not private.has_permission(f.organization_id, 'invoices.upload')
     or not private.can_access_location(f.organization_id, f.location_id) then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;
  if not private.org_is_writable(f.organization_id) then raise exception 'permission denied' using errcode = '42501'; end if;
  if f.status in ('uploading', 'discarded') then raise exception 'this invoice can''t be reviewed' using errcode = '22023'; end if;
  if p_vendor is not null and not exists (select 1 from public.vendors v where v.id = p_vendor and v.organization_id = f.organization_id) then
    raise exception 'vendor not found' using errcode = 'P0002';
  end if;
  if p_bill is not null and not exists (select 1 from public.bills b where b.id = p_bill and b.organization_id = f.organization_id
                                          and private.can_access_location(b.organization_id, b.location_id)) then
    raise exception 'bill not found' using errcode = 'P0002';
  end if;
  if p_invoice_date is not null and (not isfinite(p_invoice_date) or p_invoice_date < '2000-01-01' or p_invoice_date > private.org_today(f.organization_id) + 366) then
    raise exception 'invoice date is out of range' using errcode = '22023';
  end if;
  if p_amount_cents is not null and (p_amount_cents < 1 or p_amount_cents > 100000000000) then
    raise exception 'enter an amount like 125.00' using errcode = '22023';
  end if;
  update public.invoice_files
     set vendor_id = p_vendor, invoice_number = left(nullif(btrim(p_invoice_number), ''), 60), invoice_date = p_invoice_date,
         amount_cents = p_amount_cents, bill_id = p_bill, note = left(nullif(btrim(p_note), ''), 500),
         status = case when p_reviewed then 'reviewed' else 'needs_review' end,
         reviewed_by = case when p_reviewed then auth.uid() else null end,
         reviewed_at = case when p_reviewed then now() else null end
   where id = p_id;
end $$;

-- "Not an invoice": hidden from the list and no longer viewable; the file stays in storage (kept, not deleted).
create or replace function public.discard_invoice(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare f public.invoice_files;
begin
  perform private.require_user();
  select * into f from public.invoice_files where id = p_id;
  if f.id is null or not private.has_permission(f.organization_id, 'invoices.upload')
     or not private.can_access_location(f.organization_id, f.location_id) then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;
  if not private.org_is_writable(f.organization_id) then raise exception 'permission denied' using errcode = '42501'; end if;
  if f.bill_id is not null then raise exception 'unlink the bill before removing this invoice' using errcode = '22023'; end if;
  update public.invoice_files set status = 'discarded' where id = p_id;
end $$;

revoke all on function
  public.begin_invoice_upload(uuid, text, text, int, uuid), public.finish_invoice_upload(uuid),
  public.review_invoice(uuid, uuid, text, date, bigint, uuid, text, boolean), public.discard_invoice(uuid)
  from public, anon;
grant execute on function
  public.begin_invoice_upload(uuid, text, text, int, uuid), public.finish_invoice_upload(uuid),
  public.review_invoice(uuid, uuid, text, date, bigint, uuid, text, boolean), public.discard_invoice(uuid)
  to authenticated;
