import { LinkButton, Notice } from '@/components/ui';
import { getT } from '@/lib/i18n/server';

/** Shown on pages whose forms are hidden because billing doesn't allow changes yet (#32, #33). */
export async function ReadOnlyNotice({ show }: { show: boolean }) {
  const t = await getT();
  if (!show) return null;
  return (
    <Notice tone="warning" action={<LinkButton href="/app/billing" size="sm" variant="secondary">{t('Open billing')}</LinkButton>}>
      {t('Your account is read-only right now, so new records can’t be added. Check the billing page.')}
    </Notice>
  );
}
