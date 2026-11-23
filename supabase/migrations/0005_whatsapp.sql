-- Kola WhatsApp notifications (run after 0004_delivery_code.sql)
-- Supabase dashboard: SQL Editor -> New query -> paste -> Run.

-- 1. Seller's WhatsApp number -------------------------------------------------
-- Kept OUT of `profiles`, because profiles are public (anyone can read a seller page).
create table if not exists public.seller_contacts (
  seller_id      uuid primary key references public.profiles (id) on delete cascade,
  whatsapp_phone text not null check (whatsapp_phone ~ '^[0-9]{10,15}$'),  -- international format, digits only: 2348031234567
  opted_in_at    timestamptz not null default now()
);
alter table public.seller_contacts enable row level security;
drop policy if exists "seller manages own contact" on public.seller_contacts;
create policy "seller manages own contact" on public.seller_contacts for all
  using (auth.uid() = seller_id) with check (auth.uid() = seller_id);

-- 2. Order fields for WhatsApp --------------------------------------------------
alter table public.orders
  add column if not exists buyer_whatsapp_optin         boolean not null default false,
  add column if not exists buyer_rating                 smallint check (buyer_rating between 1 and 5),
  add column if not exists release_extended             boolean not null default false,  -- buyer tapped "Not yet" (allowed once)
  add column if not exists seller_offered_replacement_at timestamptz;

grant select (buyer_rating, buyer_whatsapp_optin) on public.orders to authenticated;

-- 3. Message log ----------------------------------------------------------------
-- One row per message per order, so the same message is never sent twice,
-- and failed sends can be retried by the daily job. Server-only (no policies).
create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders (id) on delete cascade,
  role          text not null check (role in ('buyer', 'seller')),
  template      text not null,
  phone         text not null,
  payload       jsonb not null,      -- the exact WhatsApp API request body, for retries
  status        text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  attempts      integer not null default 0,
  wa_message_id text,
  last_error    text,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  unique (order_id, template, role)
);
create index if not exists notifications_retry_idx on public.notifications (status) where status <> 'sent';
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
