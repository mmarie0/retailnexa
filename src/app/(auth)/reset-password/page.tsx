import type { Metadata } from 'next';
import { ResetForm } from '../forms';

export const metadata: Metadata = { title: 'Choose a new password' };

export default function ResetPage() {
  return (
    <>
      <h1 className="mb-6 text-2xl font-extrabold">Choose a new password</h1>
      <ResetForm />
    </>
  );
}
