-- Kadan Kanakku: shops, staff, customers, aliases, ledger entries, audio storage.
-- Every row belongs to a shop; row-level security limits each user to the
-- shops they are a member of. Balances are never stored, always computed.
-- (gen_random_uuid() is built into Postgres 13+.)

-- ───────────────────────── tables ─────────────────────────

create table public.shops (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 80),
  lang        text not null default 'ta',          -- default reply language
  created_by  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.shop_members (
  shop_id    uuid not null references public.shops(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'owner' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (shop_id, user_id)
);

create table public.customers (
  id          uuid primary key,                      -- generated on the device (offline-first)
  shop_id     uuid not null references public.shops(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  name_ta     text,                                  -- Tamil-script name, used for speech
  honorific   text,                                  -- anna / akka / ...
  phone       text,
  last_reminded_at timestamptz,                      -- last WhatsApp reminder sent
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index customers_shop_idx on public.customers (shop_id, updated_at);

-- Shop-specific spoken forms learned from corrections ("Muruges" -> Murugan).
create table public.customer_aliases (
  id          uuid primary key,
  shop_id     uuid not null references public.shops(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  alias       text not null check (char_length(alias) between 1 and 80),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index aliases_shop_idx on public.customer_aliases (shop_id, updated_at);

create table public.entries (
  id           uuid primary key,                     -- generated on the device
  shop_id      uuid not null references public.shops(id) on delete cascade,
  customer_id  uuid references public.customers(id) on delete set null,
  type         text check (type in ('credit', 'payment')),
  amount       numeric(12, 2) check (amount is null or amount > 0),
  items        text[] not null default '{}',
  transcript   text,
  audio_path   text,                                 -- storage path in bucket entry-audio
  confidence   real check (confidence is null or (confidence >= 0 and confidence <= 1)),
  lang         text,
  source       text not null default 'voice' check (source in ('voice', 'manual', 'seed')),
  status       text not null default 'confirmed'
               check (status in ('confirmed', 'needs_review', 'discarded')),
  review_reason text,
  suggestion   jsonb,                                -- parse suggestion for needs_review rows
  created_by   uuid default auth.uid() references auth.users(id) on delete set null, -- owner or staff
  created_at   timestamptz not null default now(),   -- when the sale happened (device time)
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  constraint confirmed_entries_complete check (
    status <> 'confirmed' or (customer_id is not null and type is not null and amount is not null)
  )
);
create index entries_shop_idx on public.entries (shop_id, updated_at);
create index entries_customer_idx on public.entries (customer_id, created_at);

-- One-time codes an owner shares with staff ("join my shop": 6 digits, valid 2 days).
create table public.shop_invites (
  code        text primary key check (code ~ '^[0-9]{6}$'),
  shop_id     uuid not null references public.shops(id) on delete cascade,
  role        text not null default 'staff' check (role in ('owner', 'staff')),
  created_by  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '2 days',
  used_by     uuid references auth.users(id) on delete set null,
  used_at     timestamptz
);

-- updated_at is always server time so devices can pull "changed since".
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger shops_touch     before insert or update on public.shops            for each row execute function public.touch_updated_at();
create trigger customers_touch before insert or update on public.customers        for each row execute function public.touch_updated_at();
create trigger aliases_touch   before insert or update on public.customer_aliases for each row execute function public.touch_updated_at();
create trigger entries_touch   before insert or update on public.entries          for each row execute function public.touch_updated_at();

-- ───────────────────────── computed balances ─────────────────────────

create or replace view public.customer_balances
with (security_invoker = true) as
select
  c.shop_id,
  c.id as customer_id,
  c.name,
  coalesce(sum(case when e.type = 'credit' then e.amount else -e.amount end), 0)::numeric(12, 2) as balance,
  max(e.created_at) as last_entry_at
from public.customers c
left join public.entries e
  on e.customer_id = c.id and e.status = 'confirmed' and e.deleted_at is null
where c.deleted_at is null
group by c.shop_id, c.id, c.name;

-- ───────────────────────── row-level security ─────────────────────────

create or replace function public.is_shop_member(p_shop uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.shop_members m where m.shop_id = p_shop and m.user_id = auth.uid()
  );
$$;
revoke all on function public.is_shop_member(uuid) from public;
grant execute on function public.is_shop_member(uuid) to authenticated;

create or replace function public.is_shop_owner(p_shop uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.shop_members m
    where m.shop_id = p_shop and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;
revoke all on function public.is_shop_owner(uuid) from public;
grant execute on function public.is_shop_owner(uuid) to authenticated;

alter table public.shops            enable row level security;
alter table public.shop_members     enable row level security;
alter table public.customers        enable row level security;
alter table public.customer_aliases enable row level security;
alter table public.entries          enable row level security;
alter table public.shop_invites     enable row level security;

create policy shops_select on public.shops for select to authenticated using (public.is_shop_member(id));
create policy shops_update on public.shops for update to authenticated using (public.is_shop_owner(id)) with check (public.is_shop_owner(id));

-- Members see who else works in their shop; only owners remove people.
create policy members_select on public.shop_members for select to authenticated using (public.is_shop_member(shop_id));
create policy members_delete on public.shop_members for delete to authenticated using (public.is_shop_owner(shop_id) and user_id <> auth.uid());

-- Owner and staff read and write the ledger. Rows are "deleted" by setting deleted_at
-- (an update, kept for disputes); a hard DELETE is owner-only.
create policy customers_select on public.customers for select to authenticated using (public.is_shop_member(shop_id));
create policy customers_insert on public.customers for insert to authenticated with check (public.is_shop_member(shop_id));
create policy customers_update on public.customers for update to authenticated using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));
create policy customers_delete on public.customers for delete to authenticated using (public.is_shop_owner(shop_id));

create policy aliases_select on public.customer_aliases for select to authenticated using (public.is_shop_member(shop_id));
create policy aliases_insert on public.customer_aliases for insert to authenticated with check (public.is_shop_member(shop_id));
create policy aliases_update on public.customer_aliases for update to authenticated using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));
create policy aliases_delete on public.customer_aliases for delete to authenticated using (public.is_shop_owner(shop_id));

create policy entries_select on public.entries for select to authenticated using (public.is_shop_member(shop_id));
create policy entries_insert on public.entries for insert to authenticated with check (public.is_shop_member(shop_id));
create policy entries_update on public.entries for update to authenticated using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));
create policy entries_delete on public.entries for delete to authenticated using (public.is_shop_owner(shop_id));

create policy invites_select on public.shop_invites for select to authenticated using (public.is_shop_owner(shop_id));

-- Owner creates a 6-digit invite code for a staff member.
create or replace function public.create_invite(p_shop uuid, p_role text default 'staff')
returns text
language plpgsql security definer set search_path = public as $$
declare
  c text;
begin
  if not public.is_shop_owner(p_shop) then
    raise exception 'only the shop owner can invite staff';
  end if;
  loop
    c := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from public.shop_invites where code = c);
  end loop;
  insert into public.shop_invites (code, shop_id, role, created_by)
  values (c, p_shop, coalesce(p_role, 'staff'), auth.uid());
  return c;
end $$;
revoke all on function public.create_invite(uuid, text) from public;
grant execute on function public.create_invite(uuid, text) to authenticated;

-- Staff member signs in with their own phone and redeems the code.
create or replace function public.join_shop(p_code text)
returns public.shops
language plpgsql security definer set search_path = public as $$
declare
  inv public.shop_invites;
  s public.shops;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  select * into inv from public.shop_invites
  where code = trim(p_code) and used_at is null and expires_at > now()
  for update;
  if not found then
    raise exception 'invite code is invalid or expired';
  end if;
  insert into public.shop_members (shop_id, user_id, role)
  values (inv.shop_id, auth.uid(), inv.role)
  on conflict (shop_id, user_id) do nothing;
  update public.shop_invites set used_by = auth.uid(), used_at = now() where code = inv.code;
  select * into s from public.shops where id = inv.shop_id;
  return s;
end $$;
revoke all on function public.join_shop(text) from public;
grant execute on function public.join_shop(text) to authenticated;

-- A signed-in owner creates their shop (and membership) in one call.
create or replace function public.create_shop(p_name text, p_lang text default 'ta')
returns public.shops
language plpgsql security definer set search_path = public as $$
declare
  s public.shops;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  insert into public.shops (name, lang, created_by) values (p_name, coalesce(p_lang, 'ta'), auth.uid())
  returning * into s;
  insert into public.shop_members (shop_id, user_id, role) values (s.id, auth.uid(), 'owner');
  return s;
end $$;
revoke all on function public.create_shop(text, text) from public;
grant execute on function public.create_shop(text, text) to authenticated;

-- ───────────────────────── audio storage ─────────────────────────
-- Objects are stored as <shop_id>/<entry_id>.<ext>; only shop members can read/write.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('entry-audio', 'entry-audio', false, 2097152,
        array['audio/webm', 'audio/ogg', 'audio/wav', 'audio/mp4', 'audio/mpeg', 'audio/aac'])
on conflict (id) do nothing;

create policy audio_select on storage.objects for select to authenticated
  using (bucket_id = 'entry-audio' and public.is_shop_member(((storage.foldername(name))[1])::uuid));
create policy audio_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'entry-audio' and public.is_shop_member(((storage.foldername(name))[1])::uuid));
create policy audio_update on storage.objects for update to authenticated
  using (bucket_id = 'entry-audio' and public.is_shop_member(((storage.foldername(name))[1])::uuid));
create policy audio_delete on storage.objects for delete to authenticated
  using (bucket_id = 'entry-audio' and public.is_shop_owner(((storage.foldername(name))[1])::uuid));
