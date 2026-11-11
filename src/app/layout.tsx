import type { Metadata, Viewport } from 'next';
import './globals.css';
import { siteUrl } from '@/lib/env';
import { dirOf } from '@/lib/i18n/config';
import { I18nProvider } from '@/lib/i18n/client';
import { dictFor, getLocale, getT } from '@/lib/i18n/server';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: 'RetailNexa — sales, bills and bookkeeping for retail and wholesale', template: '%s · RetailNexa' },
  description: 'One place for daily sales, vendor bills, inventory, staff, wholesale ordering and double-entry bookkeeping. Built for independent retail stores and wholesale distributors.',
};

export const viewport: Viewport = { themeColor: '#ddeffc', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = await getT();
  return (
    <html lang={locale} dir={dirOf(locale)}>
      <body className="min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2">{t('Skip to content')}</a>
        <I18nProvider locale={locale} dict={dictFor(locale)}>{children}</I18nProvider>
      </body>
    </html>
  );
}
