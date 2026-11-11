-- Features-18 #8 (SPEC §A): expenses module — a separate spend register.
-- NOT posted to ledger_entries (honesty: <LimitedBadge />). Void follows
-- 0074's reversal pattern (rule 5: a correction is a new row, never an
-- edit): public.void_expense inserts a reversing row into `expenses` with
-- amount_paise = -original and reverses_expense_id = original, at most one
-- per original (unique). Net spend = sum(amount_paise).
--
-- Tables
--   expense_categories  name unique per institution, is_active
--   expenses            append-only (app.block_mutation on update/delete,
--                       demo-reset bypass via app.allow_reset); amount_paise
--                       bigint; reversing rows carry reverses_expense_id
--   budgets             (category, period_start..period_end, amount_paise)
--
-- Functions
--   public.void_expense(p_expense_id uuid, p_reason text) -> jsonb
--     definer; expense.manage roles; refuses voiding a reversing row or an
--     already-voided expense; reason 5-200 chars (stored as the reversing
--     row's description, never audited).
--
-- RLS matrix (expense.read = expense.manage = app.finance_roles():
-- owner, principal, admin, accountant):
--   table               select  insert                         update             delete
--   expense_categories  F       F                              F (name,is_active) none
--   expenses            F       F (positive, non-reversing,    none (immutable)   none
--                                  recorded_by = caller)
--   budgets             F       F                              F (amount_paise)   none
--   Reversing rows: public.void_expense only. Other roles: no access.

insert into app.module_catalog (key, default_enabled) values ('expenses', true)
on conflict (key) do update set default_enabled = excluded.default_enabled;

-- ---------------------------------------------------------------------------
-- expense_categories
-- ---------------------------------------------------------------------------

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  name text not null check (char_length(name) between 1 and 60),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expense_categories_id_institution_key unique (id, institution_id),
  constraint expense_categories_name_key unique (institution_id, name)
);

create trigger set_updated_at
before update on public.expense_categories
for each row execute function app.set_updated_at();

alter table public.expense_categories enable row level security;

create policy expense_categories_select on public.expense_categories
  for select to authenticated
  using (expense_categories.institution_id = any((select app.my_institution_ids(app.finance_roles()))));

create policy expense_categories_insert on public.expense_categories
  for insert to authenticated
  with check (expense_categories.institution_id = any((select app.my_institution_ids(app.finance_roles()))));

create policy expense_categories_update on public.expense_categories
  for update to authenticated
  using (expense_categories.institution_id = any((select app.my_institution_ids(app.finance_roles()))))
  with check (expense_categories.institution_id = any((select app.my_institution_ids(app.finance_roles()))));

revoke all on public.expense_categories from anon, authenticated;
grant select, insert on public.expense_categories to authenticated;
grant update (name, is_active) on public.expense_categories to authenticated;
grant select, insert, update, delete on public.expense_categories to service_role;

-- ---------------------------------------------------------------------------
-- expenses — append-only. category_id bound to the same institution by the
-- composite FK. reverses_expense_id is a plain self-FK (set only by the
-- definer from the original row); no CHECK depends on it being non-null,
-- because app.demo_reset nulls self-FK columns before deleting.
-- ---------------------------------------------------------------------------

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  category_id uuid not null,
  amount_paise bigint not null check (amount_paise <> 0),
  spent_on date not null,
  description text not null check (char_length(description) between 1 and 200),
  payee text check (char_length(payee) between 1 and 120),
  reverses_expense_id uuid references public.expenses (id),
  recorded_by uuid not null references public.profiles (id) default app.current_user_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expenses_category_fk foreign key (category_id, institution_id) references public.expense_categories (id, institution_id),
  constraint expenses_reverses_key unique (reverses_expense_id),
  constraint expenses_reversal_negative check (reverses_expense_id is null or amount_paise < 0)
);

create index expenses_institution_spent_idx on public.expenses (institution_id, spent_on desc);
create index expenses_category_spent_idx on public.expenses (category_id, spent_on);

create trigger set_updated_at
before update on public.expenses
for each row execute function app.set_updated_at();

create trigger block_mutation
before update or delete on public.expenses
for each row execute function app.block_mutation();

alter table public.expenses enable row level security;

create policy expenses_select on public.expenses
  for select to authenticated
  using (expenses.institution_id = any((select app.my_institution_ids(app.finance_roles()))));

create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (
    expenses.institution_id = any((select app.my_institution_ids(app.finance_roles())))
    and expenses.recorded_by = (select app.current_user_id())
    and expenses.amount_paise > 0
    and expenses.reverses_expense_id is null
  );

revoke all on public.expenses from anon, authenticated;
grant select, insert on public.expenses to authenticated;
grant select, insert, update, delete on public.expenses to service_role;

-- ---------------------------------------------------------------------------
-- budgets — one per (category, period). Spend vs budget = sum(expenses.
-- amount_paise) for that category with spent_on in the period.
-- ---------------------------------------------------------------------------

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  category_id uuid not null,
  period_start date not null,
  period_end date not null,
  amount_paise bigint not null check (amount_paise > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budgets_category_fk foreign key (category_id, institution_id) references public.expense_categories (id, institution_id),
  constraint budgets_period_check check (period_end >= period_start),
  constraint budgets_category_period_key unique (category_id, period_start, period_end)
);

create index budgets_institution_period_idx on public.budgets (institution_id, period_start);

create trigger set_updated_at
before update on public.budgets
for each row execute function app.set_updated_at();

alter table public.budgets enable row level security;

create policy budgets_select on public.budgets
  for select to authenticated
  using (budgets.institution_id = any((select app.my_institution_ids(app.finance_roles()))));

create policy budgets_insert on public.budgets
  for insert to authenticated
  with check (budgets.institution_id = any((select app.my_institution_ids(app.finance_roles()))));

create policy budgets_update on public.budgets
  for update to authenticated
  using (budgets.institution_id = any((select app.my_institution_ids(app.finance_roles()))))
  with check (budgets.institution_id = any((select app.my_institution_ids(app.finance_roles()))));

revoke all on public.budgets from anon, authenticated;
grant select, insert on public.budgets to authenticated;
grant update (amount_paise) on public.budgets to authenticated;
grant select, insert, update, delete on public.budgets to service_role;

-- ---------------------------------------------------------------------------
-- public.void_expense — single public definer (0074 enqueue_fee_reminders
-- shape). Caller check: non-member -> not_found, member without an
-- expense.manage role -> forbidden (0074 void_payment ordering).
-- ---------------------------------------------------------------------------

create function public.void_expense(p_expense_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expense public.expenses;
  v_void_id uuid;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  -- Lock the original so concurrent voids serialise (unique backstops too).
  select * into v_expense from public.expenses where id = p_expense_id for update;

  if v_expense.id is null or not app.is_member(v_expense.institution_id) then
    raise exception 'code:not_found' using detail = 'expense not found';
  end if;

  if not app.has_role(v_expense.institution_id, app.finance_roles()) then
    raise exception 'code:forbidden' using detail = 'caller does not hold expense.manage for this institution';
  end if;

  if v_expense.reverses_expense_id is not null or v_expense.amount_paise < 0 then
    raise exception 'code:invalid_state' using detail = 'a reversing entry cannot be voided';
  end if;

  if exists (select 1 from public.expenses e where e.reverses_expense_id = p_expense_id) then
    raise exception 'code:conflict' using detail = 'expense already voided';
  end if;

  if p_reason is null or char_length(trim(p_reason)) < 5 or char_length(trim(p_reason)) > 200 then
    raise exception 'code:validation_failed' using detail = 'reason must be 5-200 characters';
  end if;

  insert into public.expenses (institution_id, category_id, amount_paise, spent_on, description, payee, reverses_expense_id, recorded_by)
  values (
    v_expense.institution_id, v_expense.category_id, -v_expense.amount_paise, v_expense.spent_on,
    trim(p_reason), v_expense.payee, p_expense_id, app.current_user_id()
  )
  returning id into v_void_id;

  -- Never audit `reason` (free text, lesson 10).
  perform app.audit(
    v_expense.institution_id,
    app.current_user_id(),
    'expense.voided',
    'expense',
    p_expense_id,
    null,
    jsonb_build_object('void_id', v_void_id, 'amount_paise', v_expense.amount_paise),
    null
  );

  return jsonb_build_object('void_id', v_void_id, 'expense_id', p_expense_id);
end;
$$;

revoke execute on function public.void_expense(uuid, text) from public, anon;
grant execute on function public.void_expense(uuid, text) to authenticated;
