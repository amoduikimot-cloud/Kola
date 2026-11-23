-- Kola starter schema
-- Run this in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Money is always stored in kobo (1 naira = 100 kobo) as whole numbers, never as decimals.

-- 1. Sellers / creators ---------------------------------------------------
create table if not exists public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  handle           text unique not null
                   check (handle ~ '^[a-z0-9_]{3,30}$'),
  display_name     text not null check (char_length(display_name) between 2 and 60),
  bio              text check (char_length(bio) <= 280),
  location         text check (char_length(location) <= 80),
  id_verified      boolean not null default false,  -- set by the ID-check provider later, never by the user
  completed_orders integer not null default 0,      -- updated only when escrow releases money
  disputes_total   integer not null default 0,
  disputes_lost    integer not null default 0,
  created_at       timestamptz not null default now()
);

-- 2. Products on a seller's link ----------------------------------------------
create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(name) between 2 and 80),
  description text check (char_length(description) <= 200),
  price_kobo  bigint not null check (price_kobo > 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists products_seller_idx on public.products (seller_id);

-- 3. Orders (escrow) - table is ready, the payment flow comes in step 2 ----------
do $$ begin
  create type public.order_status as enum
    ('pending_payment', 'held', 'shipped', 'delivered', 'released', 'disputed', 'refunded');
exception when duplicate_object then null; end $$;

create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  seller_id       uuid not null references public.profiles (id),
  buyer_name      text not null,
  buyer_email     text,
  buyer_phone     text,
  items           jsonb not null,              -- snapshot of products, names and prices at time of purchase
  subtotal_kobo   bigint not null,
  delivery_kobo   bigint not null default 0,
  fee_kobo        bigint not null default 0,
  total_kobo      bigint not null,
  status          public.order_status not null default 'pending_payment',
  payment_ref     text unique,                 -- Paystack / Flutterwave reference
  tracking_number text,
  shipped_at      timestamptz,
  delivered_at    timestamptz,
  released_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists orders_seller_idx on public.orders (seller_id);

-- 4. Row Level Security --------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.orders   enable row level security;

-- Anyone can view a seller's public link page.
drop policy if exists "profiles are public" on public.profiles;
create policy "profiles are public" on public.profiles for select using (true);

-- A seller can create and edit only their own profile.
drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles for update using (auth.uid() = id);

-- Trust fields (id_verified, completed_orders, disputes_*) can only be set by the
-- server (service role), never by the seller. Sellers may write only these columns:
revoke insert, update on public.profiles from anon, authenticated;
grant insert (id, handle, display_name, bio, location) on public.profiles to authenticated;
grant update (handle, display_name, bio, location) on public.profiles to authenticated;

-- Anyone can see active products; sellers manage their own.
drop policy if exists "active products are public" on public.products;
create policy "active products are public" on public.products for select using (active or auth.uid() = seller_id);
drop policy if exists "own products write" on public.products;
create policy "own products write" on public.products for all
  using (auth.uid() = seller_id) with check (auth.uid() = seller_id);

-- Sellers can read their own orders. Orders are created and moved between
-- statuses only by trusted server code (payment webhooks), so there are no
-- insert/update policies for normal users.
drop policy if exists "seller reads own orders" on public.orders;
create policy "seller reads own orders" on public.orders for select using (auth.uid() = seller_id);
