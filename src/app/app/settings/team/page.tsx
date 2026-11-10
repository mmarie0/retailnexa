import type { Metadata } from 'next';
import { can, getOrgContext, getSupabase } from '@/lib/auth/context';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, PageHeader, Select } from '@/components/ui';
import { ReadOnlyNotice } from '../../read-only-notice';
import { SubmitButton } from '@/components/submit-button';
import { ALL_PERMISSIONS, PERMISSIONS, ROLE_DEFAULTS, ROLE_LABELS, assignableRoles, canManageMember, isMemberRole, type MemberRole } from '@/lib/auth/permissions';
import { changeMemberRole, revokeInvitation, setMemberPermission, setMemberStatus, setMemberStores } from '../actions';
import { InviteForm } from './invite-form';

export const metadata: Metadata = { title: 'Team' };

export default async function TeamPage() {
  const ctx = await getOrgContext();
  if (!can(ctx, 'members.view')) return <p>You don’t have access to the team list.</p>;
  const supabase = await getSupabase();
  const [{ data: members }, { data: overrides }, { data: invites }, { data: locs }, { data: memberLocs }] = await Promise.all([
    supabase.from('memberships').select('id, user_id, role, status, created_at').eq('organization_id', ctx.org.id).order('created_at'),
    supabase.from('member_permission_overrides').select('membership_id, permission, granted').eq('organization_id', ctx.org.id),
    can(ctx, 'members.manage')
      ? supabase.from('invitations').select('id, email, role, expires_at, accepted_at, revoked_at').eq('organization_id', ctx.org.id).is('accepted_at', null).is('revoked_at', null).gt('expires_at', new Date().toISOString())
      : Promise.resolve({ data: [] as { id: string; email: string; role: string; expires_at: string }[] }),
    supabase.from('locations').select('id, name, kind').eq('organization_id', ctx.org.id).eq('is_active', true).order('name'),
    supabase.from('member_locations').select('membership_id, location_id').eq('organization_id', ctx.org.id),
  ]);
  const locations = (locs ?? []) as { id: string; name: string; kind: string }[];
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  const ids = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = ids.length ? await supabase.from('profiles').select('id, email, full_name').in('id', ids) : { data: [] };
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

  const myRole = ctx.org.role;
  const manage = can(ctx, 'members.manage') && ctx.access.canWrite;
  const managePerms = can(ctx, 'roles.manage') && ctx.access.canWrite;

  return (
    <>
      <PageHeader title="Team" description="Who can sign in to this business and what each person can see and do." />
      <ReadOnlyNotice show={can(ctx, 'members.manage') && !ctx.access.canWrite} />
      <ul className="flex flex-col gap-3">
        {(members ?? []).map((m) => {
          const p = byId.get(m.user_id);
          const role = isMemberRole(m.role) ? m.role : ('viewer' as MemberRole);
          const self = m.user_id === ctx.user.id;
          const editable = manage && canManageMember(myRole, role, self);
          const memberOverrides = (overrides ?? []).filter((o) => o.membership_id === m.id);
          const myStores = (memberLocs ?? []).filter((x) => x.membership_id === m.id).map((x) => x.location_id as string);
          const alwaysAll = role === 'owner' || role === 'admin';
          return (
            <li key={m.id}>
              <Card className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-bold">{p?.full_name || p?.email || 'Team member'}{self && <span className="font-normal text-muted"> (you)</span>}</p>
                    <p className="text-sm text-muted">{p?.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="info">{ROLE_LABELS[role]}</Badge>
                    {m.status === 'disabled' && <Badge tone="danger">No access</Badge>}
                    {memberOverrides.length > 0 && <Badge>{memberOverrides.length} custom permission{memberOverrides.length > 1 ? 's' : ''}</Badge>}
                    {locations.length > 1 && !alwaysAll && (
                      <Badge>{myStores.length ? myStores.map((id) => locName.get(id) ?? 'Store').join(', ') : 'All stores'}</Badge>
                    )}
                  </div>
                </div>
                {editable && (
                  <div className="flex flex-wrap items-start gap-3">
                    <ActionForm action={changeMemberRole} className="flex items-start gap-2">
                      <input type="hidden" name="membership_id" value={m.id} />
                      <Select name="role" defaultValue={role} aria-label={`Role for ${p?.email ?? 'member'}`} className="w-auto py-1.5 text-sm">
                        {assignableRoles(myRole, 'change').map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </Select>
                      <SubmitButton size="sm" variant="secondary" pendingText="Saving…">Change role</SubmitButton>
                    </ActionForm>
                    <ActionForm action={setMemberStatus}>
                      <input type="hidden" name="membership_id" value={m.id} />
                      <input type="hidden" name="status" value={m.status === 'active' ? 'disabled' : 'active'} />
                      <SubmitButton size="sm" variant={m.status === 'active' ? 'danger' : 'secondary'} pendingText="Saving…">
                        {m.status === 'active' ? 'Remove access' : 'Restore access'}
                      </SubmitButton>
                    </ActionForm>
                  </div>
                )}
                {editable && !alwaysAll && locations.length > 1 && (
                  <details className="rounded-xl bg-soft p-3">
                    <summary className="cursor-pointer font-semibold">Stores this person can see</summary>
                    <p className="mt-2 text-sm text-muted">Limit someone to their own store: they’ll only see and record that store’s sales days, bills and cash deposits. Owners and admins always see every store.</p>
                    <ActionForm action={setMemberStores} className="mt-2 flex flex-col gap-2">
                      <input type="hidden" name="membership_id" value={m.id} />
                      <label className="flex items-center gap-2 text-[15px]"><input type="radio" name="scope" value="all" defaultChecked={myStores.length === 0} className="size-4 accent-[#3f63de]" /> All stores</label>
                      <label className="flex items-center gap-2 text-[15px]"><input type="radio" name="scope" value="some" defaultChecked={myStores.length > 0} className="size-4 accent-[#3f63de]" /> Only these:</label>
                      <div className="ml-6 flex flex-col gap-1">
                        {locations.map((l) => (
                          <label key={l.id} className="flex items-center gap-2 text-[15px]">
                            <input type="checkbox" name="location_id" value={l.id} defaultChecked={myStores.includes(l.id)} className="size-4 accent-[#3f63de]" />
                            {l.name}{l.kind === 'warehouse' && <span className="text-muted"> · warehouse</span>}
                          </label>
                        ))}
                      </div>
                      <SubmitButton size="sm" variant="secondary" className="self-start" pendingText="Saving…">Save stores</SubmitButton>
                    </ActionForm>
                  </details>
                )}
                {managePerms && editable && role !== 'owner' && (
                  <details className="rounded-xl bg-soft p-3">
                    <summary className="cursor-pointer font-semibold">Adjust individual permissions</summary>
                    <p className="mt-2 text-sm text-muted">“Role default” follows the {ROLE_LABELS[role]} role. You can only allow permissions you hold yourself.</p>
                    <ul className="mt-2 divide-y divide-line">
                      {ALL_PERMISSIONS.map((perm) => {
                        const o = memberOverrides.find((x) => x.permission === perm);
                        const def = ROLE_DEFAULTS[role].includes(perm);
                        const current = o ? (o.granted ? 'grant' : 'revoke') : 'default';
                        return (
                          <li key={perm} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                            <span className="text-sm">{PERMISSIONS[perm].label}{PERMISSIONS[perm].sensitive && <span className="ml-1.5 text-soon">· sensitive</span>}</span>
                            <ActionForm action={setMemberPermission} className="flex items-center gap-2">
                              <input type="hidden" name="membership_id" value={m.id} />
                              <input type="hidden" name="permission" value={perm} />
                              <Select name="value" defaultValue={current} aria-label={PERMISSIONS[perm].label} className="w-auto py-1 text-sm">
                                <option value="default">Role default ({def ? 'allowed' : 'not allowed'})</option>
                                <option value="grant">Allow</option>
                                <option value="revoke">Don’t allow</option>
                              </Select>
                              <SubmitButton size="sm" variant="ghost" pendingText="…">Set</SubmitButton>
                            </ActionForm>
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                )}
              </Card>
            </li>
          );
        })}
      </ul>

      {manage && (
        <Card>
          <h2 className="mb-1 text-lg font-bold">Invite someone</h2>
          <p className="mb-4 text-muted">You can give roles below your own. They’ll create a login with the invited email address.</p>
          <InviteForm roles={assignableRoles(myRole, 'invite')} />
        </Card>
      )}

      {manage && (invites ?? []).length > 0 && (
        <Card>
          <h2 className="mb-3 text-lg font-bold">Pending invitations</h2>
          <ul className="divide-y divide-line">
            {(invites ?? []).map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span>{i.email} <span className="text-muted">· {isMemberRole(i.role) ? ROLE_LABELS[i.role] : i.role} · expires {new Date(i.expires_at).toLocaleDateString()}</span></span>
                <ActionForm action={revokeInvitation}>
                  <input type="hidden" name="invitation_id" value={i.id} />
                  <SubmitButton size="sm" variant="ghost" pendingText="…">Revoke</SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
