-- M23-T2: migration 0096 part 1 — workflows, workflow_runs, write guards,
-- RLS/grants, agent_runs FK (M23-tasks.md rulings: Tables, agent_runs
-- additions, RLS + grants, both guards). Parts 2 (run lifecycle definers)
-- and 3 (workflow_metric) are appended to this same file by T3 and T4.
--
-- Module `workflows` is already in the MOD catalog (0084) — no catalog/SQL
-- module edit here. Trusted (lesson 5) = service_role JWT claim or
-- session_user = 'postgres'; app.guard_workflow_write uses it,
-- app.guard_workflow_run_update does not (no bypass — only definers and the
-- service role ever write workflow_runs, same as 0095's agent-run guard).

-- ---------------------------------------------------------------------------
-- workflows
-- ---------------------------------------------------------------------------

create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  name text not null check (length(name) between 1 and 80),
  version int not null default 1 check (version >= 1),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'disabled')),
  trigger_type text not null check (trigger_type in ('schedule', 'event', 'manual')),
  trigger_config text not null default '' check (length(trigger_config) <= 100),
  nodes jsonb not null
    check (jsonb_typeof(nodes) = 'array' and jsonb_array_length(nodes) between 2 and 30 and octet_length(nodes::text) <= 30000),
  edges jsonb not null
    check (jsonb_typeof(edges) = 'array' and jsonb_array_length(edges) between 1 and 60 and octet_length(edges::text) <= 10000),
  next_run_at timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflows_institution_id_name_key unique (institution_id, name),
  -- Composite-FK target for workflow_runs.workflow_id below.
  constraint workflows_id_institution_key unique (id, institution_id),
  constraint workflows_trigger_config_manual_check
    check ((trigger_type = 'manual') = (trigger_config = '')),
  constraint workflows_trigger_config_event_check
    check (trigger_type <> 'event' or trigger_config in ('attendance.absences_submitted', 'results.published', 'enquiry.received')),
  -- Cron grammar copied verbatim from app.cron_next_fire's v_pattern (0077).
  constraint workflows_trigger_config_schedule_check
    check (trigger_type <> 'schedule' or trigger_config ~ '^([0-9]|[1-5][0-9]) ([0-9]|1[0-9]|2[0-3]) (\*|[0-9]{1,2}(-[0-9]{1,2})?(,[0-9]{1,2}(-[0-9]{1,2})?)*) (\*|[0-9]{1,2}(-[0-9]{1,2})?(,[0-9]{1,2}(-[0-9]{1,2})?)*) (\*|[0-9]{1,2}(-[0-9]{1,2})?(,[0-9]{1,2}(-[0-9]{1,2})?)*)$')
);

create index workflows_next_run_at_idx
  on public.workflows (next_run_at)
  where status = 'active' and trigger_type = 'schedule';

create index workflows_trigger_lookup_idx
  on public.workflows (institution_id, trigger_type, trigger_config)
  where status = 'active';

create trigger set_updated_at
before update on public.workflows
for each row execute function app.set_updated_at();

-- Write guard (Guard app.guard_workflow_write ruling). security definer so
-- it can read public.institutions for the timezone regardless of the
-- caller's own select visibility of that table (mirrors 0077's
-- scheduled_reports_before_write).
create function app.guard_workflow_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trusted boolean;
  v_graph_changed boolean;
  v_recompute boolean;
  v_tz text;
begin
  v_trusted := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres';

  if tg_op = 'INSERT' then
    if not v_trusted and new.status <> 'draft' then
      raise exception 'code:invalid_state' using detail = 'new workflows must start as draft';
    end if;
    new.version := 1;
    if not v_trusted then
      new.created_by := app.current_user_id();
    end if;
  else
    if not v_trusted and (
      new.institution_id is distinct from old.institution_id
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
    ) then
      raise exception 'code:forbidden' using detail = 'institution_id, created_by and created_at are immutable';
    end if;

    v_graph_changed := new.nodes is distinct from old.nodes
      or new.edges is distinct from old.edges
      or new.trigger_type is distinct from old.trigger_type
      or new.trigger_config is distinct from old.trigger_config;

    if v_graph_changed then
      if old.status not in ('draft', 'paused') then
        raise exception 'code:invalid_state' using detail = 'pause the workflow to edit its graph';
      end if;
      new.version := old.version + 1;
    else
      new.version := old.version;
    end if;

    if new.status is distinct from old.status then
      if not (
        (old.status = 'draft' and new.status in ('active', 'disabled'))
        or (old.status = 'active' and new.status in ('paused', 'disabled'))
        or (old.status = 'paused' and new.status in ('active', 'disabled'))
        or (old.status = 'disabled' and new.status = 'draft')
      ) then
        raise exception 'code:invalid_state' using detail = format('invalid workflow status transition %s -> %s', old.status, new.status);
      end if;
    end if;
  end if;

  v_recompute := tg_op = 'INSERT'
    or new.status is distinct from old.status
    or new.trigger_type is distinct from old.trigger_type
    or new.trigger_config is distinct from old.trigger_config;

  if v_recompute then
    select coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata') into v_tz
    from public.institutions i
    where i.id = new.institution_id;

    new.next_run_at := case
      when new.status = 'active' and new.trigger_type = 'schedule' then app.cron_next_fire(new.trigger_config, v_tz, now())
      else null
    end;

    if new.status = 'active' and new.trigger_type = 'schedule' and new.next_run_at is null then
      raise exception 'code:validation_failed' using detail = 'cron never fires';
    end if;
  elsif tg_op = 'UPDATE' and not v_trusted then
    -- Any other update by a non-trusted caller keeps the existing
    -- next_run_at (users cannot force a run); the sweep (trusted) keeps
    -- whatever value it supplied.
    new.next_run_at := old.next_run_at;
  end if;

  return new;
end;
$$;

revoke execute on function app.guard_workflow_write() from public;

create trigger guard_workflow_write
before insert or update on public.workflows
for each row execute function app.guard_workflow_write();

alter table public.workflows enable row level security;

create policy workflows_select on public.workflows
  for select to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

create policy workflows_insert on public.workflows
  for insert to authenticated
  with check (institution_id = any((select app.my_institution_ids(array['owner', 'principal']))));

create policy workflows_update on public.workflows
  for update to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'principal']))))
  with check (institution_id = any((select app.my_institution_ids(array['owner', 'principal']))));

revoke all on public.workflows from anon, authenticated;
grant select, insert, update on public.workflows to authenticated;
grant select, insert, update on public.workflows to service_role;

-- ---------------------------------------------------------------------------
-- workflow_runs
-- ---------------------------------------------------------------------------

create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  workflow_id uuid not null,
  workflow_version int not null check (workflow_version >= 1),
  engine_version text check (engine_version is null or length(engine_version) <= 20),
  graph jsonb not null check (jsonb_typeof(graph) = 'object'),
  trigger_kind text not null check (trigger_kind in ('schedule', 'event', 'manual')),
  trigger_key text not null check (length(trigger_key) between 1 and 200),
  entity_id uuid,
  requested_by uuid references public.profiles (id),
  status text not null default 'running' check (status in ('running', 'awaiting_approval', 'done', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  steps jsonb not null default '[]'::jsonb
    check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) <= 100),
  cursor_node_id text check (cursor_node_id is null or length(cursor_node_id) <= 40),
  pending_decision text check (pending_decision is null or pending_decision in ('approved', 'rejected')),
  last_value int,
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_runs_workflow_fk
    foreign key (workflow_id, institution_id) references public.workflows (id, institution_id),
  constraint workflow_runs_workflow_trigger_key unique (workflow_id, trigger_key),
  -- Composite-FK target for agent_runs.workflow_run_id below.
  constraint workflow_runs_id_institution_key unique (id, institution_id),
  constraint workflow_runs_finished_at_check
    check ((status in ('done', 'failed')) = (finished_at is not null)),
  constraint workflow_runs_awaiting_cursor_check
    check (status <> 'awaiting_approval' or cursor_node_id is not null),
  constraint workflow_runs_pending_decision_running_check
    check (pending_decision is null or status = 'running')
);

create index workflow_runs_institution_created_idx on public.workflow_runs (institution_id, created_at desc);
create index workflow_runs_workflow_created_idx on public.workflow_runs (workflow_id, created_at desc);
create index workflow_runs_awaiting_approval_idx on public.workflow_runs (institution_id) where status = 'awaiting_approval';
create index workflow_runs_running_idx on public.workflow_runs (updated_at) where status = 'running';

create trigger set_updated_at
before update on public.workflow_runs
for each row execute function app.set_updated_at();

-- Run guard (Guard app.guard_workflow_run_update ruling). security invoker,
-- no bypass — only definers (T3) and the service role ever write this
-- table (mirrors 0095's app.guard_agent_run_update header note).
create function app.guard_workflow_run_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status in ('done', 'failed') then
    raise exception 'code:invalid_state' using detail = 'workflow run is terminal and cannot change';
  end if;

  if new.institution_id is distinct from old.institution_id
    or new.workflow_id is distinct from old.workflow_id
    or new.workflow_version is distinct from old.workflow_version
    or new.graph is distinct from old.graph
    or new.trigger_kind is distinct from old.trigger_kind
    or new.trigger_key is distinct from old.trigger_key
    or new.entity_id is distinct from old.entity_id
    or new.requested_by is distinct from old.requested_by
    or new.started_at is distinct from old.started_at
    or new.created_at is distinct from old.created_at
  then
    raise exception 'code:invalid_state' using detail = 'workflow run identity columns are immutable';
  end if;

  if old.status = 'running' and new.status in ('awaiting_approval', 'done', 'failed') then
    return new;
  end if;

  if old.status = 'awaiting_approval' and new.status = 'running' then
    if new.pending_decision is null or new.decided_by is null or new.decided_at is null then
      raise exception 'code:invalid_state' using detail = 'resuming a waiting run requires pending_decision, decided_by and decided_at';
    end if;
    return new;
  end if;

  raise exception 'code:invalid_state' using detail = format('invalid workflow run transition %s -> %s', old.status, new.status);
end;
$$;

create trigger guard_workflow_run_update
before update on public.workflow_runs
for each row execute function app.guard_workflow_run_update();

alter table public.workflow_runs enable row level security;

create policy workflow_runs_select on public.workflow_runs
  for select to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

revoke all on public.workflow_runs from anon, authenticated;
grant select on public.workflow_runs to authenticated;
grant select, insert, update on public.workflow_runs to service_role;

-- ---------------------------------------------------------------------------
-- agent_runs additions (0095 left workflow_run_id without an FK for M23).
-- ---------------------------------------------------------------------------

alter table public.agent_runs
  add constraint agent_runs_workflow_run_fk
  foreign key (workflow_run_id, institution_id) references public.workflow_runs (id, institution_id);

-- Queueing an agent from a workflow run is idempotent per (run, agent).
create unique index agent_runs_workflow_agent_key
  on public.agent_runs (workflow_run_id, agent_id)
  where workflow_run_id is not null;

-- M23-T3: migration 0096 part 2 — run lifecycle definers (M23-tasks.md
-- rulings: Run lifecycle). Part 3 (workflow_metric) is appended by T4.
--
-- app.create_workflow_run is the shared core: revoked from everyone, called
-- only by the four public definers below (all owned by the same migration
-- role, so the internal calls work without any grant — same pattern as
-- 0070's decide_leave). Payloads are built in SQL from the locked/selected
-- row (lesson 3); no dynamic SQL, qualified names throughout (lesson 4).

create function app.create_workflow_run(
  p_workflow_id uuid,
  p_trigger_kind text,
  p_trigger_key text,
  p_entity_id uuid,
  p_requested_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workflow public.workflows;
  v_run_id uuid;
begin
  select * into v_workflow from public.workflows where id = p_workflow_id;

  insert into public.workflow_runs (
    institution_id, workflow_id, workflow_version, graph, trigger_kind, trigger_key, entity_id, requested_by
  )
  values (
    v_workflow.institution_id,
    p_workflow_id,
    v_workflow.version,
    jsonb_build_object('nodes', v_workflow.nodes, 'edges', v_workflow.edges),
    p_trigger_kind,
    p_trigger_key,
    p_entity_id,
    p_requested_by
  )
  on conflict (workflow_id, trigger_key) do nothing
  returning id into v_run_id;

  if v_run_id is not null then
    perform app.enqueue_job(
      v_workflow.institution_id,
      'workflow.run',
      jsonb_build_object('run_id', v_run_id),
      'workflow.run:' || v_run_id::text || ':start'
    );
  end if;

  return v_run_id;
end;
$$;

revoke execute on function app.create_workflow_run(uuid, text, text, uuid, uuid) from public, anon, authenticated;

-- public.emit_workflow_event — called by the three notify.* jobs (M23-T14)
-- after their own domain checks (events ruling). Closed set of 3 event
-- keys; a module switched off emits nothing (feature off), never an error.
create function public.emit_workflow_event(p_institution_id uuid, p_event text, p_entity_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_run_id uuid;
  v_count int := 0;
begin
  if p_entity_id is null or p_event not in ('attendance.absences_submitted', 'results.published', 'enquiry.received') then
    raise exception 'code:validation_failed' using detail = 'unknown workflow event or missing entity';
  end if;

  if not app.module_enabled(p_institution_id, 'workflows') then
    return 0;
  end if;

  for v_row in
    select id
    from public.workflows
    where institution_id = p_institution_id
      and status = 'active'
      and trigger_type = 'event'
      and trigger_config = p_event
  loop
    v_run_id := app.create_workflow_run(v_row.id, 'event', 'event:' || p_event || ':' || p_entity_id::text, p_entity_id, null);
    if v_run_id is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.emit_workflow_event(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.emit_workflow_event(uuid, text, uuid) to service_role;

-- public.enqueue_due_workflows — runner sweep port (M23-T13), mirrors
-- 0077's enqueue_due_reports. Missed windows are skipped (advances from
-- the later of the missed next_run_at or now(), one late run at most).
-- Also reaps workflow_runs stuck "running" for 6+ hours (0003's ~5-attempt
-- backoff is ~30 minutes, so 6 hours means the job is gone — MOD dropped
-- it or it died), failing them so they stop blocking their trigger key.
create function public.enqueue_due_workflows()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_tz text;
  v_run_id uuid;
  v_count int := 0;
begin
  for v_row in
    select w.id, w.institution_id, w.trigger_config, w.next_run_at
    from public.workflows w
    where w.status = 'active'
      and w.trigger_type = 'schedule'
      and w.next_run_at <= now()
      and app.module_enabled(w.institution_id, 'workflows')
    order by w.next_run_at
    limit 200
    for update skip locked
  loop
    v_run_id := app.create_workflow_run(
      v_row.id,
      'schedule',
      'schedule:' || to_char(v_row.next_run_at at time zone 'UTC', 'YYYYMMDD"T"HH24MI"Z"'),
      null,
      null
    );

    if v_run_id is not null then
      v_count := v_count + 1;
    end if;

    select coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata') into v_tz
    from public.institutions i
    where i.id = v_row.institution_id;

    update public.workflows
    set next_run_at = app.cron_next_fire(v_row.trigger_config, v_tz, greatest(v_row.next_run_at, now()))
    where id = v_row.id;
  end loop;

  update public.workflow_runs
  set status = 'failed',
      finished_at = now(),
      cursor_node_id = null,
      pending_decision = null,
      steps = steps || jsonb_build_array(jsonb_build_object('node_id', '_run', 'status', 'failed', 'at', now(), 'note', 'Stopped: no progress for 6 hours'))
  where status = 'running'
    and updated_at < now() - interval '6 hours';

  return v_count;
end;
$$;

revoke execute on function public.enqueue_due_workflows() from public, anon, authenticated;
grant execute on function public.enqueue_due_workflows() to service_role;

-- public.start_workflow_run — manual trigger (Permissions ruling:
-- workflow.manage = owner/principal). Non-member or a role below admin
-- gets not_found (never leaks another institution's workflow); admin gets
-- forbidden (can read, cannot act). Idempotent per calendar minute so a
-- double click returns the same run.
create function public.start_workflow_run(p_workflow_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.current_user_id();
  v_workflow public.workflows;
  v_key text;
  v_run_id uuid;
begin
  if v_uid is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_workflow from public.workflows where id = p_workflow_id;
  if v_workflow.id is null or not app.has_role(v_workflow.institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:not_found' using detail = 'workflow not found';
  end if;

  if not app.has_role(v_workflow.institution_id, array['owner', 'principal']) then
    raise exception 'code:forbidden' using detail = 'only owner/principal may start a workflow run';
  end if;

  if not app.module_enabled(v_workflow.institution_id, 'workflows') then
    raise exception 'code:forbidden' using detail = 'workflows module is not enabled for this institution';
  end if;

  if v_workflow.status <> 'active' or v_workflow.trigger_type = 'event' then
    raise exception 'code:invalid_state' using detail = 'workflow must be active, and not event-triggered, to start manually';
  end if;

  v_key := 'manual:' || to_char(now() at time zone 'UTC', 'YYYYMMDD"T"HH24MI');
  v_run_id := app.create_workflow_run(p_workflow_id, 'manual', v_key, null, v_uid);

  if v_run_id is null then
    select id into v_run_id from public.workflow_runs where workflow_id = p_workflow_id and trigger_key = v_key;
  end if;

  perform app.audit(
    v_workflow.institution_id,
    v_uid,
    'workflow.run.started',
    'workflow_run',
    v_run_id,
    null,
    jsonb_build_object('run_id', v_run_id, 'workflow_id', p_workflow_id),
    null
  );

  return v_run_id;
end;
$$;

revoke execute on function public.start_workflow_run(uuid) from public, anon;
grant execute on function public.start_workflow_run(uuid) to authenticated;

-- public.decide_workflow_run — approval decision (Permissions ruling:
-- workflow.manage = owner/principal). Same not_found/forbidden split as
-- start_workflow_run. A single `select ... for update` both locks the row
-- and backs every check; a second concurrent decision blocks on that lock,
-- then re-reads a status that is no longer awaiting_approval and fails at
-- the invalid_state check (same shape as 0070's decide_leave).
create function public.decide_workflow_run(p_run_id uuid, p_decision text, p_note text default null)
returns public.workflow_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.current_user_id();
  v_run public.workflow_runs;
  v_pending text;
  v_action text;
begin
  if v_uid is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_run from public.workflow_runs where id = p_run_id for update;
  if v_run.id is null or not app.has_role(v_run.institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:not_found' using detail = 'workflow run not found';
  end if;

  if not app.has_role(v_run.institution_id, array['owner', 'principal']) then
    raise exception 'code:forbidden' using detail = 'only owner/principal may decide a workflow run';
  end if;

  if not app.module_enabled(v_run.institution_id, 'workflows') then
    raise exception 'code:forbidden' using detail = 'workflows module is not enabled for this institution';
  end if;

  if p_decision not in ('approve', 'reject') or (p_note is not null and length(p_note) > 500) then
    raise exception 'code:validation_failed' using detail = 'decision must be approve or reject, note at most 500 characters';
  end if;

  if v_run.status <> 'awaiting_approval' then
    raise exception 'code:invalid_state' using detail = 'workflow run is not awaiting approval';
  end if;

  v_pending := case p_decision when 'approve' then 'approved' else 'rejected' end;
  v_action := case p_decision when 'approve' then 'workflow.run.approved' else 'workflow.run.rejected' end;

  update public.workflow_runs
  set status = 'running', pending_decision = v_pending, decided_by = v_uid, decided_at = now(), decision_note = p_note
  where id = p_run_id
  returning * into v_run;

  perform app.enqueue_job(
    v_run.institution_id,
    'workflow.run',
    jsonb_build_object('run_id', v_run.id),
    'workflow.run:' || v_run.id::text || ':' || v_run.cursor_node_id
  );

  perform app.audit(
    v_run.institution_id,
    v_uid,
    v_action,
    'workflow_run',
    v_run.id,
    null,
    jsonb_build_object('run_id', v_run.id, 'node_id', v_run.cursor_node_id),
    null
  );

  return v_run;
end;
$$;

revoke execute on function public.decide_workflow_run(uuid, text, text) from public, anon;
grant execute on function public.decide_workflow_run(uuid, text, text) to authenticated;

-- M23-T4 (part 3): public.workflow_metric — the closed set of 6 SQL
-- metrics a `condition` node reads (Metrics ruling). `stable security
-- invoker`, service_role only: the institution filter on every query below
-- is the only filter (M15 precedent, same shape as 0077's report RPCs), so
-- an entity id from another institution always counts 0 rather than
-- erroring. `d` is the caller's `p_as_of` in the institution's own
-- timezone (`settings.locale.timezone`, same jsonb path as everywhere
-- else); the two attendance metrics reuse 0014's notify-code jsonb path
-- (`settings.attendance.statuses[*]` where `notify_guardian` is true).
create function public.workflow_metric(
  p_institution_id uuid,
  p_metric text,
  p_entity_id uuid,
  p_as_of timestamptz
)
returns int
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tz text;
  v_d date;
  v_count int;
  v_notify_codes text[];
  v_session public.attendance_sessions;
  v_last3 uuid[];
begin
  if p_metric not in (
    'attendance.session_absences',
    'attendance.repeat_absentees',
    'assignments.missing_due_tomorrow',
    'exams.papers_next_7_days',
    'finance.overdue_invoices',
    'admissions.stale_enquiries'
  ) then
    raise exception 'code:validation_failed' using detail = format('unknown metric %L', p_metric);
  end if;

  if p_metric in ('attendance.session_absences', 'attendance.repeat_absentees') and p_entity_id is null then
    raise exception 'code:validation_failed' using detail = format('metric %L requires an entity id', p_metric);
  end if;

  select coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata') into v_tz
  from public.institutions i
  where i.id = p_institution_id;

  v_d := (p_as_of at time zone v_tz)::date;

  if p_metric in ('attendance.session_absences', 'attendance.repeat_absentees') then
    select array_agg(elem ->> 'code') into v_notify_codes
    from public.institutions i,
         jsonb_array_elements(coalesce(i.settings -> 'attendance' -> 'statuses', '[]'::jsonb)) as elem
    where i.id = p_institution_id and coalesce((elem ->> 'notify_guardian')::boolean, false);
    v_notify_codes := coalesce(v_notify_codes, array[]::text[]);
  end if;

  if p_metric = 'attendance.session_absences' then
    select count(*) into v_count
    from public.attendance_records r
    join public.attendance_sessions s on s.id = r.session_id and s.institution_id = r.institution_id
    where r.session_id = p_entity_id
      and r.institution_id = p_institution_id
      and r.status = any(v_notify_codes);

  elsif p_metric = 'attendance.repeat_absentees' then
    select * into v_session
    from public.attendance_sessions
    where id = p_entity_id and institution_id = p_institution_id;

    if v_session.id is null then
      v_count := 0;
    else
      select coalesce(array_agg(x.id), array[]::uuid[]) into v_last3
      from (
        select id
        from public.attendance_sessions
        where class_section_id = v_session.class_section_id
          and institution_id = p_institution_id
          and period_id is null
          and status = 'submitted'
          and date <= v_session.date
        order by date desc
        limit 3
      ) x;

      if array_length(v_last3, 1) is distinct from 3 then
        v_count := 0;
      else
        select count(*) into v_count
        from (
          select student_id
          from public.attendance_records
          where institution_id = p_institution_id
            and session_id = any(v_last3)
            and status = any(v_notify_codes)
          group by student_id
          having count(distinct session_id) = 3
        ) matched;
      end if;
    end if;

  elsif p_metric = 'assignments.missing_due_tomorrow' then
    select count(*) into v_count
    from public.assignments a
    join public.enrolments e
      on e.class_section_id = a.class_section_id
      and e.institution_id = a.institution_id
      and e.status = 'active'
    where a.institution_id = p_institution_id
      and a.status = 'published'
      and (a.due_at at time zone v_tz)::date = v_d + 1
      and not exists (
        select 1 from public.assignment_submissions sub
        where sub.institution_id = a.institution_id
          and sub.assignment_id = a.id
          and sub.student_id = e.student_id
      );

  elsif p_metric = 'exams.papers_next_7_days' then
    select count(*) into v_count
    from public.exam_papers p
    join public.exams ex on ex.id = p.exam_id and ex.institution_id = p.institution_id
    where p.institution_id = p_institution_id
      and ex.status <> 'published'
      and p.held_on between v_d + 1 and v_d + 7;

  elsif p_metric = 'finance.overdue_invoices' then
    select count(*) into v_count
    from public.invoices inv
    where inv.institution_id = p_institution_id
      and inv.status in ('issued', 'part_paid')
      and inv.due_on < v_d
      and inv.total - inv.paid_total > 0;

  elsif p_metric = 'admissions.stale_enquiries' then
    select count(*) into v_count
    from public.enquiries en
    where en.institution_id = p_institution_id
      and en.status = 'new'
      and en.created_at < p_as_of - interval '48 hours';
  end if;

  return coalesce(v_count, 0);
end;
$$;

revoke execute on function public.workflow_metric(uuid, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.workflow_metric(uuid, text, uuid, timestamptz) to service_role;
