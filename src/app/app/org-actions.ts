'use server';
import { redirect } from 'next/navigation';
import { getMyOrganizations } from '@/lib/auth/context';
import { setActiveOrgCookie } from '@/lib/auth/org-cookie';

export async function switchOrganization(form: FormData) {
  const id = String(form.get('org') ?? '');
  const orgs = await getMyOrganizations();
  if (orgs.some((o) => o.id === id)) await setActiveOrgCookie(id); // only orgs the user belongs to
  redirect('/app');
}
