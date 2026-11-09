import type { Metadata } from 'next';
import Link from 'next/link';
import { ForgotForm } from '../forms';

export const metadata: Metadata = { title: 'Reset your password' };

export default function ForgotPage() {
  return (
    <>
      <h1 className="text-2xl font-extrabold">Reset your password</h1>
      <p className="mb-6 mt-1 text-muted">We’ll email you a link. <Link href="/login" className="font-semibold text-accent-strong">Back to log in</Link></p>
      <ForgotForm />
    </>
  );
}
