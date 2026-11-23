-- Kola escrow (run after 0001_init.sql)
-- Supabase dashboard: SQL Editor -> New query -> paste -> Run.

-- 1. Seller delivery fee ------------------------------------------------------
alter table public.profiles
  add column if not exists delivery_fee_kobo bigint not null default 0 check (delivery_fee_kobo >= 0);
grant update (delivery_fee_kobo) on public.profiles to authenticated;

-- 2. Extra order fields --------------------------------------------------------
alter table public.orders
  add column if not exists buyer_address    text,
  add column if not exists buyer_token_hash text,          -- sha256 of the secret in the buyer's order link
  add column if not exists paid_at          timestamptz,
  add column if not exists auto_release_at  timestamptz,   -- set when the seller ships
  add column if not exists dispute_reason   text,
  add column if not exists dispute_details  text,
  add column if not exists disputed_at      timestamptz;

create index if not exists orders_auto_release_idx on public.orders (auto_release_at) where status = 'shipped';

-- The seller can read their own orders (policy from 0001), but never the buyer's secret.
-- (A column-level revoke doesn't override a table-level grant, so re-grant column by column.)
revoke select on public.orders from anon, authenticated;
grant select (id, seller_id, buyer_name, buyer_email, buyer_phone, buyer_address, items,
              subtotal_kobo, delivery_kobo, fee_kobo, total_kobo, status, payment_ref,
              tracking_number, shipped_at, delivered_at, released_at, paid_at, auto_release_at,
              dispute_reason, dispute_details, disputed_at, created_at)
  on public.orders to authenticated;

-- 3. Money-moving functions ---------------------------------------------------
-- These run only from trusted server code (service role). Each one changes an
-- order only if it is in the expected status, so double clicks or a webhook
-- arriving twice can never release money twice.

create or replace function public.release_order(p_order_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_seller uuid;
begin
  update orders set status = 'released', released_at = now()
   where id = p_order_id and status in ('held', 'shipped')
   returning seller_id into v_seller;
  if v_seller is null then return false; end if;
  update profiles set completed_orders = completed_orders + 1 where id = v_seller;
  return true;
end $$;

create or replace function public.open_dispute(p_order_id uuid, p_reason text, p_details text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_seller uuid;
begin
  update orders set status = 'disputed', disputed_at = now(),
         dispute_reason = p_reason, dispute_details = p_details, auto_release_at = null
   where id = p_order_id and status in ('held', 'shipped')
   returning seller_id into v_seller;
  if v_seller is null then return false; end if;
  update profiles set disputes_total = disputes_total + 1 where id = v_seller;
  return true;
end $$;

create or replace function public.auto_release_due_orders()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select id from orders where status = 'shipped' and auto_release_at <= now() loop
    if release_order(r.id) then n := n + 1; end if;
  end loop;
  return n;
end $$;

revoke execute on function public.release_order(uuid)                from public, anon, authenticated;
revoke execute on function public.open_dispute(uuid, text, text)     from public, anon, authenticated;
revoke execute on function public.auto_release_due_orders()          from public, anon, authenticated;
grant  execute on function public.release_order(uuid)                to service_role;
grant  execute on function public.open_dispute(uuid, text, text)     to service_role;
grant  execute on function public.auto_release_due_orders()          to service_role;
