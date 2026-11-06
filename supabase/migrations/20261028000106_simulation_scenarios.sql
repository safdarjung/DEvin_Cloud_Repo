-- live-fabric lane "simulator" (F-UI-08): simulation_scenarios — saved
-- what-if scenarios for /fabric/simulator, replacing the
-- src/modules/fabric/demo/simulator.ts fixture's SAVED_SCENARIOS as the
-- source of truth. runScenario/sensitivity stay pure, client-computed from
-- `assumptions` (BRIEF "Every lane" ruling) — no `results` column here.
--
-- RLS: owner/principal/admin read + insert/update (table-level, lesson 1).
-- Finer rule — approve/reject (status -> approved/rejected) restricted to
-- owner/principal only — is enforced by the guard trigger below (not RLS
-- alone), mirroring 0096's guard_workflow_write pattern (lesson 3/6):
-- immutable institution_id/created_by/created_at, valid status transitions
-- (draft/proposed only -> approved/rejected, decided rows frozen),
-- decided_by/decided_at always server-derived.

create table public.simulation_scenarios (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  name text not null check (length(name) between 1 and 80),
  rationale text not null default '' check (length(rationale) <= 500),
  assumptions jsonb not null check (jsonb_typeof(assumptions) = 'object'),
  status text not null default 'draft' check (status in ('draft', 'proposed', 'approved', 'rejected')),
  created_by uuid not null references public.profiles (id),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint simulation_scenarios_decided_check
    check ((status in ('approved', 'rejected')) = (decided_by is not null and decided_at is not null))
);

create index simulation_scenarios_institution_status_idx
  on public.simulation_scenarios (institution_id, status);

create trigger set_updated_at
before update on public.simulation_scenarios
for each row execute function app.set_updated_at();

-- Write guard: security definer so app.has_role's membership lookup runs
-- regardless of the caller's own RLS visibility (mirrors 0096's header
-- note for guard_workflow_write). `v_trusted` (service_role JWT claim or
-- session_user = 'postgres', lesson 5) bypasses every check below so the
-- seed/reset path and this table's own service-role writes (tests) are
-- never blocked by a rule meant for an end-user session.
create function app.guard_simulation_scenario_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trusted boolean;
begin
  v_trusted := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres';

  if tg_op = 'INSERT' then
    if not v_trusted then
      if new.status not in ('draft', 'proposed') then
        raise exception 'code:invalid_state' using detail = 'new scenarios must start as draft or proposed';
      end if;
      new.created_by := app.current_user_id();
      new.decided_by := null;
      new.decided_at := null;
    end if;
    return new;
  end if;

  if v_trusted then
    return new;
  end if;

  if new.institution_id is distinct from old.institution_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'code:forbidden' using detail = 'institution_id, created_by and created_at are immutable';
  end if;

  if old.status in ('approved', 'rejected') and new.status is distinct from old.status then
    raise exception 'code:invalid_state' using detail = 'a decided scenario cannot change status';
  end if;

  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    if old.status <> 'proposed' then
      raise exception 'code:invalid_state' using detail = format('invalid scenario status transition %s -> %s', old.status, new.status);
    end if;
    if not app.has_role(new.institution_id, array['owner', 'principal']) then
      raise exception 'code:forbidden' using detail = 'only owner or principal may approve or reject a scenario';
    end if;
    new.decided_by := app.current_user_id();
    new.decided_at := now();
  else
    new.decided_by := old.decided_by;
    new.decided_at := old.decided_at;
  end if;

  return new;
end;
$$;

revoke execute on function app.guard_simulation_scenario_write() from public;

create trigger guard_simulation_scenario_write
before insert or update on public.simulation_scenarios
for each row execute function app.guard_simulation_scenario_write();

alter table public.simulation_scenarios enable row level security;

create policy simulation_scenarios_select on public.simulation_scenarios
  for select to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

create policy simulation_scenarios_insert on public.simulation_scenarios
  for insert to authenticated
  with check (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

create policy simulation_scenarios_update on public.simulation_scenarios
  for update to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))))
  with check (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

-- Delete: draft only (once proposed, it stays visible for a decision).
create policy simulation_scenarios_delete on public.simulation_scenarios
  for delete to authenticated
  using (
    status = 'draft'
    and institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
  );

revoke all on public.simulation_scenarios from anon, authenticated;
grant select, insert, update, delete on public.simulation_scenarios to authenticated;
grant select, insert, update, delete on public.simulation_scenarios to service_role;
