-- F-UI-12 (live-fabric studio lane) — studio_requests: Custom Studio intake,
-- AI proposal, and owner/principal decision. One table replaces the demo
-- fixture's two (studio_requests/studio_proposals, src/modules/fabric/demo/
-- studio.ts) — a proposal is embedded jsonb, not a separate versioned row,
-- since this lane has no real build pipeline yet (BRIEF "no fake agent
-- pipeline"). All state transitions go through the two definers below
-- (propose_studio_request, decide_studio_request); no UPDATE grant to
-- authenticated at all (BRIEF-COMMON lesson 3) — only `service_role` can
-- UPDATE directly, matching 20261028000096's workflow_runs.

create table public.studio_requests (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),

  title text not null check (length(title) between 1 and 200),
  problem text not null check (length(problem) between 1 and 2000),
  desired_outcome text not null check (length(desired_outcome) between 1 and 2000),
  -- user_roles/existing_systems/integrations/constraints (wizard "Context" step).
  context jsonb not null default '{}'::jsonb
    check (jsonb_typeof(context) = 'object' and octet_length(context::text) <= 4000),
  -- budget_range/timeline/success_criteria (wizard "Terms" step).
  terms jsonb not null default '{}'::jsonb
    check (jsonb_typeof(terms) = 'object' and octet_length(terms::text) <= 2000),

  status text not null default 'submitted'
    check (status in ('submitted', 'proposed', 'approved', 'rejected', 'in_progress', 'delivered')),
  -- Set once, by propose_studio_request, moving submitted -> proposed; never cleared after.
  proposal jsonb
    check (proposal is null or (jsonb_typeof(proposal) = 'object' and octet_length(proposal::text) <= 20000)),
  constraint studio_requests_proposal_matches_status check ((status = 'submitted') = (proposal is null)),

  notes text[] not null default '{}'::text[] check (cardinality(notes) <= 50),

  created_by uuid not null references public.profiles (id),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  constraint studio_requests_decided_pair check ((decided_by is null) = (decided_at is null)),
  constraint studio_requests_decided_after_proposed check (decided_by is null or status in ('approved', 'rejected', 'in_progress', 'delivered')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index studio_requests_institution_created_idx
  on public.studio_requests (institution_id, created_at desc);

create trigger set_updated_at
before update on public.studio_requests
for each row execute function app.set_updated_at();

-- Write guard: INSERT normalizes a fresh intake row (status/proposal/decision
-- columns cannot be client-supplied); UPDATE only ever runs from the two
-- definers below, so this validates their two legal transitions and that
-- nothing else about the row changes — no v_trusted bypass (cf. 0096's
-- workflow_runs guard), since there is no service-role write path yet
-- either (BRIEF: in_progress/delivered have no app-level path in this lane).
create function app.guard_studio_request_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trusted boolean;
  v_old_notes_len int;
begin
  if tg_op = 'INSERT' then
    v_trusted := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
      or session_user = 'postgres';

    new.status := 'submitted';
    new.proposal := null;
    new.decided_by := null;
    new.decided_at := null;
    new.notes := coalesce(new.notes, '{}');
    if not v_trusted then
      new.created_by := app.current_user_id();
    end if;
    return new;
  end if;

  if new.institution_id is distinct from old.institution_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or new.title is distinct from old.title
    or new.problem is distinct from old.problem
    or new.desired_outcome is distinct from old.desired_outcome
    or new.context is distinct from old.context
    or new.terms is distinct from old.terms
  then
    raise exception 'code:forbidden' using detail = 'request content and identity columns are immutable';
  end if;

  v_old_notes_len := coalesce(array_length(old.notes, 1), 0);
  if new.notes[1:v_old_notes_len] is distinct from old.notes then
    raise exception 'code:invalid_state' using detail = 'notes can only be appended to';
  end if;

  if old.status = 'submitted' and new.status = 'proposed' then
    if new.proposal is null or new.decided_by is not null or new.decided_at is not null then
      raise exception 'code:invalid_state' using detail = 'proposing requires a proposal and no decision yet';
    end if;
  elsif old.status = 'proposed' and new.status in ('approved', 'rejected') then
    if new.proposal is distinct from old.proposal or new.decided_by is null or new.decided_at is null then
      raise exception 'code:invalid_state' using detail = 'deciding requires keeping the proposal and setting decided_by/decided_at';
    end if;
  else
    raise exception 'code:invalid_state' using detail = format('invalid studio request transition %s -> %s', old.status, new.status);
  end if;

  return new;
end;
$$;

revoke execute on function app.guard_studio_request_write() from public;

create trigger guard_studio_request_write
before insert or update on public.studio_requests
for each row execute function app.guard_studio_request_write();

alter table public.studio_requests enable row level security;

-- Leadership (owner/principal/admin) read and create (BRIEF "leadership
-- read/create"); approve/reject is narrower, enforced inside
-- decide_studio_request below, not by a second RLS role set.
create policy studio_requests_select on public.studio_requests
  for select to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

create policy studio_requests_insert on public.studio_requests
  for insert to authenticated
  with check (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

revoke all on public.studio_requests from anon, authenticated;
grant select, insert on public.studio_requests to authenticated;
grant select, insert, update on public.studio_requests to service_role;

-- ---------------------------------------------------------------------------
-- public.propose_studio_request — AI proposal (studio.actions.ts calls
-- runStructured first, then this with the validated, already-Zod-checked
-- jsonb result); leadership (owner/principal/admin), matching the table's
-- own insert/select role set.
-- ---------------------------------------------------------------------------

create function public.propose_studio_request(p_request_id uuid, p_proposal jsonb)
returns public.studio_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.current_user_id();
  v_row public.studio_requests;
begin
  if v_uid is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_row from public.studio_requests where id = p_request_id for update;
  if v_row.id is null or not app.has_role(v_row.institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:not_found' using detail = 'studio request not found';
  end if;

  if v_row.status <> 'submitted' then
    raise exception 'code:invalid_state' using detail = format('studio request status %s cannot be proposed', v_row.status);
  end if;

  update public.studio_requests
  set proposal = p_proposal, status = 'proposed'
  where id = p_request_id
  returning * into v_row;

  perform app.audit(
    v_row.institution_id, v_uid, 'studio_request.proposed', 'studio_request', v_row.id,
    null, jsonb_build_object('resolution', p_proposal ->> 'resolution'), null
  );

  return v_row;
end;
$$;

revoke execute on function public.propose_studio_request(uuid, jsonb) from public, anon;
grant execute on function public.propose_studio_request(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- public.decide_studio_request — approve/reject (Permissions ruling:
-- studio.approve = owner/principal only). Same not_found/forbidden split as
-- 0096's decide_workflow_run: a non-member or below-admin gets not_found,
-- admin (who can read but not decide) gets forbidden.
-- ---------------------------------------------------------------------------

create function public.decide_studio_request(p_request_id uuid, p_decision text, p_note text default null)
returns public.studio_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.current_user_id();
  v_row public.studio_requests;
  v_action text;
begin
  if v_uid is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_row from public.studio_requests where id = p_request_id for update;
  if v_row.id is null or not app.has_role(v_row.institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:not_found' using detail = 'studio request not found';
  end if;

  if not app.has_role(v_row.institution_id, array['owner', 'principal']) then
    raise exception 'code:forbidden' using detail = 'only owner/principal may decide a studio request';
  end if;

  if p_decision not in ('approve', 'reject') or (p_note is not null and length(p_note) > 500) then
    raise exception 'code:validation_failed' using detail = 'decision must be approve or reject, note at most 500 characters';
  end if;

  if v_row.status <> 'proposed' then
    raise exception 'code:invalid_state' using detail = format('studio request status %s cannot be decided', v_row.status);
  end if;

  v_action := case p_decision when 'approve' then 'studio_request.approved' else 'studio_request.rejected' end;

  update public.studio_requests
  set status = (case p_decision when 'approve' then 'approved' else 'rejected' end),
      decided_by = v_uid,
      decided_at = now(),
      notes = case when p_note is not null then notes || array[p_note] else notes end
  where id = p_request_id
  returning * into v_row;

  perform app.audit(
    v_row.institution_id, v_uid, v_action, 'studio_request', v_row.id,
    null, jsonb_build_object('decision', p_decision), null
  );

  return v_row;
end;
$$;

revoke execute on function public.decide_studio_request(uuid, text, text) from public, anon;
grant execute on function public.decide_studio_request(uuid, text, text) to authenticated;
