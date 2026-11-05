-- M22-T2: agent_definitions, agent_runs, guard app.guard_agent_run_update,
-- ai_usage_events.agent_run_id — module `agents` (M22-tasks.md rulings).
--
-- Rows hold per-institution state only; the agent catalog (names, tool/
-- action allowlists, risk) is code (`src/modules/agents/catalog.ts`, T3),
-- so a PostgREST caller can never widen a tool list or relabel a risk.
--
-- agent_definitions: authenticated may SELECT (owner/principal/admin) and
-- UPDATE only `is_enabled` (owner/principal). `slug`, timestamps and the
-- row's existence are server-only (`ensureAgentDefinitions`, T7's
-- service-role caller `agents`) — no INSERT/DELETE grant for authenticated
-- at all, so those are 42501 at the grant layer before RLS runs.
--
-- agent_runs: authenticated may SELECT (owner/principal/admin) only; no
-- INSERT/UPDATE/DELETE grant — every write is server-only, after the
-- calling action's own permission + module checks (rulings "Writes are
-- server-only"). `agent_id` carries a composite FK to
-- `(agent_definitions.id, institution_id)` (lesson 2 at schema level: a run
-- can never point at another institution's agent — 23503, not a runtime
-- check). `app.guard_agent_run_update` enforces the status state machine on
-- every UPDATE, with **no service_role/postgres bypass** (unlike this
-- repo's other guards) — only our server code and tests write this table,
-- and the state machine applies to all of them equally.
--
-- Both tables: default privileges (0045) already grant ALL to
-- anon/authenticated/service_role on any table created from here on, so
-- only the narrowing revokes/grants below are written out; service_role
-- keeps the (undeclared) extra privileges — e.g. DELETE, for
-- `app.demo_reset`'s per-institution sweep — from that same default.

-- ---------------------------------------------------------------------------
-- agent_definitions
-- ---------------------------------------------------------------------------

create table public.agent_definitions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  slug text not null check (length(slug) between 1 and 40),
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, slug),
  -- Composite-FK target for agent_runs.agent_id below.
  constraint agent_definitions_id_institution_key unique (id, institution_id)
);

create trigger set_updated_at
before update on public.agent_definitions
for each row execute function app.set_updated_at();

alter table public.agent_definitions enable row level security;

create policy agent_definitions_select on public.agent_definitions
  for select to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

create policy agent_definitions_update on public.agent_definitions
  for update to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'principal']))))
  with check (institution_id = any((select app.my_institution_ids(array['owner', 'principal']))));

revoke all on public.agent_definitions from anon, authenticated;
grant select on public.agent_definitions to authenticated;
grant update (is_enabled) on public.agent_definitions to authenticated;

-- ---------------------------------------------------------------------------
-- agent_runs
-- ---------------------------------------------------------------------------

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  agent_id uuid not null,
  workflow_run_id uuid,
  task text not null check (length(task) between 1 and 500),
  requested_by uuid not null references public.profiles (id),
  risk_class text not null default 'read_only'
    check (risk_class in ('read_only', 'low_risk_reversible', 'user_confirmed', 'human_approved')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'awaiting_approval', 'done', 'failed', 'rejected')),
  catalog_version text not null check (length(catalog_version) between 1 and 20),
  started_at timestamptz,
  finished_at timestamptz,
  summary text not null default '' check (length(summary) <= 2000),
  log jsonb not null default '[]'::jsonb
    check (jsonb_typeof(log) = 'array' and jsonb_array_length(log) <= 100),
  proposals jsonb not null default '[]'::jsonb
    check (jsonb_typeof(proposals) = 'array' and jsonb_array_length(proposals) <= 5),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A run's agent must belong to the run's own institution (lesson 2 at
  -- schema level) — a cross-tenant agent_id is 23503, never reachable.
  constraint agent_runs_agent_institution_fk
    foreign key (agent_id, institution_id) references public.agent_definitions (id, institution_id),
  constraint agent_runs_awaiting_risk_check
    check (status <> 'awaiting_approval' or risk_class in ('user_confirmed', 'human_approved')),
  constraint agent_runs_finished_at_check
    check ((status in ('done', 'failed', 'rejected')) = (finished_at is not null)),
  constraint agent_runs_rejected_decided_check
    check (status <> 'rejected' or decided_by is not null)
);

create index agent_runs_institution_created_idx on public.agent_runs (institution_id, created_at desc);
create index agent_runs_agent_created_idx on public.agent_runs (agent_id, created_at desc);
create index agent_runs_awaiting_approval_idx on public.agent_runs (institution_id) where status = 'awaiting_approval';

create trigger set_updated_at
before update on public.agent_runs
for each row execute function app.set_updated_at();

-- State machine (rulings): queued->running|failed; running->done|failed|
-- awaiting_approval; awaiting_approval->running (approve claim) and
-- awaiting_approval->rejected, both requiring decided_by+decided_at to be
-- set in the same update. Terminal rows (done|failed|rejected) and the
-- run's identity columns never change once written. No service_role/
-- postgres bypass — see header.
create function app.guard_agent_run_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status in ('done', 'failed', 'rejected') then
    raise exception 'code:invalid_state' using detail = 'agent run is terminal and cannot change';
  end if;

  if new.institution_id is distinct from old.institution_id
    or new.agent_id is distinct from old.agent_id
    or new.requested_by is distinct from old.requested_by
    or new.task is distinct from old.task
    or new.workflow_run_id is distinct from old.workflow_run_id
    or new.catalog_version is distinct from old.catalog_version
    or new.created_at is distinct from old.created_at
  then
    raise exception 'code:invalid_state' using detail = 'agent run identity columns are immutable';
  end if;

  if old.decided_by is not null and new.decided_by is distinct from old.decided_by then
    raise exception 'code:invalid_state' using detail = 'agent run decided_by cannot change once set';
  end if;

  if old.status = 'queued' and new.status in ('running', 'failed') then
    return new;
  end if;

  if old.status = 'running' and new.status in ('done', 'failed', 'awaiting_approval') then
    return new;
  end if;

  if old.status = 'awaiting_approval' and new.status = 'running' then
    if new.decided_by is null or new.decided_at is null then
      raise exception 'code:invalid_state' using detail = 'approval claim requires decided_by and decided_at';
    end if;
    return new;
  end if;

  if old.status = 'awaiting_approval' and new.status = 'rejected' then
    if new.decided_by is null or new.decided_at is null then
      raise exception 'code:invalid_state' using detail = 'rejection requires decided_by and decided_at';
    end if;
    return new;
  end if;

  raise exception 'code:invalid_state' using detail = format('invalid agent run transition %s -> %s', old.status, new.status);
end;
$$;

create trigger guard_agent_run_update
before update on public.agent_runs
for each row execute function app.guard_agent_run_update();

alter table public.agent_runs enable row level security;

create policy agent_runs_select on public.agent_runs
  for select to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

revoke all on public.agent_runs from anon, authenticated;
grant select on public.agent_runs to authenticated;

-- ---------------------------------------------------------------------------
-- ai_usage_events.agent_run_id (0003) — no FK: usage rows are immutable
-- under app.block_mutation and swept by app.demo_reset like every other
-- column on this table; a dangling value after a sweep is harmless.
-- ---------------------------------------------------------------------------

alter table public.ai_usage_events
  add column agent_run_id uuid;

create index ai_usage_events_agent_run_id_idx on public.ai_usage_events (agent_run_id) where agent_run_id is not null;
