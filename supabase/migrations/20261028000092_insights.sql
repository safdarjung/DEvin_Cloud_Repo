-- M19-T2: migration 0092 part 1 — insights, insight_actions, briefings
-- (tables, RLS, writer). Written across T2 → T6; each later task appends
-- one part to this same file (M19-tasks.md header).
--
-- insights/insight_actions/briefings have no INSERT/UPDATE/DELETE policy:
-- only the service-role job (record_insights, this part) and the T3
-- definers (decide_insight, record_insight_action, set_insight_explanation)
-- write them (BRIEF-COMMON lesson 3).

create table public.insights (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),

  signal text not null check (signal in (
    'attendance.section_drop', 'attendance.student_drop',
    'academics.marks_decline', 'academics.missing_work', 'academics.awaiting_review',
    'finance.overdue_growth', 'finance.concession_spike',
    'admissions.stage_dwell',
    'staff.workload',
    'operations.room_capacity', 'operations.room_pressure'
  )),
  detector_version int not null check (detector_version >= 1),
  dedupe_key text not null check (length(dedupe_key) between 1 and 200),

  domain text not null check (domain in (
    'attendance', 'academics', 'finance', 'admissions', 'operations', 'wellbeing', 'staff'
  )),
  kind text not null check (kind in ('descriptive', 'diagnostic', 'predictive', 'prescriptive')),
  severity text not null check (severity in ('info', 'watch', 'warning', 'critical')),

  title text not null check (length(title) between 1 and 120),
  pattern text not null check (length(pattern) between 1 and 300),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) between 1 and 8),
  sources text[] not null default '{}' check (cardinality(sources) <= 8),

  date_from date not null,
  date_to date not null check (date_from <= date_to),
  confidence numeric(3, 2) not null check (confidence between 0 and 1),
  factors jsonb not null default '[]' check (jsonb_typeof(factors) = 'array' and jsonb_array_length(factors) <= 5),

  reviewer_role text not null check (reviewer_role in (
    'owner', 'principal', 'admin', 'admissions', 'accountant', 'exam_controller'
  )),
  recommended_actions text[] not null default '{}' check (cardinality(recommended_actions) <= 3),
  approval_required boolean not null default false,

  status text not null default 'new' check (status in ('new', 'reviewing', 'actioned', 'resolved', 'dismissed')),

  entity_type text check (entity_type in ('section', 'student', 'staff', 'route', 'fee_structure', 'department')),
  entity_id uuid,
  check ((entity_type is null) = (entity_id is null)),
  entity_label text check (length(entity_label) <= 60),
  check (entity_type not in ('student', 'staff') or entity_label is null),
  class_section_id uuid references public.class_sections (id),

  explanation jsonb,
  explained_at timestamptz,
  explained_by uuid references public.profiles (id),
  explanation_provider text check (explanation_provider in ('local', 'cloud')),
  explanation_model text check (length(explanation_model) <= 100),

  reviewer_id uuid references public.profiles (id),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text check (length(decision_note) <= 500),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint insights_dedupe_key unique (institution_id, dedupe_key)
);

create unique index insights_open_key
  on public.insights (institution_id, signal, entity_type, entity_id)
  nulls not distinct
  where status in ('new', 'reviewing', 'actioned');

create index insights_institution_status_created_idx
  on public.insights (institution_id, status, created_at desc);

create index insights_class_section_id_idx on public.insights (class_section_id);

create trigger set_updated_at
before update on public.insights
for each row execute function app.set_updated_at();

alter table public.insights enable row level security;

create policy insights_select on public.insights
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or (domain = 'admissions' and institution_id = any((select app.my_institution_ids(array['admissions']))))
    or (domain = 'finance' and institution_id = any((select app.my_institution_ids(array['accountant']))))
    or (domain = 'academics' and institution_id = any((select app.my_institution_ids(array['exam_controller']))))
    or (domain in ('attendance', 'academics') and class_section_id = any((select app.my_taught_section_ids())))
  );

-- ---------------------------------------------------------------------------
-- insight_actions — append-only (02-architecture §4): no UPDATE/DELETE
-- policy either; a correction inserts a new row with supersedes_id set.
-- ---------------------------------------------------------------------------

create table public.insight_actions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  insight_id uuid not null references public.insights (id),
  supersedes_id uuid references public.insight_actions (id),
  action text not null check (length(action) between 1 and 200),
  owner text not null check (length(owner) between 1 and 80),
  rationale text not null check (length(rationale) between 1 and 500),
  expected_outcome text not null check (length(expected_outcome) between 1 and 300),
  actual_outcome text check (length(actual_outcome) <= 500),
  decided_at timestamptz not null default now(),
  measured_at timestamptz,
  status text not null check (status in ('planned', 'done', 'measured')),
  check (status <> 'measured' or (actual_outcome is not null and measured_at is not null)),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index insight_actions_one_successor_idx
  on public.insight_actions (supersedes_id)
  where supersedes_id is not null;

create index insight_actions_insight_id_idx on public.insight_actions (insight_id);

create trigger set_updated_at
before update on public.insight_actions
for each row execute function app.set_updated_at();

alter table public.insight_actions enable row level security;

-- Inherits the insights RLS: the exists() subquery runs under the caller's
-- row security on public.insights too, so a row is visible here exactly
-- when its parent insight is.
create policy insight_actions_select on public.insight_actions
  for select to authenticated
  using (
    exists (
      select 1 from public.insights i
      where i.id = insight_actions.insight_id and i.institution_id = insight_actions.institution_id
    )
  );

-- ---------------------------------------------------------------------------
-- briefings — table only here; M25 writes and reads it.
-- ---------------------------------------------------------------------------

create table public.briefings (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  role text not null check (role in (
    'owner', 'principal', 'admin', 'admissions', 'accountant', 'exam_controller', 'teacher'
  )),
  brief_date date not null,
  headline text not null check (length(headline) between 1 and 200),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 10),
  sources jsonb not null check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 20),
  provider text check (provider in ('local', 'cloud')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, role, brief_date)
);

create trigger set_updated_at
before update on public.briefings
for each row execute function app.set_updated_at();

alter table public.briefings enable row level security;

-- owner/principal/admin see every role's briefing; every other staff role
-- sees only rows for its own role (one literal-array branch per role, not
-- a per-row helper argument — M19-tasks.md ruling).
create policy briefings_select on public.briefings
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or (role = 'admissions' and institution_id = any((select app.my_institution_ids(array['admissions']))))
    or (role = 'accountant' and institution_id = any((select app.my_institution_ids(array['accountant']))))
    or (role = 'exam_controller' and institution_id = any((select app.my_institution_ids(array['exam_controller']))))
    or (role = 'teacher' and institution_id = any((select app.my_institution_ids(array['teacher']))))
  );

-- ---------------------------------------------------------------------------
-- record_insights — the detector pipeline's only writer (service_role only).
-- Invoker, not definer: service_role already bypasses RLS as table owner,
-- so there is no privilege to escalate (unlike the T3 definers, which run
-- as authenticated and need SECURITY DEFINER to reach these tables at all).
-- ---------------------------------------------------------------------------

create function public.record_insights(p_institution_id uuid, p_rows jsonb)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count int;
begin
  insert into public.insights (
    institution_id, signal, detector_version, dedupe_key, domain, kind, severity,
    title, pattern, evidence, sources, date_from, date_to, confidence, factors,
    reviewer_role, recommended_actions, approval_required,
    entity_type, entity_id, entity_label, class_section_id, status
  )
  select
    p_institution_id, t.signal, t.detector_version, t.dedupe_key, t.domain, t.kind, t.severity,
    t.title, t.pattern, t.evidence, coalesce(t.sources, '{}'), t.date_from, t.date_to, t.confidence,
    coalesce(t.factors, '[]'::jsonb),
    t.reviewer_role, coalesce(t.recommended_actions, '{}'), t.approval_required,
    t.entity_type, t.entity_id, t.entity_label, t.class_section_id, 'new'
  from jsonb_to_recordset(p_rows) as t (
    signal text, detector_version int, dedupe_key text, domain text, kind text, severity text,
    title text, pattern text, evidence jsonb, sources text[], date_from date, date_to date,
    confidence numeric, factors jsonb, reviewer_role text, recommended_actions text[],
    approval_required boolean, entity_type text, entity_id uuid, entity_label text, class_section_id uuid
  )
  where t.class_section_id is null or exists (
    select 1 from public.class_sections cs
    where cs.id = t.class_section_id and cs.institution_id = p_institution_id
  )
  on conflict do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.record_insights(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_insights(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- M19-T3 — part 2: review/visibility helpers + the three authenticated
-- definers (decide_insight, record_insight_action, set_insight_explanation).
-- The app.* helpers are internal only (lesson 7: never used in a policy,
-- so no RLS-perf initPlan concern) — revoked from public/anon/authenticated;
-- a security-definer function always runs as its owner (postgres), so the
-- revoke never blocks the calls below.
-- ---------------------------------------------------------------------------

-- Review rights: owner/principal/admin review any domain; admissions/
-- accountant/exam_controller review only their matching domain.
create function app.can_review_insight(p_institution_id uuid, p_domain text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if app.has_role(p_institution_id, array['owner', 'principal', 'admin']) then
    return true;
  end if;
  return case p_domain
    when 'admissions' then app.has_role(p_institution_id, array['admissions'])
    when 'finance' then app.has_role(p_institution_id, array['accountant'])
    when 'academics' then app.has_role(p_institution_id, array['exam_controller'])
    else false
  end;
end;
$$;

revoke execute on function app.can_review_insight(uuid, text) from public, anon, authenticated;

-- Same rule, for a reviewer_id named by the caller (not the caller itself).
create function app.user_can_review_insight(p_user_id uuid, p_institution_id uuid, p_domain text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.memberships m
    where m.user_id = p_user_id and m.institution_id = p_institution_id
      and m.status = 'active' and m.role = any(array['owner', 'principal', 'admin'])
  ) then
    return true;
  end if;
  return exists (
    select 1 from public.memberships m
    where m.user_id = p_user_id and m.institution_id = p_institution_id
      and m.status = 'active'
      and m.role = (case p_domain
        when 'admissions' then 'admissions'
        when 'finance' then 'accountant'
        when 'academics' then 'exam_controller'
      end)
  );
end;
$$;

revoke execute on function app.user_can_review_insight(uuid, uuid, text) from public, anon, authenticated;

-- Visibility = review rights OR the teacher branch of insights_select
-- (attendance/academics, caller teaches the row's class_section_id).
create function app.insight_visible(p_institution_id uuid, p_domain text, p_class_section_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if app.can_review_insight(p_institution_id, p_domain) then
    return true;
  end if;
  return p_domain in ('attendance', 'academics')
    and p_class_section_id is not null
    and p_class_section_id = any((select app.my_taught_section_ids()));
end;
$$;

revoke execute on function app.insight_visible(uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- public.decide_insight — the only writer of `status` besides
-- record_insight_action. review: new|reviewing -> reviewing (reassigning
-- while reviewing needs owner/principal/admin). resolve: new|reviewing|
-- actioned -> resolved. dismiss: new|reviewing -> dismissed. An
-- approval_required row's resolve/dismiss is owner/principal only.
-- Audits insight.reviewing|resolved|dismissed with {status} before/after
-- only (lesson 10: never the note).
-- ---------------------------------------------------------------------------

create function public.decide_insight(
  p_insight_id uuid,
  p_action text,
  p_note text default null,
  p_reviewer_id uuid default null
)
returns public.insights
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_row public.insights;
  v_old_status text;
  v_new_status text;
  v_target_reviewer uuid;
  v_audit_action text;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_row from public.insights where id = p_insight_id for update;
  if v_row.id is null or not app.insight_visible(v_row.institution_id, v_row.domain, v_row.class_section_id) then
    raise exception 'code:not_found' using detail = 'insight not found';
  end if;

  if not app.can_review_insight(v_row.institution_id, v_row.domain) then
    raise exception 'code:forbidden' using detail = 'caller does not hold review rights for this insight''s domain';
  end if;

  if p_action not in ('review', 'resolve', 'dismiss') then
    raise exception 'code:validation_failed' using detail = 'action must be review, resolve or dismiss';
  end if;

  v_old_status := v_row.status;

  if p_action = 'review' then
    if v_old_status not in ('new', 'reviewing') then
      raise exception 'code:invalid_state' using detail = format('insight must be new or reviewing to review; current status is %s', v_old_status);
    end if;
    if v_old_status = 'reviewing' and not app.has_role(v_row.institution_id, array['owner', 'principal', 'admin']) then
      raise exception 'code:forbidden' using detail = 'only owner/principal/admin may reassign a reviewing insight';
    end if;

    v_target_reviewer := coalesce(p_reviewer_id, v_caller);
    if not app.user_can_review_insight(v_target_reviewer, v_row.institution_id, v_row.domain) then
      raise exception 'code:validation_failed' using detail = 'reviewer does not hold review rights for this domain';
    end if;

    update public.insights set status = 'reviewing', reviewer_id = v_target_reviewer
    where id = p_insight_id
    returning * into v_row;
    v_audit_action := 'insight.reviewing';
  else
    if v_row.approval_required and not app.has_role(v_row.institution_id, array['owner', 'principal']) then
      raise exception 'code:forbidden' using detail = 'only owner/principal may decide an approval-required insight';
    end if;

    if p_action = 'resolve' then
      if v_old_status not in ('new', 'reviewing', 'actioned') then
        raise exception 'code:invalid_state' using detail = format('insight status %s cannot be resolved', v_old_status);
      end if;
      v_new_status := 'resolved';
    else
      if v_old_status not in ('new', 'reviewing') then
        raise exception 'code:invalid_state' using detail = format('insight status %s cannot be dismissed', v_old_status);
      end if;
      v_new_status := 'dismissed';
    end if;

    if p_note is null or length(p_note) not between 5 and 500 then
      raise exception 'code:validation_failed' using detail = 'note must be 5-500 characters';
    end if;

    update public.insights
    set status = v_new_status, decided_by = v_caller, decided_at = now(), decision_note = p_note
    where id = p_insight_id
    returning * into v_row;
    v_audit_action := 'insight.' || v_new_status;
  end if;

  perform app.audit(
    v_row.institution_id, v_caller, v_audit_action, 'insight', v_row.id,
    jsonb_build_object('status', v_old_status), jsonb_build_object('status', v_row.status), null
  );

  return v_row;
end;
$$;

revoke execute on function public.decide_insight(uuid, text, text, uuid) from public, anon;
grant execute on function public.decide_insight(uuid, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.record_insight_action — append-only action log. The first action
-- on a new|reviewing insight moves it to actioned. A correction supersedes
-- the current (un-superseded) row of the same insight, status moving only
-- planned -> done -> measured (or staying put), never back. One exception
-- to the insight-status gate: a superseding measured action is allowed on
-- a resolved insight (outcome measurement after the fact).
-- ---------------------------------------------------------------------------

create function public.record_insight_action(
  p_insight_id uuid,
  p_action text,
  p_owner text,
  p_rationale text,
  p_expected_outcome text,
  p_status text default 'planned',
  p_actual_outcome text default null,
  p_supersedes_id uuid default null
)
returns public.insight_actions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_insight public.insights;
  v_supersedes public.insight_actions;
  v_row public.insight_actions;
  v_rank_old int;
  v_rank_new int;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_insight from public.insights where id = p_insight_id for update;
  if v_insight.id is null or not app.insight_visible(v_insight.institution_id, v_insight.domain, v_insight.class_section_id) then
    raise exception 'code:not_found' using detail = 'insight not found';
  end if;

  if not app.can_review_insight(v_insight.institution_id, v_insight.domain) then
    raise exception 'code:forbidden' using detail = 'caller does not hold review rights for this insight''s domain';
  end if;

  if v_insight.status not in ('new', 'reviewing', 'actioned')
     and not (v_insight.status = 'resolved' and p_status = 'measured' and p_supersedes_id is not null)
  then
    raise exception 'code:invalid_state' using detail = format('insight status %s does not accept an action', v_insight.status);
  end if;

  if p_status not in ('planned', 'done', 'measured') then
    raise exception 'code:validation_failed' using detail = 'status must be planned, done or measured';
  end if;

  if p_supersedes_id is not null then
    select * into v_supersedes from public.insight_actions
    where id = p_supersedes_id and insight_id = p_insight_id;
    if v_supersedes.id is null or exists (
      select 1 from public.insight_actions where supersedes_id = v_supersedes.id
    ) then
      raise exception 'code:invalid_state' using detail = 'supersedes_id must be the current action of this insight';
    end if;

    v_rank_old := case v_supersedes.status when 'planned' then 0 when 'done' then 1 else 2 end;
    v_rank_new := case p_status when 'planned' then 0 when 'done' then 1 else 2 end;
    if v_rank_new < v_rank_old then
      raise exception 'code:invalid_state' using detail = 'action status cannot move backward';
    end if;
  end if;

  if length(p_action) not between 1 and 200
     or length(p_owner) not between 1 and 80
     or length(p_rationale) not between 1 and 500
     or length(p_expected_outcome) not between 1 and 300
     or (p_actual_outcome is not null and length(p_actual_outcome) > 500)
  then
    raise exception 'code:validation_failed' using detail = 'text field out of range';
  end if;

  if p_status = 'measured' and p_actual_outcome is null then
    raise exception 'code:validation_failed' using detail = 'measured status requires actual_outcome';
  end if;

  insert into public.insight_actions (
    institution_id, insight_id, supersedes_id, action, owner, rationale, expected_outcome,
    actual_outcome, status, measured_at, created_by
  ) values (
    v_insight.institution_id, p_insight_id, p_supersedes_id, p_action, p_owner, p_rationale, p_expected_outcome,
    p_actual_outcome, p_status, case when p_status = 'measured' then now() else null end, v_caller
  )
  returning * into v_row;

  if v_insight.status in ('new', 'reviewing') then
    update public.insights set status = 'actioned' where id = p_insight_id;
  end if;

  perform app.audit(
    v_insight.institution_id, v_caller, 'insight.action_recorded', 'insight', p_insight_id,
    null, null, jsonb_build_object('action_id', v_row.id)
  );

  return v_row;
end;
$$;

revoke execute on function public.record_insight_action(uuid, text, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.record_insight_action(uuid, text, text, text, text, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.set_insight_explanation — the AI boundary's only writer (D43,
-- rule 6): the LLM proposes { what, why, next_steps }, a human-invoked RPC
-- saves it. Writes only the five explanation columns, never status.
-- Visibility gates it (insight.read), not review rights: any role that can
-- see the row may attach an explanation to it (debt noted in the ruling).
-- ---------------------------------------------------------------------------

create function public.set_insight_explanation(
  p_insight_id uuid,
  p_explanation jsonb,
  p_provider text,
  p_model text
)
returns public.insights
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_row public.insights;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_row from public.insights where id = p_insight_id for update;
  if v_row.id is null or not app.insight_visible(v_row.institution_id, v_row.domain, v_row.class_section_id) then
    raise exception 'code:not_found' using detail = 'insight not found';
  end if;

  if v_row.status not in ('new', 'reviewing', 'actioned') then
    raise exception 'code:invalid_state' using detail = format('insight status %s cannot be explained', v_row.status);
  end if;

  if jsonb_typeof(p_explanation) is distinct from 'object'
     or jsonb_typeof(p_explanation -> 'what') is distinct from 'string'
     or length(p_explanation ->> 'what') not between 1 and 500
     or jsonb_typeof(p_explanation -> 'why') is distinct from 'string'
     or length(p_explanation ->> 'why') not between 1 and 500
     or jsonb_typeof(p_explanation -> 'next_steps') is distinct from 'array'
     or jsonb_array_length(p_explanation -> 'next_steps') not between 1 and 3
     or exists (
       select 1 from jsonb_array_elements(p_explanation -> 'next_steps') as step
       where jsonb_typeof(step) is distinct from 'string' or length(step #>> '{}') not between 1 and 200
     )
  then
    raise exception 'code:validation_failed' using detail = 'explanation must be { what<=500, why<=500, next_steps: 1-3 strings <=200 }';
  end if;

  if p_provider not in ('local', 'cloud') then
    raise exception 'code:validation_failed' using detail = 'provider must be local or cloud';
  end if;

  if length(p_model) not between 1 and 100 then
    raise exception 'code:validation_failed' using detail = 'model must be 1-100 characters';
  end if;

  update public.insights
  set explanation = p_explanation, explained_at = now(), explained_by = v_caller,
      explanation_provider = p_provider, explanation_model = p_model
  where id = p_insight_id
  returning * into v_row;

  perform app.audit(
    v_row.institution_id, v_caller, 'insight.explained', 'insight', v_row.id,
    null, null, jsonb_build_object('provider', p_provider)
  );

  return v_row;
end;
$$;

revoke execute on function public.set_insight_explanation(uuid, jsonb, text, text) from public, anon;
grant execute on function public.set_insight_explanation(uuid, jsonb, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- M19-T4: migration 0092 part 3 — sources attendance, marks, submissions.
-- plpgsql stable security invoker, service_role only: invoker is safe
-- because service_role already bypasses RLS as table owner (same reasoning
-- as record_insights, part 1) — there is no privilege to escalate. The
-- institution filter in each body is the only filter (rulings "Sources");
-- detectors (T8/T9) own every threshold.
-- ---------------------------------------------------------------------------

-- insight_src_attendance — daily sessions only (period_id is null, rulings
-- "attendance"). R = [as_of-6, as_of], B = [as_of-34, as_of-7]. Weights
-- mirror app.term_attendance_percentage (0009): counts_present is summed,
-- and counted in the denominator, only where in_denominator.
create function public.insight_src_attendance(p_institution_id uuid, p_as_of date, p_student_max_recent_pct numeric)
returns table (
  level text,
  class_section_id uuid,
  section_label text,
  student_id uuid,
  recent_days int,
  base_days int,
  recent_present numeric,
  recent_denominator numeric,
  base_present numeric,
  base_denominator numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  return query
  with weighted as (
    select
      ar.student_id,
      s.class_section_id,
      s.date,
      coalesce((codes.w ->> 'counts_present')::numeric, 0) as present_w,
      coalesce((codes.w ->> 'in_denominator')::boolean, false) as in_denom
    from public.attendance_sessions s
    join public.attendance_records ar on ar.session_id = s.id and ar.institution_id = p_institution_id
    join public.institutions i on i.id = p_institution_id
    left join lateral (
      select elem as w from jsonb_array_elements(coalesce(i.settings -> 'attendance' -> 'statuses', '[]'::jsonb)) elem
      where elem ->> 'code' = ar.status
      limit 1
    ) codes on true
    where s.institution_id = p_institution_id
      and s.period_id is null
      and s.date between p_as_of - 34 and p_as_of
  ),
  section_agg as (
    select
      w.class_section_id,
      count(distinct w.date) filter (where w.date between p_as_of - 6 and p_as_of) as recent_days,
      count(distinct w.date) filter (where w.date between p_as_of - 34 and p_as_of - 7) as base_days,
      sum(case when w.in_denom and w.date between p_as_of - 6 and p_as_of then w.present_w else 0 end) as recent_present,
      sum(case when w.in_denom and w.date between p_as_of - 6 and p_as_of then 1 else 0 end)::numeric as recent_denominator,
      sum(case when w.in_denom and w.date between p_as_of - 34 and p_as_of - 7 then w.present_w else 0 end) as base_present,
      sum(case when w.in_denom and w.date between p_as_of - 34 and p_as_of - 7 then 1 else 0 end)::numeric as base_denominator
    from weighted w
    group by w.class_section_id
  ),
  student_agg as (
    select
      w.student_id,
      count(distinct w.date) filter (where w.date between p_as_of - 6 and p_as_of) as recent_days,
      count(distinct w.date) filter (where w.date between p_as_of - 34 and p_as_of - 7) as base_days,
      sum(case when w.in_denom and w.date between p_as_of - 6 and p_as_of then w.present_w else 0 end) as recent_present,
      sum(case when w.in_denom and w.date between p_as_of - 6 and p_as_of then 1 else 0 end)::numeric as recent_denominator,
      sum(case when w.in_denom and w.date between p_as_of - 34 and p_as_of - 7 then w.present_w else 0 end) as base_present,
      sum(case when w.in_denom and w.date between p_as_of - 34 and p_as_of - 7 then 1 else 0 end)::numeric as base_denominator
    from weighted w
    group by w.student_id
  )
  select
    'section', sa.class_section_id, g.code || '-' || cs.name, null::uuid,
    sa.recent_days::int, sa.base_days::int, sa.recent_present, sa.recent_denominator, sa.base_present, sa.base_denominator
  from section_agg sa
  join public.class_sections cs on cs.id = sa.class_section_id and cs.institution_id = p_institution_id
  join public.grades g on g.id = cs.grade_id
  union all
  select
    'student', e.class_section_id, g.code || '-' || cs.name, st.student_id,
    st.recent_days::int, st.base_days::int, st.recent_present, st.recent_denominator, st.base_present, st.base_denominator
  from student_agg st
  join public.enrolments e on e.student_id = st.student_id and e.institution_id = p_institution_id and e.status = 'active'
  join public.class_sections cs on cs.id = e.class_section_id and cs.institution_id = p_institution_id
  join public.grades g on g.id = cs.grade_id
  where st.recent_denominator >= 3
    and 100 * st.recent_present / st.recent_denominator <= p_student_max_recent_pct;
end;
$$;

revoke execute on function public.insight_src_attendance(uuid, date, numeric) from public, anon, authenticated;
grant execute on function public.insight_src_attendance(uuid, date, numeric) to service_role;

-- insight_src_marks — current marks (superseded_by is null, not is_absent)
-- on papers of published exams whose local published_at falls in the
-- trailing year; the two latest exams per (student, subject), tie broken
-- by exam id (rulings "marks").
create function public.insight_src_marks(p_institution_id uuid, p_as_of date, p_min_drop_pts numeric)
returns table (
  student_id uuid,
  class_section_id uuid,
  section_label text,
  subject_id uuid,
  subject_name text,
  prev_exam_id uuid,
  prev_pct numeric,
  last_exam_id uuid,
  last_pct numeric,
  last_published_on date
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  return query
  with inst as (
    select coalesce(settings -> 'locale' ->> 'timezone', 'Asia/Kolkata') as tz
    from public.institutions where id = p_institution_id
  ),
  base as (
    select
      m.student_id,
      ep.subject_id,
      sub.name as subject_name,
      ep.exam_id,
      ep.class_section_id,
      round(100 * m.marks_obtained / ep.max_marks, 2) as pct,
      (e.published_at at time zone inst.tz)::date as published_on
    from public.marks m
    join public.exam_papers ep on ep.id = m.exam_paper_id and ep.institution_id = p_institution_id
    join public.exams e on e.id = ep.exam_id and e.institution_id = p_institution_id
    join public.subjects sub on sub.id = ep.subject_id and sub.institution_id = p_institution_id
    cross join inst
    where m.institution_id = p_institution_id
      and m.superseded_by is null
      and not m.is_absent
      and e.status = 'published'
      and (e.published_at at time zone inst.tz)::date between p_as_of - 365 and p_as_of
  ),
  ranked as (
    select b.*, row_number() over (partition by b.student_id, b.subject_id order by b.published_on desc, b.exam_id desc) as rn
    from base b
  ),
  pivoted as (
    -- Bare student_id/subject_id/subject_name/class_section_id would be
    -- ambiguous: RETURNS TABLE promotes those names to plpgsql variables
    -- visible in this body, so every reference here is ranked-qualified.
    -- uuid has no max()/min() aggregate, hence array_agg(...)[1] for the
    -- id columns (exam_id, class_section_id) instead of max(case when...).
    select
      ranked.student_id, ranked.subject_id, ranked.subject_name,
      (array_agg(exam_id) filter (where rn = 1))[1] as last_exam_id,
      max(pct) filter (where rn = 1) as last_pct,
      (array_agg(ranked.class_section_id) filter (where rn = 1))[1] as class_section_id,
      max(published_on) filter (where rn = 1) as last_published_on,
      (array_agg(exam_id) filter (where rn = 2))[1] as prev_exam_id,
      max(pct) filter (where rn = 2) as prev_pct
    from ranked
    where rn <= 2
    group by ranked.student_id, ranked.subject_id, ranked.subject_name
  )
  select
    p.student_id, p.class_section_id, g.code || '-' || cs.name, p.subject_id, p.subject_name,
    p.prev_exam_id, p.prev_pct, p.last_exam_id, p.last_pct, p.last_published_on
  from pivoted p
  join public.class_sections cs on cs.id = p.class_section_id and cs.institution_id = p_institution_id
  join public.grades g on g.id = cs.grade_id
  where p.prev_exam_id is not null
    and p.last_published_on >= p_as_of - 30
    and p.prev_pct - p.last_pct >= p_min_drop_pts;
end;
$$;

revoke execute on function public.insight_src_marks(uuid, date, numeric) from public, anon, authenticated;
grant execute on function public.insight_src_marks(uuid, date, numeric) to service_role;

-- insight_src_submissions — student level: missing assignments (no
-- assignment_submissions row) due in the trailing 28 days, crossed with
-- active enrolment in the assignment's section; section level: submitted
-- (not graded) rows stale 7+ days (rulings "submissions").
create function public.insight_src_submissions(p_institution_id uuid, p_as_of date)
returns table (
  level text,
  class_section_id uuid,
  section_label text,
  student_id uuid,
  due_count int,
  missing_count int,
  awaiting_count int,
  oldest_awaiting_days int
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  return query
  with inst as (
    select coalesce(settings -> 'locale' ->> 'timezone', 'Asia/Kolkata') as tz
    from public.institutions where id = p_institution_id
  ),
  due_assignments as (
    select a.id, a.class_section_id
    from public.assignments a
    cross join inst
    where a.institution_id = p_institution_id
      and a.status in ('published', 'closed')
      and (a.due_at at time zone inst.tz)::date between p_as_of - 27 and p_as_of
  ),
  roster as (
    select da.id as assignment_id, da.class_section_id, e.student_id
    from due_assignments da
    join public.enrolments e on e.class_section_id = da.class_section_id and e.institution_id = p_institution_id and e.status = 'active'
  ),
  student_counts as (
    select
      r.student_id,
      -- max(uuid) has no aggregate operator; every row for one student
      -- shares a class_section_id (the assignment's own), so any one does.
      (array_agg(r.class_section_id))[1] as class_section_id,
      count(*) as due_count,
      count(*) filter (where asub.id is null) as missing_count
    from roster r
    left join public.assignment_submissions asub
      on asub.assignment_id = r.assignment_id and asub.student_id = r.student_id and asub.institution_id = p_institution_id
    group by r.student_id
  ),
  late_submissions as (
    select asub.id, a.class_section_id, (asub.submitted_at at time zone inst.tz)::date as submitted_date
    from public.assignment_submissions asub
    join public.assignments a on a.id = asub.assignment_id and a.institution_id = p_institution_id
    cross join inst
    where asub.institution_id = p_institution_id
      and asub.status = 'submitted'
      and (asub.submitted_at at time zone inst.tz)::date <= p_as_of - 7
  ),
  section_counts as (
    select late_submissions.class_section_id, count(*) as awaiting_count, min(submitted_date) as oldest_date
    from late_submissions
    group by late_submissions.class_section_id
  )
  select
    'student', sc.class_section_id, g.code || '-' || cs.name, sc.student_id,
    sc.due_count::int, sc.missing_count::int, null::int, null::int
  from student_counts sc
  join public.class_sections cs on cs.id = sc.class_section_id and cs.institution_id = p_institution_id
  join public.grades g on g.id = cs.grade_id
  where sc.missing_count >= 3
  union all
  select
    'section', sco.class_section_id, g.code || '-' || cs.name, null::uuid,
    null::int, null::int, sco.awaiting_count::int, (p_as_of - sco.oldest_date)::int
  from section_counts sco
  join public.class_sections cs on cs.id = sco.class_section_id and cs.institution_id = p_institution_id
  join public.grades g on g.id = cs.grade_id
  where sco.awaiting_count >= 5;
end;
$$;

revoke execute on function public.insight_src_submissions(uuid, date) from public, anon, authenticated;
grant execute on function public.insight_src_submissions(uuid, date) to service_role;
