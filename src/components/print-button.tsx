'use client';
import { Button } from './ui';

export function PrintButton({ label = 'Print' }: { label?: string }) {
  return <Button type="button" variant="secondary" size="sm" className="no-print" onClick={() => window.print()}>{label}</Button>;
}
