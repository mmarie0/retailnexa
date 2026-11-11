'use client';
import { useT } from '@/lib/i18n/client';

/** Translates a message that arrives as English (form results, field errors) in the visitor's language. */
export function Tx({ text }: { text: string }) {
  return <>{useT()(text)}</>;
}
