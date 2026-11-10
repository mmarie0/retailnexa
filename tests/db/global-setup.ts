import { Client } from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adminUrl, TEST_DB } from './helpers';

/** Creates a fresh database, applies the Supabase shim and every migration in order. */
export default async function setup() {
  const admin = new Client({ connectionString: adminUrl('postgres') });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB} with (force)`);
  await admin.query(`create database ${TEST_DB}`);
  await admin.end();

  const c = new Client({ connectionString: adminUrl(TEST_DB) });
  await c.connect();
  const root = join(__dirname, '..', '..');
  await c.query(readFileSync(join(root, 'tests/db/supabase-shim.sql'), 'utf8'));
  const dir = join(root, 'supabase/migrations');
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    try {
      await c.query(readFileSync(join(dir, f), 'utf8'));
    } catch (e) {
      throw new Error(`migration ${f} failed: ${(e as Error).message}`);
    }
  }
  await c.end();
}
