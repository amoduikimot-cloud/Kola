-- Kola dispute review (run after 0005_whatsapp.sql)
-- Supabase dashboard: SQL Editor -> New query -> paste -> Run.

-- 1. Kola staff -----------------------------------------------------------------
-- People listed here can open /admin/disputes and decide disputes.
-- Server-only: no policies, so nobody can read or change it from the browser.
-- To add someone, after they have signed in to Kola once:
--   insert into public.staff (user_id) select id from auth.users where email = 'you@example.com';
create table if not exists public.staff (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.staff enable row level security;
revoke all on public.staff from anon, authenticated;

-- 2. Dispute fields on orders -----------------------------------------------------
alter table public.orders
  add column if not exists seller_response     text check (char_length(seller_response) <= 1000),
  add column if not exists seller_responded_at timestamptz,
  add column if not exists dispute_outcome     text check (dispute_outcome in ('refund', 'release')),
  add column if not exists dispute_note        text check (char_length(dispute_note) <= 500),  -- the reason, shown to buyer and seller
  add column if not exists resolved_at         timestamptz,
  add column if not exists resolved_by         uuid references auth.users (id);

-- Sellers may read the outcome of their own disputes (not who decided it).
grant select (seller_response, seller_responded_at, dispute_outcome, dispute_note, resolved_at)
  on public.orders to authenticated;

-- 3. Refunds to buyers ------------------------------------------------------------
-- One refund per order (unique), sent through Paystack. Server-only.
-- Each attempt has its own Paystack reference; Paystack refuses a reference twice,
-- so a retried request can never refund twice.
--   queued          : decided, not yet sent to Paystack
--   sending         : sent, waiting for Paystack (pending / processing there)
--   needs_attention : Paystack needs the buyer's bank account to finish it
--   processed       : done (the buyer may still wait up to 10 business days)
--   failed          : Paystack couldn't refund; the money is back in Kola's balance
do $$ begin
  create type public.refund_status as enum ('queued', 'sending', 'needs_attention', 'processed', 'failed');
exception when duplicate_object then null; end $$;

create table if not exists public.refunds (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null unique references public.orders (id),
  amount_kobo        bigint not null check (amount_kobo > 0),
  status             public.refund_status not null default 'queued',
  attempt            integer not null default 1,
  reference          text not null unique,   -- Paystack refund reference for the current attempt
  paystack_refund_id text,
  last_error         text,
  processed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists refunds_open_idx on public.refunds (status) where status <> 'processed';
alter table public.refunds enable row level security;
revoke all on public.refunds from anon, authenticated;

-- 4. Deciding a dispute -----------------------------------------------------------
-- Changes the order only while it is still "disputed", so two staff clicking at
-- once can never both act. Either:
--   'release': the seller is paid (item price + delivery), like a normal completed order.
--   'refund' : the buyer gets back everything they paid; the seller's lost-dispute count goes up.
create or replace function public.resolve_dispute(p_order_id uuid, p_outcome text, p_note text, p_staff uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_seller uuid; v_payout bigint; v_total bigint;
begin
  if p_outcome not in ('refund', 'release') then return false; end if;

  update orders
     set status          = case when p_outcome = 'release' then 'released'::order_status else 'refunded'::order_status end,
         released_at     = case when p_outcome = 'release' then now() else released_at end,
         dispute_outcome = p_outcome,
         dispute_note    = p_note,
         resolved_at     = now(),
         resolved_by     = p_staff
   where id = p_order_id and status = 'disputed'
   returning seller_id, subtotal_kobo + delivery_kobo, total_kobo into v_seller, v_payout, v_total;
  if v_seller is null then return false; end if;

  if p_outcome = 'release' then
    update profiles set completed_orders = completed_orders + 1 where id = v_seller;
    insert into payouts (order_id, seller_id, amount_kobo, reference)
    values (p_order_id, v_seller, v_payout, 'kola-po-' || p_order_id || '-1')
    on conflict (order_id) do nothing;
  else
    update profiles set disputes_lost = disputes_lost + 1 where id = v_seller;
    insert into refunds (order_id, amount_kobo, reference) values (p_order_id, v_total, 'kola-rf-' || p_order_id || '-1')
    on conflict (order_id) do nothing;
  end if;
  return true;
end $$;

revoke execute on function public.resolve_dispute(uuid, text, text, uuid) from public, anon, authenticated;
grant  execute on function public.resolve_dispute(uuid, text, text, uuid) to service_role;
