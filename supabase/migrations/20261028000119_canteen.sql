-- Features-18 #10: canteen (module key `canteen`, default enabled).
--
-- Tables
--   canteen_items         menu; price in integer paise. No delete (set
--                         is_active = false). institution_id immutable via
--                         column-level UPDATE grant.
--   canteen_transactions  append-only ledger per student. amount_paise is
--                         SIGNED: topup > 0, purchase < 0 (= -(quantity *
--                         unit_price_paise)). Balance = sum(amount_paise),
--                         never stored. No INSERT/UPDATE/DELETE for API
--                         roles; app.block_mutation stops update/delete for
--                         everyone except app.demo_reset (app.allow_reset).
--
-- Functions (public, PostgREST-callable)
--   canteen_topup(p_institution_id uuid, p_student_id uuid, p_amount_paise integer, p_note text default null) -> jsonb
--     definer; canteen.manage roles; ₹1..₹10,000 per top-up (simulated:
--     no payment is taken, UI shows <SimulatedBadge />).
--   canteen_purchase(p_institution_id uuid, p_student_id uuid, p_item_id uuid, p_quantity integer) -> jsonb
--     definer; canteen.manage roles; price read from canteen_items (never
--     from the caller); per-student advisory lock, refuses overdraft.
--   canteen_balance(p_institution_id uuid, p_student_id uuid) -> bigint
--     invoker, read-only; RLS decides which rows count (0 when none visible).
--   Both definers return {transaction_id, balance_paise}.
--
-- RLS matrix (M = owner, principal, admin, accountant)
--   canteen_items         select: M | student | guardian (menu + names for
--                         portal history); insert/update: M; delete: none.
--   canteen_transactions  select: M (institution) | guardian (linked
--                         children) | student (self) via app.my_student_ids;
--                         insert/update/delete: none (definers only).
--   Teachers and other staff roles: no item or transaction access.
--   Both tables: revoke all from anon/authenticated, then re-grant only the
--   privileges above (no TRUNCATE/REFERENCES/TRIGGER).
--
-- student_id is a plain FK (students has no (id, institution_id) key);
-- both definers bind it to p_institution_id before writing. item_id carries
-- a composite same-institution FK.
-- Helpers reused, never redefined: app.set_updated_at, app.block_mutation
-- (0001), app.has_role (0001),
-- app.current_user_id (0001), app.audit (0003), app.my_institution_ids /
-- app.my_student_ids (0020), app.module_catalog (0084).

insert into app.module_catalog (key, default_enabled) values ('canteen', true)
on conflict (key) do update set default_enabled = excluded.default_enabled;

-- ---------------------------------------------------------------------------
-- canteen_items
-- ---------------------------------------------------------------------------

create table public.canteen_items (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  name text not null check (char_length(name) between 1 and 80),
  price_paise integer not null check (price_paise between 1 and 100000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canteen_items_id_institution_key unique (id, institution_id),
  constraint canteen_items_name_key unique (institution_id, name)
);

create trigger set_updated_at
before update on public.canteen_items
for each row execute function app.set_updated_at();

alter table public.canteen_items enable row level security;

create policy canteen_items_select on public.canteen_items
  for select to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'accountant', 'student', 'guardian']))));

create policy canteen_items_insert on public.canteen_items
  for insert to authenticated
  with check (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'accountant']))));

create policy canteen_items_update on public.canteen_items
  for update to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'accountant']))))
  with check (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'accountant']))));

-- No DELETE (history references items). institution_id is never updatable.
revoke all on public.canteen_items from anon, authenticated;
grant select, insert on public.canteen_items to authenticated;
grant update (name, price_paise, is_active) on public.canteen_items to authenticated;

-- ---------------------------------------------------------------------------
-- canteen_transactions — append-only
-- ---------------------------------------------------------------------------

create table public.canteen_transactions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  student_id uuid not null references public.students (id),
  kind text not null check (kind in ('topup', 'purchase')),
  amount_paise integer not null,
  item_id uuid,
  quantity integer,
  unit_price_paise integer,
  note text check (char_length(note) between 1 and 120),
  recorded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canteen_transactions_item_fkey
    foreign key (item_id, institution_id) references public.canteen_items (id, institution_id),
  constraint canteen_transactions_kind_shape check (
    (kind = 'topup'
      and amount_paise between 100 and 1000000
      and item_id is null and quantity is null and unit_price_paise is null)
    or
    (kind = 'purchase'
      and item_id is not null
      and quantity between 1 and 20
      and unit_price_paise between 1 and 100000
      and amount_paise = -(quantity * unit_price_paise))
  )
);

create index canteen_transactions_student_created_idx on public.canteen_transactions (institution_id, student_id, created_at desc);
create index canteen_transactions_item_idx on public.canteen_transactions (item_id) where item_id is not null;
create index canteen_transactions_student_only_created_idx on public.canteen_transactions (student_id, created_at desc);

create trigger set_updated_at
before update on public.canteen_transactions
for each row execute function app.set_updated_at();

create trigger block_mutation
before update or delete on public.canteen_transactions
for each row execute function app.block_mutation();

alter table public.canteen_transactions enable row level security;

revoke all on public.canteen_transactions from anon, authenticated;
grant select on public.canteen_transactions to authenticated;

create policy canteen_transactions_select on public.canteen_transactions
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'accountant'])))
    or student_id = any((select app.my_student_ids()))
  );

-- ---------------------------------------------------------------------------
-- public.canteen_balance — invoker, read-only.
-- ---------------------------------------------------------------------------

create function public.canteen_balance(p_institution_id uuid, p_student_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(t.amount_paise), 0)::bigint
  from public.canteen_transactions t
  where t.institution_id = p_institution_id
    and t.student_id = p_student_id;
$$;

revoke execute on function public.canteen_balance(uuid, uuid) from public, anon;
grant execute on function public.canteen_balance(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.canteen_topup — definer.
-- ---------------------------------------------------------------------------

create function public.canteen_topup(p_institution_id uuid, p_student_id uuid, p_amount_paise integer, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_status text;
  v_tx_id uuid;
  v_balance bigint;
begin
  if not app.has_role(p_institution_id, array['owner', 'principal', 'admin', 'accountant']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold canteen.manage for this institution';
  end if;

  if p_amount_paise is null or p_amount_paise not between 100 and 1000000 then
    raise exception 'code:validation_failed' using detail = 'top-up must be between 100 and 1000000 paise';
  end if;

  select s.status into v_student_status
  from public.students s
  where s.id = p_student_id and s.institution_id = p_institution_id;

  if v_student_status is null then
    raise exception 'code:not_found' using detail = 'student not found';
  end if;
  if v_student_status <> 'active' then
    raise exception 'code:invalid_state' using detail = 'student is not active';
  end if;

  insert into public.canteen_transactions (institution_id, student_id, kind, amount_paise, note, recorded_by)
  values (p_institution_id, p_student_id, 'topup', p_amount_paise, nullif(btrim(p_note), ''), app.current_user_id())
  returning id into v_tx_id;

  select coalesce(sum(t.amount_paise), 0) into v_balance
  from public.canteen_transactions t
  where t.institution_id = p_institution_id and t.student_id = p_student_id;

  perform app.audit(
    p_institution_id,
    app.current_user_id(),
    'canteen.topup',
    'canteen_transactions',
    v_tx_id,
    null,
    jsonb_build_object('transaction_id', v_tx_id, 'student_id', p_student_id, 'amount_paise', p_amount_paise),
    null
  );

  return jsonb_build_object('transaction_id', v_tx_id, 'balance_paise', v_balance);
end;
$$;

revoke execute on function public.canteen_topup(uuid, uuid, integer, text) from public, anon;
grant execute on function public.canteen_topup(uuid, uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- public.canteen_purchase — definer. A transaction-scoped advisory lock per
-- student serialises concurrent purchases (a row lock cannot stop a second
-- purchase inserting a new row), so the balance read and the insert are
-- atomic per student — no overdraft under concurrency.
-- ---------------------------------------------------------------------------

create function public.canteen_purchase(p_institution_id uuid, p_student_id uuid, p_item_id uuid, p_quantity integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_status text;
  v_price integer;
  v_item_active boolean;
  v_total integer;
  v_balance bigint;
  v_tx_id uuid;
begin
  if not app.has_role(p_institution_id, array['owner', 'principal', 'admin', 'accountant']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold canteen.manage for this institution';
  end if;

  if p_quantity is null or p_quantity not between 1 and 20 then
    raise exception 'code:validation_failed' using detail = 'quantity must be between 1 and 20';
  end if;

  select s.status into v_student_status
  from public.students s
  where s.id = p_student_id and s.institution_id = p_institution_id;

  if v_student_status is null then
    raise exception 'code:not_found' using detail = 'student not found';
  end if;
  if v_student_status <> 'active' then
    raise exception 'code:invalid_state' using detail = 'student is not active';
  end if;

  select i.price_paise, i.is_active into v_price, v_item_active
  from public.canteen_items i
  where i.id = p_item_id and i.institution_id = p_institution_id;

  if v_price is null then
    raise exception 'code:not_found' using detail = 'item not found';
  end if;
  if not v_item_active then
    raise exception 'code:invalid_state' using detail = 'item is not on sale';
  end if;

  v_total := v_price * p_quantity;

  perform pg_advisory_xact_lock(hashtextextended('canteen_student:' || p_student_id::text, 0));

  select coalesce(sum(t.amount_paise), 0) into v_balance
  from public.canteen_transactions t
  where t.institution_id = p_institution_id and t.student_id = p_student_id;

  if v_balance < v_total then
    raise exception 'code:invalid_state' using detail = 'insufficient canteen balance';
  end if;

  insert into public.canteen_transactions (institution_id, student_id, kind, amount_paise, item_id, quantity, unit_price_paise, recorded_by)
  values (p_institution_id, p_student_id, 'purchase', -v_total, p_item_id, p_quantity, v_price, app.current_user_id())
  returning id into v_tx_id;

  perform app.audit(
    p_institution_id,
    app.current_user_id(),
    'canteen.purchase',
    'canteen_transactions',
    v_tx_id,
    null,
    jsonb_build_object('transaction_id', v_tx_id, 'student_id', p_student_id, 'item_id', p_item_id, 'quantity', p_quantity, 'amount_paise', -v_total),
    null
  );

  return jsonb_build_object('transaction_id', v_tx_id, 'balance_paise', v_balance - v_total);
end;
$$;

revoke execute on function public.canteen_purchase(uuid, uuid, uuid, integer) from public, anon;
grant execute on function public.canteen_purchase(uuid, uuid, uuid, integer) to authenticated;
