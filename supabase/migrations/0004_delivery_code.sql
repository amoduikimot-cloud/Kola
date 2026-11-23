-- Kola delivery code (run after 0003_payouts.sql)
-- Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- The buyer gets a 4-digit code and gives it to the rider/seller only when they
-- have the item. The seller enters it and the money is released immediately.

alter table public.orders
  add column if not exists delivery_code          text,
  add column if not exists delivery_code_attempts integer not null default 0;

-- Sellers can never read the code: 0002 granted sellers SELECT on a fixed list of
-- order columns, and these new columns are deliberately not on it.

-- Checks the code and releases the order in one step.
-- After 5 wrong tries the code is locked, so it can't be guessed
-- (5 tries out of 10,000 possible codes). The buyer can still confirm on their order page.
create or replace function public.release_with_code(p_order_id uuid, p_seller_id uuid, p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare o record;
begin
  select status, delivery_code, delivery_code_attempts into o
    from orders where id = p_order_id and seller_id = p_seller_id
    for update;                                   -- one check at a time per order
  if not found then return 'not_found'; end if;
  if o.status not in ('held', 'shipped') then return 'not_open'; end if;
  if o.delivery_code is null then return 'no_code'; end if;
  if o.delivery_code_attempts >= 5 then return 'locked'; end if;

  if o.delivery_code is distinct from p_code then
    update orders set delivery_code_attempts = delivery_code_attempts + 1 where id = p_order_id;
    return case when o.delivery_code_attempts + 1 >= 5 then 'locked' else 'wrong' end;
  end if;

  update orders set delivered_at = now() where id = p_order_id;
  if release_order(p_order_id) then return 'released'; end if;
  return 'not_open';
end $$;

revoke execute on function public.release_with_code(uuid, uuid, text) from public, anon, authenticated;
grant  execute on function public.release_with_code(uuid, uuid, text) to service_role;
