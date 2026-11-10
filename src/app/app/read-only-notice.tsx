import { LinkButton, Notice } from '@/components/ui';

/** Shown on pages whose forms are hidden because billing doesn't allow changes yet (#32, #33). */
export function ReadOnlyNotice({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <Notice tone="warning" action={<LinkButton href="/app/billing" size="sm" variant="secondary">Open billing</LinkButton>}>
      Your account is read-only right now, so new records can’t be added. Check the billing page.
    </Notice>
  );
}
