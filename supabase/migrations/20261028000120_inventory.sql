-- Features-18 #11: inventory (module key `inventory`, default enabled).
--
-- Tables
--   inventory_items      stock items (unit, reorder_level). No delete (set
--                        is_active = false). institution_id immutable via
--                        column-level UPDATE grant.
--   inventory_movements  append-only. quantity is a SIGNED delta:
--                        in > 0, issue < 0, return > 0, adjust <> 0.
--                        Stock = sum(quantity), never stored. No
--                        INSERT/UPDATE/DELETE for API roles;
--                        app.block_mutation stops update/delete for everyone
--                        except app.demo_reset (app.allow_reset).
--
-- Functions (public, PostgREST-callable)
--   inventory_stock(p_institution_id uuid) -> table(item_id, name, unit,
--     reorder_level, is_active, on_hand bigint, is_low_stock boolean)
--     invoker, read-only; base-table RLS applies; is_low_stock =
--     on_hand <= reorder_level.
--   record_inventory_movement(p_institution_id uuid, p_item_id uuid, p_kind text, p_quantity integer, p_note text default null) -> jsonb
--     definer; inventory.manage roles. p_quantity is a positive magnitude
--     for in/issue/return (issue is stored negative) and a signed non-zero
--     delta for adjust. Locks the item row (FOR UPDATE), refuses any
--     movement that would take stock below zero. in/issue refused on an
--     inactive item; return/adjust still allowed (write-off). Returns
--     {movement_id, on_hand}.
--
-- RLS matrix (M = owner, principal, admin, accountant)
--   inventory_items      select: M; insert/update: M; delete: none.
--   inventory_movements  select: M; insert/update/delete: none (definer only).
--   Teachers, guardians, students, other staff: no access.
--   Both tables: revoke all from anon/authenticated, then re-grant only the
--   privileges above (no TRUNCATE/REFERENCES/TRIGGER).
--
-- Helpers reused, never redefined: app.set_updated_at, app.block_mutation,
-- app.has_role, app.current_user_id (0001), app.audit (0003),
-- app.my_institution_ids (0020), app.module_catalog (0084).

insert into app.module_catalog (key, default_enabled) values ('inventory', true)
on conflict (key) do update set default_enabled = excluded.default_enabled;

-- ---------------------------------------------------------------------------
-- inventory_items
-- ---------------------------------------------------------------------------

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  name text not null check (char_length(name) between 1 and 120),
  unit text not null check (char_length(unit) between 1 and 20),
  reorder_level integer not null default 0 check (reorder_level between 0 and 1000000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_items_id_institution_key unique (id, institution_id),
  constraint inventory_items_name_key unique (institution_id, name)
);

create trigger set_updated_at
before update on public.inventory_items
for each row execute function app.set_updated_at();

alter table public.inventory_items enable row level security;

create policy inventory_items_select on public.inventory_items
  for select to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'accountant']))));

create policy inventory_items_insert on public.inventory_items
  for insert to authenticated
  with check (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'accountant']))));

create policy inventory_items_update on public.inventory_items
  for update to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'accountant']))))
  with check (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'accountant']))));

revoke all on public.inventory_items from anon, authenticated;
grant select, insert on public.inventory_items to authenticated;
grant update (name, unit, reorder_level, is_active) on public.inventory_items to authenticated;

-- ---------------------------------------------------------------------------
-- inventory_movements — append-only
-- ---------------------------------------------------------------------------

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  item_id uuid not null,
  kind text not null check (kind in ('in', 'issue', 'return', 'adjust')),
  quantity integer not null check (quantity between -1000000 and 1000000),
  note text check (char_length(note) between 1 and 200),
  recorded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_movements_item_fkey
    foreign key (item_id, institution_id) references public.inventory_items (id, institution_id),
  constraint inventory_movements_sign check (
    (kind in ('in', 'return') and quantity > 0)
    or (kind = 'issue' and quantity < 0)
    or (kind = 'adjust' and quantity <> 0)
  )
);

create index inventory_movements_item_created_idx on public.inventory_movements (item_id, created_at desc);
create index inventory_movements_institution_created_idx on public.inventory_movements (institution_id, created_at desc);

create trigger set_updated_at
before update on public.inventory_movements
for each row execute function app.set_updated_at();

create trigger block_mutation
before update or delete on public.inventory_movements
for each row execute function app.block_mutation();

alter table public.inventory_movements enable row level security;

revoke all on public.inventory_movements from anon, authenticated;
grant select on public.inventory_movements to authenticated;

create policy inventory_movements_select on public.inventory_movements
  for select to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'accountant']))));

-- ---------------------------------------------------------------------------
-- public.inventory_stock — current stock + low-stock flag. Invoker function,
-- not a view: app.demo_reset (0001) deletes from every public relation with
-- an institution_id column (information_schema.columns includes views), and
-- an aggregate view cannot be deleted from.
-- ---------------------------------------------------------------------------

create function public.inventory_stock(p_institution_id uuid)
returns table (
  item_id uuid,
  name text,
  unit text,
  reorder_level integer,
  is_active boolean,
  on_hand bigint,
  is_low_stock boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    i.id,
    i.name,
    i.unit,
    i.reorder_level,
    i.is_active,
    coalesce(sum(m.quantity), 0)::bigint,
    coalesce(sum(m.quantity), 0) <= i.reorder_level
  from public.inventory_items i
  left join public.inventory_movements m
    on m.item_id = i.id
   and m.institution_id = i.institution_id
  where i.institution_id = p_institution_id
  group by i.id
  order by i.name;
$$;

revoke execute on function public.inventory_stock(uuid) from public, anon;
grant execute on function public.inventory_stock(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.record_inventory_movement — definer. The item row lock serialises
-- concurrent movements on one item, so the stock read and the insert are
-- atomic — stock never goes below zero.
-- ---------------------------------------------------------------------------

create function public.record_inventory_movement(
  p_institution_id uuid,
  p_item_id uuid,
  p_kind text,
  p_quantity integer,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.inventory_items;
  v_delta integer;
  v_on_hand bigint;
  v_movement_id uuid;
begin
  if not app.has_role(p_institution_id, array['owner', 'principal', 'admin', 'accountant']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold inventory.manage for this institution';
  end if;

  if p_kind is null or p_kind not in ('in', 'issue', 'return', 'adjust') then
    raise exception 'code:validation_failed' using detail = 'kind must be in, issue, return or adjust';
  end if;

  if p_quantity is null or p_quantity not between -1000000 and 1000000
    or (p_kind = 'adjust' and p_quantity = 0)
    or (p_kind <> 'adjust' and p_quantity <= 0)
  then
    raise exception 'code:validation_failed' using detail = 'quantity must be positive (signed and non-zero for adjust)';
  end if;

  select * into v_item
  from public.inventory_items i
  where i.id = p_item_id and i.institution_id = p_institution_id
  for update;

  if v_item.id is null then
    raise exception 'code:not_found' using detail = 'item not found';
  end if;

  if not v_item.is_active and p_kind in ('in', 'issue') then
    raise exception 'code:invalid_state' using detail = 'item is inactive';
  end if;

  v_delta := case when p_kind = 'issue' then -p_quantity else p_quantity end;

  select coalesce(sum(m.quantity), 0) into v_on_hand
  from public.inventory_movements m
  where m.item_id = p_item_id and m.institution_id = p_institution_id;

  if v_on_hand + v_delta < 0 then
    raise exception 'code:invalid_state' using detail = 'insufficient stock';
  end if;

  insert into public.inventory_movements (institution_id, item_id, kind, quantity, note, recorded_by)
  values (p_institution_id, p_item_id, p_kind, v_delta, nullif(btrim(p_note), ''), app.current_user_id())
  returning id into v_movement_id;

  perform app.audit(
    p_institution_id,
    app.current_user_id(),
    'inventory.movement.recorded',
    'inventory_movements',
    v_movement_id,
    null,
    jsonb_build_object('movement_id', v_movement_id, 'item_id', p_item_id, 'kind', p_kind, 'quantity', v_delta),
    null
  );

  return jsonb_build_object('movement_id', v_movement_id, 'on_hand', v_on_hand + v_delta);
end;
$$;

revoke execute on function public.record_inventory_movement(uuid, uuid, text, integer, text) from public, anon;
grant execute on function public.record_inventory_movement(uuid, uuid, text, integer, text) to authenticated;
