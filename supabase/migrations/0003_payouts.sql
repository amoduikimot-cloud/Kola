-- Kola seller payouts (run after 0002_escrow.sql)
-- Supabase dashboard: SQL Editor -> New query -> paste -> Run.

-- 1. Where each seller gets paid ----------------------------------------------
-- Written only by server code after Paystack confirms the account name.
-- We keep only the last 4 digits; Paystack's recipient_code is what transfers use.
create table if not exists public.payout_accounts (
  seller_id      uuid primary key references public.profiles (id) on delete cascade,
  bank_code      text not null,
  bank_name      text not null,
  account_last4  text not null,
  account_name   text not null,
  recipient_code text not null,
  updated_at     timestamptz not null default now()
);
alter table public.payout_accounts enable row level security;
drop policy if exists "seller reads own payout account" on public.payout_accounts;
create policy "seller reads own payout account" on public.payout_accounts for select using (auth.uid() = seller_id);
revoke insert, update, delete on public.payout_accounts from anon, authenticated;

-- 2. One payout per released order --------------------------------------------
do $$ begin
  create type public.payout_status as enum ('pending', 'processing', 'paid', 'failed');
exception when duplicate_object then null; end $$;

create table if not exists public.payouts (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null unique references public.orders (id),  -- unique: an order can never be paid out twice
  seller_id     uuid not null references public.profiles (id),
  amount_kobo   bigint not null check (amount_kobo > 0),
  status        public.payout_status not null default 'pending',
  attempt       integer not null default 1,
  reference     text not null unique,   -- Paystack transfer reference for the current attempt
  transfer_code text,
  last_error    text,
  paid_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists payouts_seller_idx on public.payouts (seller_id);
create index if not exists payouts_status_idx on public.payouts (status) where status in ('pending', 'processing');

alter table public.payouts enable row level security;
drop policy if exists "seller reads own payouts" on public.payouts;
create policy "seller reads own payouts" on public.payouts for select using (auth.uid() = seller_id);
revoke insert, update, delete on public.payouts from anon, authenticated;

-- 3. Releasing an order now also queues its payout -----------------------------
-- The seller receives the item price + delivery. Kola keeps the buyer-protection fee.
create or replace function public.release_order(p_order_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_seller uuid; v_amount bigint;
begin
  update orders set status = 'released', released_at = now()
   where id = p_order_id and status in ('held', 'shipped')
   returning seller_id, subtotal_kobo + delivery_kobo into v_seller, v_amount;
  if v_seller is null then return false; end if;
  update profiles set completed_orders = completed_orders + 1 where id = v_seller;
  insert into payouts (order_id, seller_id, amount_kobo, reference)
  values (p_order_id, v_seller, v_amount, 'kola-po-' || p_order_id || '-1')
  on conflict (order_id) do nothing;
  return true;
end $$;
revoke execute on function public.release_order(uuid) from public, anon, authenticated;
grant  execute on function public.release_order(uuid) to service_role;

-- Queue payouts for any orders released before this migration.
insert into public.payouts (order_id, seller_id, amount_kobo, reference)
select id, seller_id, subtotal_kobo + delivery_kobo, 'kola-po-' || id || '-1'
  from public.orders where status = 'released'
on conflict (order_id) do nothing;
