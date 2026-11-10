import type { Metadata, Viewport } from 'next';
import './globals.css';
import { siteUrl } from '@/lib/env';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: 'RetailNexa — sales, bills and bookkeeping for retail and wholesale', template: '%s · RetailNexa' },
  description: 'One place for daily sales, vendor bills, inventory, staff, wholesale ordering and double-entry bookkeeping. Built for independent retail stores and wholesale distributors.',
};

export const viewport: Viewport = { themeColor: '#ddeffc', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
