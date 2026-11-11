'use client';
/* eslint-disable @next/next/no-img-element -- photos are short-lived signed links from private storage, not optimizable */
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, cx } from '@/components/ui';
import { createBrowserSupabase } from '@/lib/supabase/browser';
import type { ActionState } from '@/lib/actions';

export interface DesignItem { id: string; name: string; sku: string | null; category: string | null; subcategory: string | null; image: string | null }
const GRID = { s: 'grid-cols-3 sm:grid-cols-5', m: 'grid-cols-2 sm:grid-cols-3', l: 'grid-cols-1 sm:grid-cols-2' } as const;
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX = 3 * 1024 * 1024;

/**
 * Arrange the order screen's grid: drag tiles (or use the arrows) into the
 * order you want, and add a photo to any item. Photos upload straight to the
 * private item-images bucket; the server checks the path and links it.
 */
export function CatalogDesigner({ org, items: start, size, saveOrder, setImage }: {
  org: string; items: DesignItem[]; size: 's' | 'm' | 'l';
  saveOrder: (ids: string[]) => Promise<ActionState>;
  setImage: (item: string, path: string | null) => Promise<ActionState>;
}) {
  const router = useRouter();
  const [items, setItems] = useState(start);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<ActionState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Photos come from the server (fresh signed links after each refresh); the order is local until saved.
  const photo = new Map(start.map((i) => [i.id, i.image]));
  const file = useRef<HTMLInputElement>(null);
  const target = useRef<string | null>(null);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    setItems(next); setDirty(true); setMsg(null);
  };
  const onDrop = (overId: string) => {
    if (!dragId || dragId === overId) return;
    move(items.findIndex((i) => i.id === dragId), items.findIndex((i) => i.id === overId));
    setDragId(null);
  };
  async function upload(f: File | undefined) {
    const id = target.current;
    if (!f || !id) return;
    const ext = TYPES[f.type];
    if (!ext) return setMsg({ ok: false, message: 'Use a JPEG, PNG or WebP photo.' });
    if (f.size > MAX) return setMsg({ ok: false, message: 'Photos can be up to 3 MB.' });
    setBusy(id); setMsg(null);
    const path = `${org}/${id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await createBrowserSupabase().storage.from('item-images').upload(path, f, { contentType: f.type, upsert: false });
    if (error) { setBusy(null); return setMsg({ ok: false, message: 'The upload didn’t go through. Try again.' }); }
    const r = await setImage(id, path);
    setBusy(null); setMsg(r);
    if (file.current) file.current.value = '';
    if (r.ok) router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Item photo" onChange={(e) => void upload(e.target.files?.[0])} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={!dirty || pending} onClick={() => startTransition(async () => { const r = await saveOrder(items.map((i) => i.id)); setMsg(r); if (r.ok) setDirty(false); })}>
          {pending ? 'Saving…' : 'Save this order'}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => { setItems([...items].sort((a, b) => a.name.localeCompare(b.name))); setDirty(true); }}>Sort A–Z</Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => {
          setItems([...items].sort((a, b) => (a.category ?? '~').localeCompare(b.category ?? '~') || (a.subcategory ?? '~').localeCompare(b.subcategory ?? '~') || a.name.localeCompare(b.name))); setDirty(true);
        }}>Group by category</Button>
        {dirty && <span className="text-sm text-muted">Unsaved changes</span>}
        {msg?.message && <span role="status" className={cx('text-sm font-semibold', msg.ok ? 'text-paid' : 'text-late')}>{msg.message}</span>}
      </div>
      <ul className={cx('grid gap-2', GRID[size])}>
        {items.map((it, i) => (
          <li key={it.id} draggable onDragStart={() => setDragId(it.id)} onDragOver={(e) => e.preventDefault()} onDrop={() => onDrop(it.id)} onDragEnd={() => setDragId(null)}
            className={cx('flex cursor-grab flex-col gap-1.5 overflow-hidden rounded-[16px] bg-card p-2.5 shadow-[var(--shadow-card)] active:cursor-grabbing', dragId === it.id && 'opacity-50 ring-2 ring-accent')}>
            <button type="button" onClick={() => { target.current = it.id; file.current?.click(); }} disabled={busy === it.id}
              className="group relative -mx-2.5 -mt-2.5 mb-1 aspect-square w-[calc(100%+1.25rem)] overflow-hidden bg-soft" aria-label={`${photo.get(it.id) ? 'Change' : 'Add'} photo for ${it.name}`}>
              {photo.get(it.id) ? <img loading="lazy" src={photo.get(it.id)!} alt="" className="size-full object-cover" /> : <span className="grid size-full place-items-center text-sm font-semibold text-muted">{busy === it.id ? 'Uploading…' : '+ Add photo'}</span>}
              {photo.get(it.id) && <span className="absolute inset-x-0 bottom-0 bg-black/45 py-1 text-xs font-semibold text-white opacity-0 group-hover:opacity-100">{busy === it.id ? 'Uploading…' : 'Change photo'}</span>}
            </button>
            <p className="text-[13.5px] font-bold leading-snug">{it.name}</p>
            <p className="truncate text-xs text-muted">{[it.sku, [it.category, it.subcategory].filter(Boolean).join(' › ')].filter(Boolean).join(' · ') || ' '}</p>
            <div className="mt-auto flex items-center justify-between gap-1">
              <span className="flex gap-1">
                <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move ${it.name} earlier`} className="rounded-full bg-soft px-2 py-0.5 text-sm disabled:opacity-40">‹</button>
                <button type="button" onClick={() => move(i, i + 1)} disabled={i === items.length - 1} aria-label={`Move ${it.name} later`} className="rounded-full bg-soft px-2 py-0.5 text-sm disabled:opacity-40">›</button>
              </span>
              {photo.get(it.id) && <button type="button" onClick={async () => { const r = await setImage(it.id, null); setMsg(r); if (r.ok) router.refresh(); }} className="text-xs font-semibold text-muted hover:text-late">Remove photo</button>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
