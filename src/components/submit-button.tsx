'use client';
import { useFormStatus } from 'react-dom';
import { Button } from './ui';
import type { ComponentProps } from 'react';
import { useT } from '@/lib/i18n/client';

export function SubmitButton({ children, pendingText, ...rest }: ComponentProps<typeof Button> & { pendingText?: string }) {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <Button type="submit" disabled={pending || rest.disabled} aria-busy={pending} {...rest}>
      {pending ? (pendingText ?? t('Working…')) : children}
    </Button>
  );
}
