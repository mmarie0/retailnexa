import { Client } from 'pg';
import { randomUUID } from 'node:crypto';

export const TEST_DB = process.env.TEST_DATABASE_NAME ?? 'retailnexa_test';
const base = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432';

export function adminUrl(db = 'postgres') {
  return `${base}/${db}`;
}

let client: Client | null = null;

export async function db(): Promise<Client> {
  if (!client) {
    client = new Client({ connectionString: adminUrl(TEST_DB) });
    await client.connect();
  }
  return client;
}

export async function closeDb() {
  await client?.end();
  client = null;
}

export type Actor =
  | { kind: 'anon' }
  | { kind: 'service' }
  | { kind: 'user'; id: string; email?: string; aal?: 'aal1' | 'aal2' };

/**
 * Runs one statement as a Supabase API role inside its own transaction, exactly
 * as PostgREST would: SET LOCAL ROLE + request.jwt.claims.
 */
export async function as<T = Record<string, unknown>>(actor: Actor, sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await db();
  await c.query('begin');
  try {
    if (actor.kind === 'anon') {
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'anon' })]);
      await c.query('set local role anon');
    } else if (actor.kind === 'service') {
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'service_role' })]);
      await c.query('set local role service_role');
    } else {
      const claims = { sub: actor.id, role: 'authenticated', email: actor.email, aal: actor.aal ?? 'aal1' };
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      await c.query('set local role authenticated');
    }
    const res = await c.query(sql, params);
    await c.query('commit');
    return res.rows as T[];
  } catch (e) {
    await c.query('rollback');
    throw e;
  }
}

/** Superuser query (fixture setup / assertions on raw state). */
export async function sys<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await db();
  return (await c.query(sql, params)).rows as T[];
}

export async function createUser(name: string) {
  const email = `${name}.${randomUUID().slice(0, 8)}@example.test`;
  const [row] = await sys<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [email, JSON.stringify({ full_name: name })],
  );
  return { kind: 'user' as const, id: row.id, email };
}

export type TestUser = Awaited<ReturnType<typeof createUser>>;

export async function createOrg(owner: TestUser, name: string, type: 'retail' | 'wholesale' | 'both' = 'retail') {
  const [row] = await as<{ id: string }>(owner, `select public.create_organization($1, $2::public.business_type) as id`, [name, type]);
  return row.id;
}

/** Invite + accept, returning the new membership id. */
export async function addMember(inviter: TestUser, org: string, user: TestUser, role: string) {
  const [inv] = await as<{ token: string }>(inviter, `select token from public.invite_member($1, $2, $3::public.member_role)`, [org, user.email, role]);
  await as(user, `select public.accept_invitation($1)`, [inv.token]);
  const [m] = await sys<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2`, [org, user.id]);
  return m.id;
}

export async function expectDenied(p: Promise<unknown>, pattern: RegExp = /permission denied|row-level security|cannot|must keep|different email|invalid or expired|not active/i) {
  let err: unknown;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  if (!err) throw new Error('expected the operation to be denied, but it succeeded');
  const msg = (err as Error).message;
  if (!pattern.test(msg)) throw new Error(`denied with unexpected error: ${msg}`);
}
