// Runs the real migration on PostgreSQL (PGlite, in-process) with a minimal Supabase-like
// auth/storage stub, then checks row-level security, computed balances, invites and storage
// policies the way the app uses them. No Docker or Supabase account needed.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = readFileSync(new URL('../migrations/20261122000000_init.sql', import.meta.url), 'utf8');

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, phone text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
`;

const GRANTS = `
  grant usage on schema public, auth, storage to authenticated, anon;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
  grant select on storage.buckets to authenticated;
  grant execute on function auth.uid() to authenticated;
  grant execute on function storage.foldername(text) to authenticated;
`;

const OWNER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';

let db;
let shopId;

/** Run queries as a signed-in user, with RLS applied. */
async function as(uid, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SUPABASE_STUB);
  await db.exec(MIGRATION);
  await db.exec(GRANTS);
  await db.query(`insert into auth.users (id, phone) values ($1, '+919000000001'), ($2, '+919000000002'), ($3, '+919000000003')`, [OWNER, STAFF, STRANGER]);
}, 60000);

describe('shops and the ledger', () => {
  it('an owner creates a shop and becomes its owner', async () => {
    const [shop] = await as(OWNER, () => q(`select * from public.create_shop('Murugan Stores', 'ta')`));
    shopId = shop.id;
    expect(shop.name).toBe('Murugan Stores');
    const members = await as(OWNER, () => q('select role from public.shop_members'));
    expect(members).toEqual([{ role: 'owner' }]);
  });

  it('writes customers and entries; balances are computed, never stored', async () => {
    await as(OWNER, async () => {
      await q(`insert into public.customers (id, shop_id, name) values ($1, $2, 'Murugan')`, [uuid(1), shopId]);
      await q(
        `insert into public.entries (id, shop_id, customer_id, type, amount, items) values
          ($1, $3, $4, 'credit', 900, '{arisi}'), ($2, $3, $4, 'credit', 240, '{arisi,oil}')`,
        [uuid(10), uuid(11), shopId, uuid(1)],
      );
      await q(`insert into public.entries (id, shop_id, customer_id, type, amount) values ($1, $2, $3, 'payment', 100)`, [uuid(12), shopId, uuid(1)]);
    });
    const [row] = await as(OWNER, () => q('select balance::float as balance from public.customer_balances'));
    expect(row.balance).toBe(1040);
  });

  it('soft-deleted and needs-review rows do not count', async () => {
    await as(OWNER, async () => {
      await q(`update public.entries set deleted_at = now() where id = $1`, [uuid(12)]);
      await q(`insert into public.entries (id, shop_id, status, review_reason, transcript) values ($1, $2, 'needs_review', 'noisy', '…')`, [uuid(13), shopId]);
    });
    const [row] = await as(OWNER, () => q('select balance::float as balance from public.customer_balances'));
    expect(row.balance).toBe(1140);
  });

  it('a confirmed entry must have a customer, type and amount', async () => {
    await expect(as(OWNER, () => q(`insert into public.entries (id, shop_id, status) values ($1, $2, 'confirmed')`, [uuid(14), shopId])))
      .rejects.toThrow(/confirmed_entries_complete/);
  });

  it('updated_at is set by the server so devices can pull changes', async () => {
    const [before] = await as(OWNER, () => q('select updated_at from public.customers where id = $1', [uuid(1)]));
    await new Promise((r) => setTimeout(r, 20));
    await as(OWNER, () => q(`update public.customers set phone = '9876543210', updated_at = '2000-01-01' where id = $1`, [uuid(1)]));
    const [after] = await as(OWNER, () => q('select updated_at from public.customers where id = $1', [uuid(1)]));
    expect(new Date(after.updated_at) > new Date(before.updated_at)).toBe(true);
  });
});

describe('row-level security', () => {
  it('another user sees nothing of this shop', async () => {
    const seen = await as(STRANGER, async () => ({
      shops: await q('select * from public.shops'),
      customers: await q('select * from public.customers'),
      entries: await q('select * from public.entries'),
      balances: await q('select * from public.customer_balances'),
    }));
    expect(seen).toEqual({ shops: [], customers: [], entries: [], balances: [] });
  });

  it('another user cannot write into this shop', async () => {
    await expect(as(STRANGER, () => q(`insert into public.customers (id, shop_id, name) values ($1, $2, 'Intruder')`, [uuid(2), shopId])))
      .rejects.toThrow(/row-level security/);
    const updated = await as(STRANGER, () => q(`update public.entries set amount = 1 where shop_id = $1 returning id`, [shopId]));
    expect(updated).toEqual([]);
  });

  it('nobody can sign up a membership directly', async () => {
    await expect(as(STRANGER, () => q(`insert into public.shop_members (shop_id, user_id, role) values ($1, $2, 'owner')`, [shopId, STRANGER])))
      .rejects.toThrow(/row-level security/);
  });
});

describe('staff invites', () => {
  let code;

  it('only the owner can create an invite code', async () => {
    [{ create_invite: code }] = await as(OWNER, () => q('select public.create_invite($1)', [shopId]));
    expect(code).toMatch(/^\d{6}$/);
    await expect(as(STRANGER, () => q('select public.create_invite($1)', [shopId]))).rejects.toThrow(/only the shop owner/);
  });

  it('staff join with the code and can then use the ledger', async () => {
    const [shop] = await as(STAFF, () => q('select * from public.join_shop($1)', [code]));
    expect(shop.id).toBe(shopId);
    const customers = await as(STAFF, () => q('select name from public.customers'));
    expect(customers.map((c) => c.name)).toEqual(['Murugan']);
    await as(STAFF, () => q(`insert into public.entries (id, shop_id, customer_id, type, amount) values ($1, $2, $3, 'credit', 50)`, [uuid(15), shopId, uuid(1)]));
    const [mine] = await as(OWNER, () => q('select created_by from public.entries where id = $1', [uuid(15)]));
    expect(mine.created_by).toBe(STAFF);
  });

  it('a code works once', async () => {
    await expect(as(STRANGER, () => q('select * from public.join_shop($1)', [code]))).rejects.toThrow(/invalid or expired/);
  });

  it('expired codes are refused', async () => {
    const [{ create_invite: old }] = await as(OWNER, () => q('select public.create_invite($1)', [shopId]));
    await db.query(`update public.shop_invites set expires_at = now() - interval '1 minute' where code = $1`, [old]);
    await expect(as(STRANGER, () => q('select * from public.join_shop($1)', [old]))).rejects.toThrow(/invalid or expired/);
  });

  it('members see each other; staff cannot hard-delete, only soft-delete', async () => {
    const members = await as(STAFF, () => q('select role from public.shop_members order by role'));
    expect(members.map((m) => m.role)).toEqual(['owner', 'staff']);
    const hard = await as(STAFF, () => q('delete from public.entries where id = $1 returning id', [uuid(15)]));
    expect(hard).toEqual([]);
    const soft = await as(STAFF, () => q('update public.entries set deleted_at = now() where id = $1 returning id', [uuid(15)]));
    expect(soft).toHaveLength(1);
    const owner = await as(OWNER, () => q('delete from public.entries where id = $1 returning id', [uuid(15)]));
    expect(owner).toHaveLength(1);
  });

  it('staff cannot rename the shop or invite others', async () => {
    const renamed = await as(STAFF, () => q(`update public.shops set name = 'Mine now' returning id`));
    expect(renamed).toEqual([]);
    await expect(as(STAFF, () => q('select public.create_invite($1)', [shopId]))).rejects.toThrow(/only the shop owner/);
  });
});

describe('audio storage policies', () => {
  it('shop members can store clips under their shop folder only', async () => {
    await as(STAFF, () => q(`insert into storage.objects (bucket_id, name) values ('entry-audio', $1)`, [`${shopId}/${uuid(10)}.webm`]));
    await expect(as(STRANGER, () => q(`insert into storage.objects (bucket_id, name) values ('entry-audio', $1)`, [`${shopId}/evil.webm`])))
      .rejects.toThrow(/row-level security/);
    const visible = await as(STRANGER, () => q(`select name from storage.objects`));
    expect(visible).toEqual([]);
    const forOwner = await as(OWNER, () => q(`select name from storage.objects`));
    expect(forOwner).toHaveLength(1);
  });

  it('the bucket is private', async () => {
    const [b] = await q(`select public from storage.buckets where id = 'entry-audio'`);
    expect(b.public).toBe(false);
  });
});
