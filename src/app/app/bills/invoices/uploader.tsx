'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Select, cx } from '@/components/ui';
import { createBrowserSupabase } from '@/lib/supabase/browser';
import { INVOICE_MAX_BYTES, invoiceType } from '@/lib/invoices/types';
import { beginInvoiceUpload, finishInvoiceUpload } from './actions';

type Item = { name: string; state: 'waiting' | 'uploading' | 'done' | 'error'; message?: string };

/** Uploads straight from the browser to the private bucket, one file at a time. */
export function InvoiceUploader({ stores }: { stores: { id: string; name: string }[] }) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [store, setStore] = useState(stores.length === 1 ? stores[0].id : '');

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, 25);
    const next: Item[] = list.map((f) => ({ name: f.name, state: 'waiting' }));
    setItems(next); setBusy(true);
    const set = (i: number, patch: Partial<Item>) => { next[i] = { ...next[i], ...patch }; setItems([...next]); };
    const supabase = createBrowserSupabase();
    for (let i = 0; i < list.length; i++) {
      const f = list[i], mime = invoiceType(f);
      if (!mime) { set(i, { state: 'error', message: 'Only photos (JPEG, PNG, WebP, HEIC) and PDFs' }); continue; }
      if (f.size > INVOICE_MAX_BYTES) { set(i, { state: 'error', message: 'Bigger than 10 MB' }); continue; }
      set(i, { state: 'uploading' });
      const b = await beginInvoiceUpload({ fileName: f.name, mime, size: f.size, location: store || null });
      if (!b.ok) { set(i, { state: 'error', message: b.message }); continue; }
      const { error } = await supabase.storage.from('invoices').upload(b.path, f, { contentType: mime, upsert: false });
      if (error) { set(i, { state: 'error', message: 'The upload didn’t go through. Try again.' }); continue; }
      const done = await finishInvoiceUpload(b.id);
      set(i, done.ok ? { state: 'done' } : { state: 'error', message: done.message });
    }
    setBusy(false);
    if (input.current) input.current.value = '';
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {stores.length > 1 && (
          <Select aria-label="Store" value={store} onChange={(e) => setStore(e.target.value)} className="w-auto">
            <option value="">Whole business</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        )}
        <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,.heic,application/pdf" className="sr-only" id="inv-files"
          onChange={(e) => void upload(e.target.files)} disabled={busy} />
        <Button type="button" onClick={() => input.current?.click()} disabled={busy}>{busy ? 'Uploading…' : 'Upload invoices'}</Button>
        <span className="text-sm text-muted">Photos or PDFs, up to 10 MB each, 25 at a time.</span>
      </div>
      {items.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm" aria-live="polite">
          {items.map((it, i) => (
            <li key={i} className="flex justify-between gap-3 rounded-lg bg-soft px-3 py-1.5">
              <span className="truncate">{it.name}</span>
              <span className={cx('shrink-0 font-semibold', it.state === 'done' && 'text-paid', it.state === 'error' && 'text-late', it.state !== 'done' && it.state !== 'error' && 'text-muted')}>
                {it.state === 'done' ? 'Uploaded' : it.state === 'error' ? it.message : it.state === 'uploading' ? 'Uploading…' : 'Waiting'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
