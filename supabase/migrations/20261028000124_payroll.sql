-- Features-18 #3: payroll module (SPEC §A row 3). Limited by design
-- (<LimitedBadge />): no bank payout, no statutory deductions — a salary
-- register and payslips only. Money is integer paise (bigint).
--
-- Tables
--   salary_structures — per staff: components jsonb [{name, kind earning|deduction,
--                       amount_paise}], gross_paise (server-computed = sum of
--                       earnings), is_active (one active per staff)
--   payroll_runs      — one per (institution, month); month = first of month;
--                       status draft -> finalized
--   payslips          — one per (run, staff); snapshot of components +
--                       gross_paise/net_paise; immutable and undeletable once
--                       the run is finalized
--
-- Functions
--   app.guard_salary_structures_write()  trigger: components shape, gross_paise
--   app.guard_payroll_runs_write()       trigger: finalized run immutable, never deleted
--   app.guard_payslips_write()           trigger: payslips of a finalized run immutable, never deleted
--   public.generate_payroll_run(p_institution_id uuid, p_month date) -> app.generate_payroll_run:
--     owner/accountant; creates the month's draft run (or reuses the draft)
--     and rebuilds its payslips from active structures of active staff;
--     returns the run id
--   public.finalize_payroll_run(p_run_id uuid) -> app.finalize_payroll_run:
--     owner/accountant; draft with >= 1 payslip -> finalized; returns the run id
--
-- RLS matrix (payroll.manage = owner/accountant; payslip.read = every staff
-- role, own rows):
--   table             | owner/accountant | other staff (principal, admin, admissions, exam_controller, teacher)
--   salary_structures | S I U            | none
--   payroll_runs      | S                | S finalized runs of own institution (month/status only)
--   payslips          | S                | S own (staff_id in app.my_staff_ids()) of finalized runs
--   guardian/student  | none             |
-- Finalized payroll_runs rows are readable by all staff roles as payslip-join
-- metadata; only month and status matter there (no amounts live on the run).
-- payroll_runs/payslips have no write policy: only the two definers (and
-- service-role seed) write them. salary_structures has no DELETE (deactivate).

insert into app.module_catalog (key, default_enabled) values ('payroll', true)
on conflict (key) do update set default_enabled = excluded.default_enabled;

-- ---------------------------------------------------------------------------
-- salary_structures
-- ---------------------------------------------------------------------------

create table public.salary_structures (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  staff_id uuid not null references public.staff (id),
  components jsonb not null,
  gross_paise bigint not null default 0 check (gross_paise >= 0),
  is_active boolean not null default true,
  created_by uuid not null references public.profiles (id) default app.current_user_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index salary_structures_one_active_key on public.salary_structures (staff_id) where is_active;
create index salary_structures_institution_idx on public.salary_structures (institution_id);

create trigger set_updated_at
before update on public.salary_structures
for each row execute function app.set_updated_at();

-- components: array of 1-20 objects {name 1-60 chars, kind earning|deduction,
-- amount_paise integer 0..1e10}; >= 1 earning; deductions <= earnings.
-- gross_paise is always recomputed here, never trusted from the client.
create function app.guard_salary_structures_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_component jsonb;
  v_amount text;
  v_earnings bigint := 0;
  v_deductions bigint := 0;
begin
  if tg_op = 'UPDATE' and (
    new.institution_id is distinct from old.institution_id
    or new.staff_id is distinct from old.staff_id
    or new.created_by is distinct from old.created_by
  ) then
    raise exception 'code:invalid_state' using detail = 'institution_id, staff_id and created_by are immutable';
  end if;

  if jsonb_typeof(new.components) is distinct from 'array' then
    raise exception 'code:validation_failed' using detail = 'components must be an array';
  end if;
  if jsonb_array_length(new.components) < 1 or jsonb_array_length(new.components) > 20 then
    raise exception 'code:validation_failed' using detail = 'components must have between 1 and 20 entries';
  end if;

  for v_component in select elem from jsonb_array_elements(new.components) as elem loop
    if jsonb_typeof(v_component) is distinct from 'object' then
      raise exception 'code:validation_failed' using detail = 'each component must be an object';
    end if;
    if exists (
      select 1 from jsonb_object_keys(v_component) k
      where k not in ('name', 'kind', 'amount_paise')
    ) then
      raise exception 'code:validation_failed' using detail = 'a component may only have name, kind, amount_paise';
    end if;
    if jsonb_typeof(v_component -> 'name') is distinct from 'string' then
      raise exception 'code:validation_failed' using detail = 'component name must be a string';
    end if;
    if length(v_component ->> 'name') < 1 or length(v_component ->> 'name') > 60 then
      raise exception 'code:validation_failed' using detail = 'component name must be 1-60 characters';
    end if;
    if (v_component ->> 'kind') is null or (v_component ->> 'kind') not in ('earning', 'deduction') then
      raise exception 'code:validation_failed' using detail = 'component kind must be earning or deduction';
    end if;

    v_amount := v_component ->> 'amount_paise';
    if jsonb_typeof(v_component -> 'amount_paise') is distinct from 'number' or v_amount !~ '^[0-9]{1,11}$' then
      raise exception 'code:validation_failed' using detail = 'component amount_paise must be a whole number of paise';
    end if;
    if v_amount::bigint > 10000000000 then
      raise exception 'code:validation_failed' using detail = 'component amount_paise is too large';
    end if;

    if v_component ->> 'kind' = 'earning' then
      v_earnings := v_earnings + v_amount::bigint;
    else
      v_deductions := v_deductions + v_amount::bigint;
    end if;
  end loop;

  if v_earnings = 0 then
    raise exception 'code:validation_failed' using detail = 'a salary structure needs at least one earning';
  end if;
  if v_deductions > v_earnings then
    raise exception 'code:validation_failed' using detail = 'deductions cannot exceed earnings';
  end if;

  new.gross_paise := v_earnings;
  return new;
end;
$$;

revoke execute on function app.guard_salary_structures_write() from public;

create trigger guard_salary_structures_write
before insert or update on public.salary_structures
for each row execute function app.guard_salary_structures_write();

alter table public.salary_structures enable row level security;

create policy salary_structures_select on public.salary_structures
  for select to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'accountant']))));

create policy salary_structures_insert on public.salary_structures
  for insert to authenticated
  with check (
    institution_id = any((select app.my_institution_ids(array['owner', 'accountant'])))
    and created_by = (select app.current_user_id())
    and app.staff_in_institution(salary_structures.staff_id, salary_structures.institution_id)
  );

create policy salary_structures_update on public.salary_structures
  for update to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'accountant']))))
  with check (institution_id = any((select app.my_institution_ids(array['owner', 'accountant']))));

revoke all on public.salary_structures from anon, authenticated;
grant select, insert on public.salary_structures to authenticated;
grant update (components, is_active) on public.salary_structures to authenticated;

-- ---------------------------------------------------------------------------
-- payroll_runs
-- ---------------------------------------------------------------------------

create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  month date not null check (extract(day from month) = 1),
  status text not null default 'draft' check (status in ('draft', 'finalized')),
  finalized_at timestamptz,
  finalized_by uuid references public.profiles (id),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_runs_institution_month_key unique (institution_id, month),
  -- Composite-FK target for payslips.
  constraint payroll_runs_id_institution_key unique (id, institution_id),
  constraint payroll_runs_finalized_check check ((status = 'finalized') = (finalized_at is not null))
);

create trigger set_updated_at
before update on public.payroll_runs
for each row execute function app.set_updated_at();

-- A finalized run is never changed or deleted (lesson 6: payslip
-- immutability depends on this parent state). Demo reset bypasses via
-- app.allow_reset, same as app.block_mutation.
create function app.guard_payroll_runs_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.allow_reset', true) = 'on' then
    return coalesce(new, old);
  end if;

  if old.status = 'finalized' then
    raise exception 'code:invalid_state' using detail = 'a finalized payroll run is immutable';
  end if;

  if tg_op = 'UPDATE' and (
    new.institution_id is distinct from old.institution_id
    or new.month is distinct from old.month
    or new.created_by is distinct from old.created_by
  ) then
    raise exception 'code:invalid_state' using detail = 'institution_id, month and created_by are immutable';
  end if;

  return coalesce(new, old);
end;
$$;

revoke execute on function app.guard_payroll_runs_write() from public;

create trigger guard_payroll_runs_write
before update or delete on public.payroll_runs
for each row execute function app.guard_payroll_runs_write();

alter table public.payroll_runs enable row level security;

create policy payroll_runs_select on public.payroll_runs
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'accountant'])))
    or (
      status = 'finalized'
      and institution_id = any((select app.my_institution_ids(app.staff_roles())))
    )
  );

revoke all on public.payroll_runs from anon, authenticated;
grant select on public.payroll_runs to authenticated;

-- ---------------------------------------------------------------------------
-- payslips
-- ---------------------------------------------------------------------------

create table public.payslips (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  run_id uuid not null,
  staff_id uuid not null references public.staff (id),
  components jsonb not null,
  gross_paise bigint not null check (gross_paise >= 0),
  net_paise bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payslips_run_fk foreign key (run_id, institution_id)
    references public.payroll_runs (id, institution_id),
  constraint payslips_run_staff_key unique (run_id, staff_id),
  constraint payslips_net_check check (net_paise between 0 and gross_paise)
);

create index payslips_staff_idx on public.payslips (staff_id);
create index payslips_institution_run_idx on public.payslips (institution_id, run_id);

create trigger set_updated_at
before update on public.payslips
for each row execute function app.set_updated_at();

-- Insert only into a draft run (service-role/postgres seed may insert into
-- a finalized run, lesson 5). Update/delete only while the run is draft
-- (generate_payroll_run rebuilds drafts), and never re-parented.
create function app.guard_payslips_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_run_status text;
  v_is_trusted boolean;
begin
  if current_setting('app.allow_reset', true) = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    select r.status into v_run_status from public.payroll_runs r where r.id = new.run_id;
    v_is_trusted := (
      coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
      or session_user = 'postgres'
    );
    if v_run_status is distinct from 'draft' and not v_is_trusted then
      raise exception 'code:invalid_state' using detail = 'payslips can only be added to a draft payroll run';
    end if;
    return new;
  end if;

  select r.status into v_run_status from public.payroll_runs r where r.id = old.run_id;
  if v_run_status is distinct from 'draft' then
    raise exception 'code:invalid_state' using detail = 'payslips of a finalized payroll run are immutable';
  end if;

  if tg_op = 'UPDATE' and (
    new.institution_id is distinct from old.institution_id
    or new.run_id is distinct from old.run_id
    or new.staff_id is distinct from old.staff_id
  ) then
    raise exception 'code:invalid_state' using detail = 'a payslip cannot move to another run or staff member';
  end if;

  return coalesce(new, old);
end;
$$;

revoke execute on function app.guard_payslips_write() from public;

create trigger guard_payslips_write
before insert or update or delete on public.payslips
for each row execute function app.guard_payslips_write();

alter table public.payslips enable row level security;

create policy payslips_select on public.payslips
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'accountant'])))
    or (
      staff_id = any((select app.my_staff_ids()))
      and exists (
        select 1 from public.payroll_runs r
        where r.id = payslips.run_id
          and r.institution_id = payslips.institution_id
          and r.status = 'finalized'
      )
    )
  );

revoke all on public.payslips from anon, authenticated;
grant select on public.payslips to authenticated;

-- ---------------------------------------------------------------------------
-- app.generate_payroll_run / public.generate_payroll_run
-- ---------------------------------------------------------------------------

create function app.generate_payroll_run(p_institution_id uuid, p_month date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_month date;
  v_run public.payroll_runs;
  v_count int;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if not app.has_role(p_institution_id, array['owner', 'accountant']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold payroll.manage for this institution';
  end if;

  if p_month is null then
    raise exception 'code:validation_failed' using detail = 'month is required';
  end if;
  v_month := p_month - (extract(day from p_month)::int - 1);

  insert into public.payroll_runs (institution_id, month, created_by)
  values (p_institution_id, v_month, v_caller)
  on conflict (institution_id, month) do nothing;

  select * into v_run
  from public.payroll_runs
  where institution_id = p_institution_id and month = v_month
  for update;

  if v_run.status <> 'draft' then
    raise exception 'code:invalid_state' using detail = 'payroll for this month is already finalized';
  end if;

  delete from public.payslips where run_id = v_run.id;

  insert into public.payslips (institution_id, run_id, staff_id, components, gross_paise, net_paise)
  select
    ss.institution_id,
    v_run.id,
    ss.staff_id,
    ss.components,
    ss.gross_paise,
    ss.gross_paise - coalesce((
      select sum((c ->> 'amount_paise')::bigint)
      from jsonb_array_elements(ss.components) c
      where c ->> 'kind' = 'deduction'
    ), 0)
  from public.salary_structures ss
  join public.staff s
    on s.id = ss.staff_id
   and s.institution_id = ss.institution_id
  where ss.institution_id = p_institution_id
    and ss.is_active
    and s.status = 'active';

  get diagnostics v_count = row_count;

  perform app.audit(
    p_institution_id,
    v_caller,
    'payroll.run.generated',
    'payroll_runs',
    v_run.id,
    null,
    jsonb_build_object('month', v_month, 'payslipCount', v_count),
    null
  );

  return v_run.id;
end;
$$;

revoke all on function app.generate_payroll_run(uuid, date) from public, anon, authenticated;

create function public.generate_payroll_run(p_institution_id uuid, p_month date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.generate_payroll_run(p_institution_id, p_month);
end;
$$;

revoke execute on function public.generate_payroll_run(uuid, date) from public, anon;
grant execute on function public.generate_payroll_run(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- app.finalize_payroll_run / public.finalize_payroll_run
-- ---------------------------------------------------------------------------

create function app.finalize_payroll_run(p_run_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_run public.payroll_runs;
  v_count int;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_run from public.payroll_runs where id = p_run_id for update;
  if v_run.id is null then
    raise exception 'code:not_found' using detail = 'payroll run not found';
  end if;

  if not app.has_role(v_run.institution_id, array['owner', 'accountant']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold payroll.manage for this institution';
  end if;

  if v_run.status <> 'draft' then
    raise exception 'code:invalid_state' using detail = 'payroll run is already finalized';
  end if;

  select count(*) into v_count from public.payslips p where p.run_id = p_run_id;
  if v_count = 0 then
    raise exception 'code:invalid_state' using detail = 'payroll run has no payslips';
  end if;

  update public.payroll_runs
  set status = 'finalized', finalized_at = now(), finalized_by = v_caller
  where id = p_run_id;

  perform app.audit(
    v_run.institution_id,
    v_caller,
    'payroll.run.finalized',
    'payroll_runs',
    p_run_id,
    jsonb_build_object('status', 'draft'),
    jsonb_build_object('status', 'finalized', 'payslipCount', v_count),
    null
  );

  return p_run_id;
end;
$$;

revoke all on function app.finalize_payroll_run(uuid) from public, anon, authenticated;

create function public.finalize_payroll_run(p_run_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.finalize_payroll_run(p_run_id);
end;
$$;

revoke execute on function public.finalize_payroll_run(uuid) from public, anon;
grant execute on function public.finalize_payroll_run(uuid) to authenticated;
