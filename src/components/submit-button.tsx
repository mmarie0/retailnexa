'use client';
import { useFormStatus } from 'react-dom';
import { Button } from './ui';
import type { ComponentProps } from 'react';

export function SubmitButton({ children, pendingText, ...rest }: ComponentProps<typeof Button> & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || rest.disabled} aria-busy={pending} {...rest}>
      {pending ? (pendingText ?? 'Working…') : children}
    </Button>
  );
}
