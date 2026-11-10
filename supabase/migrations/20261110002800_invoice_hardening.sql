-- =============================================================================
-- Invoice upload hardening (#145).
--   * finish_invoice_upload: the stored file must match the declared type and
--     size (Storage's object metadata), and the business must be writable.
--   * The uploader can read their own still-uploading file, so an upload with
--     invoices.upload but not invoices.view works (Storage reads back its row).
--   * review_invoice: linking a bill needs bills.view.
--   * begin_invoice_upload: a store from another business is "store not found",
--     not a raw foreign-key error.
-- =============================================================================

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
  if p_location is not null and not exists (select 1 from public.locations l where l.id = p_location and l.organization_id = p_org) then
    raise exception 'store not found' using errcode = 'P0002';
  end if;
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
declare f public.invoice_files; o storage.objects;
begin
  perform private.require_user();
  select * into f from public.invoice_files where id = p_id;
  if f.id is null or f.uploaded_by is distinct from auth.uid() or not private.has_permission(f.organization_id, 'invoices.upload') then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;
  if f.status <> 'uploading' then return; end if;
  if not private.org_is_writable(f.organization_id) then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into o from storage.objects so where so.bucket_id = 'invoices' and so.name = f.storage_path;
  if o.id is null then
    raise exception 'the file didn''t finish uploading; try again' using errcode = 'P0002';
  end if;
  -- The stored file must be the one that was declared (#145): same type and size.
  if (o.metadata ->> 'mimetype') is distinct from f.mime_type or (o.metadata ->> 'size')::bigint is distinct from f.size_bytes then
    raise exception 'the uploaded file doesn''t match what was started; upload it again' using errcode = '22023';
  end if;
  update public.invoice_files set status = 'needs_review' where id = p_id;
end $$;


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
  if p_bill is not null and not private.has_permission(f.organization_id, 'bills.view') then
    raise exception 'permission denied: linking a bill needs access to bills' using errcode = '42501';
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


create or replace function private.invoice_object_readable(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.invoice_files f
     where f.storage_path = p_name and f.status <> 'discarded'
       and ((private.has_permission(f.organization_id, 'invoices.view') and private.can_access_location(f.organization_id, f.location_id))
            or private.has_support_access(f.organization_id)
            -- The uploader can read their own file while it uploads (Storage reads back the row it inserts) (#145).
            or (f.status = 'uploading' and f.uploaded_by = auth.uid())))
$$;

