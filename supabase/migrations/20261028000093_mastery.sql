-- M20-T4: migration 0093 part 1 — exam_papers.unit_ids, mastery_snapshots,
-- RLS (M20-tasks.md header rulings "Paper → unit mapping", "Table", "RLS").
-- Written across T4 → T5 → T6; each later task appends one part to this
-- same file.
--
-- mastery_snapshots is a derived cache (rulings "Table"), not rule-5
-- history: public.compute_mastery (T5) upserts and deletes stale rows.
-- It has no INSERT/UPDATE/DELETE policy — only that service-role function
-- writes it (BRIEF-COMMON lesson 3) — table grants narrowed the same way
-- as 0095's agent_definitions/agent_runs (0045 already grants ALL to
-- anon/authenticated/service_role by default; service_role keeps the
-- undeclared extra privileges from that default).

-- ---------------------------------------------------------------------------
-- exam_papers.unit_ids (rulings "Paper → unit mapping")
-- ---------------------------------------------------------------------------

alter table public.exam_papers
  add column unit_ids uuid[] not null default '{}';

alter table public.exam_papers
  add constraint exam_papers_unit_ids_max check (cardinality(unit_ids) <= 20);

-- Security invoker: the caller already has exam.manage (exam_write_roles)
-- to reach this trigger via exam_papers_insert/update, and curriculum_units
-- grants SELECT to app.staff_roles() (0005) — wider than exam_write_roles —
-- so no definer bypass is needed to read the units being validated.
create function app.validate_exam_paper_units()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_grade_id uuid;
  v_distinct_count int;
  v_matched_count int;
begin
  select count(distinct u) into v_distinct_count from unnest(new.unit_ids) u;
  if v_distinct_count <> cardinality(new.unit_ids) then
    raise exception 'code:validation_failed' using detail = 'unit_ids must not contain duplicates';
  end if;

  select cs.grade_id into v_grade_id
  from public.class_sections cs
  where cs.id = new.class_section_id
    and cs.institution_id = new.institution_id;

  select count(*) into v_matched_count
  from public.curriculum_units cu
  where cu.id = any(new.unit_ids)
    and cu.institution_id = new.institution_id
    and cu.subject_id = new.subject_id
    and cu.grade_id = v_grade_id;

  if v_matched_count <> cardinality(new.unit_ids) then
    raise exception 'code:validation_failed'
      using detail = 'unit_ids must reference curriculum units of the paper''s own institution, subject and grade';
  end if;

  return new;
end;
$$;

create trigger validate_exam_paper_units
before insert or update of unit_ids, subject_id, class_section_id on public.exam_papers
for each row
when (cardinality(new.unit_ids) > 0)
execute function app.validate_exam_paper_units();

-- ---------------------------------------------------------------------------
-- mastery_snapshots (rulings "Table", "RLS")
-- ---------------------------------------------------------------------------

create table public.mastery_snapshots (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  academic_year_id uuid not null references public.academic_years (id),
  student_id uuid not null references public.students (id),
  class_section_id uuid not null references public.class_sections (id),
  subject_id uuid not null references public.subjects (id),
  curriculum_unit_id uuid not null references public.curriculum_units (id),
  score numeric(4, 3) not null check (score >= 0 and score <= 1),
  confidence numeric(3, 2) not null check (confidence >= 0 and confidence <= 1),
  mark_count int not null default 0 check (mark_count >= 0),
  submission_count int not null default 0 check (submission_count >= 0),
  evidence jsonb not null,
  detector_version text not null,
  computed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (mark_count + submission_count >= 1),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) between 1 and 50),
  constraint mastery_snapshots_year_student_unit_key unique (academic_year_id, student_id, curriculum_unit_id)
);

create index mastery_snapshots_class_section_subject_idx on public.mastery_snapshots (class_section_id, subject_id);
create index mastery_snapshots_student_idx on public.mastery_snapshots (student_id);

create trigger set_updated_at
before update on public.mastery_snapshots
for each row execute function app.set_updated_at();

alter table public.mastery_snapshots enable row level security;

-- mastery.read (07 §2.2); mirrors results_select (0020); lesson 7 —
-- initPlan helpers only, no per-row security definer calls.
create policy mastery_snapshots_select on public.mastery_snapshots
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'exam_controller'])))
    or class_section_id = any((select app.my_taught_section_ids()))
    or class_section_id = any((select app.my_class_teacher_section_ids()))
    or student_id = any((select app.my_student_ids()))
  );

revoke all on public.mastery_snapshots from anon, authenticated;
grant select on public.mastery_snapshots to authenticated;

-- ---------------------------------------------------------------------------
-- M20-T5: migration 0093 part 2 — compute_mastery, enqueue_mastery_compute
-- sweep, mastery_heatmap/mastery_student_stats read functions (rulings
-- "Algorithm", "SQL read functions", "Scheduling").
-- ---------------------------------------------------------------------------

-- public.compute_mastery — security invoker (lesson: only service_role ever
-- calls this, via the job handler's admin client; invoker is enough, no
-- definer escalation needed, and keeps this out of 07 §4). Observations:
-- *mark* (current marks of published exams whose paper maps unit_ids,
-- weight 2) and *submission* (graded assignment_submissions whose
-- assignment has a curriculum_unit_id, weight 1); subject is always the
-- unit's own subject_id (never the paper's/assignment's), per rulings.
-- Full-institution recompute per call: upserts every (student, unit) with
-- at least one observation, then deletes rows this run did not touch
-- (unit unmapped, mark now absent/superseded, student withdrawn).
create function public.compute_mastery(p_institution_id uuid)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_year_id uuid;
  v_run_at timestamptz := now();
  v_count int;
begin
  select id into v_year_id
  from public.academic_years
  where institution_id = p_institution_id and is_current;

  if v_year_id is null then
    return 0;
  end if;

  with observations as (
    select
      m.student_id,
      cu.id as curriculum_unit_id,
      cu.subject_id,
      least(1, greatest(0, m.marks_obtained / ep.max_marks)) as s,
      2 as w,
      'mark'::text as src,
      m.id as src_id,
      coalesce(ep.held_on, ex.published_at::date) as on_date
    from public.marks m
    join public.exam_papers ep on ep.id = m.exam_paper_id and ep.institution_id = p_institution_id
    join public.exams ex on ex.id = ep.exam_id and ex.institution_id = p_institution_id
    join lateral unnest(ep.unit_ids) as unit_id(id) on true
    join public.curriculum_units cu on cu.id = unit_id.id and cu.institution_id = p_institution_id
    where m.institution_id = p_institution_id
      and m.superseded_by is null
      and not m.is_absent
      and m.marks_obtained is not null
      and cardinality(ep.unit_ids) > 0
      and ex.status = 'published'
      and ex.academic_year_id = v_year_id

    union all

    select
      asu.student_id,
      cu.id as curriculum_unit_id,
      cu.subject_id,
      least(1, greatest(0, asu.score / asu.max_score)) as s,
      1 as w,
      'submission'::text as src,
      asu.id as src_id,
      asu.graded_at::date as on_date
    from public.assignment_submissions asu
    join public.assignments a on a.id = asu.assignment_id and a.institution_id = p_institution_id
    join public.curriculum_units cu on cu.id = a.curriculum_unit_id and cu.institution_id = p_institution_id
    join public.class_sections cs on cs.id = a.class_section_id and cs.institution_id = p_institution_id
    where asu.institution_id = p_institution_id
      and asu.status = 'graded'
      and a.curriculum_unit_id is not null
      and cs.academic_year_id = v_year_id
  ),
  scoped as (
    select o.*, e.class_section_id
    from observations o
    join public.enrolments e
      on e.student_id = o.student_id
      and e.academic_year_id = v_year_id
      and e.status = 'active'
      and e.institution_id = p_institution_id
  ),
  ranked_evidence as (
    select
      scoped.*,
      row_number() over (
        partition by student_id, curriculum_unit_id
        order by on_date desc, src_id
      ) as rn
    from scoped
  ),
  aggregated as (
    select
      student_id,
      curriculum_unit_id,
      subject_id,
      class_section_id,
      round(sum(w * s) / sum(w), 3) as score,
      round(least(1, sum(w) / 4.0), 2) as confidence,
      count(*) filter (where src = 'mark') as mark_count,
      count(*) filter (where src = 'submission') as submission_count
    from scoped
    -- subject_id/class_section_id are functionally determined by
    -- (student_id, curriculum_unit_id) — same unit always has the same
    -- subject, same student always has at most one active enrolment per
    -- year — so grouping by all four is equivalent to grouping by the
    -- first two; done this way because uuid has no built-in max()/min().
    group by student_id, curriculum_unit_id, subject_id, class_section_id
  ),
  evidence_agg as (
    select
      student_id,
      curriculum_unit_id,
      jsonb_agg(
        jsonb_build_object('src', src, 'id', src_id, 'score', round(s, 3), 'w', w, 'on', on_date)
        order by on_date desc, src_id
      ) as evidence
    from ranked_evidence
    where rn <= 50
    group by student_id, curriculum_unit_id
  ),
  upserted as (
    insert into public.mastery_snapshots (
      institution_id, academic_year_id, student_id, class_section_id, subject_id, curriculum_unit_id,
      score, confidence, mark_count, submission_count, evidence, detector_version, computed_at
    )
    select
      p_institution_id, v_year_id, agg.student_id, agg.class_section_id, agg.subject_id, agg.curriculum_unit_id,
      agg.score, agg.confidence, agg.mark_count, agg.submission_count, ev.evidence, 'mastery_v1', v_run_at
    from aggregated agg
    join evidence_agg ev using (student_id, curriculum_unit_id)
    on conflict (academic_year_id, student_id, curriculum_unit_id) do update set
      institution_id = excluded.institution_id,
      class_section_id = excluded.class_section_id,
      subject_id = excluded.subject_id,
      score = excluded.score,
      confidence = excluded.confidence,
      mark_count = excluded.mark_count,
      submission_count = excluded.submission_count,
      evidence = excluded.evidence,
      detector_version = excluded.detector_version,
      computed_at = excluded.computed_at
    returning 1
  )
  select count(*) into v_count from upserted;

  delete from public.mastery_snapshots
  where institution_id = p_institution_id
    and academic_year_id = v_year_id
    and computed_at < v_run_at;

  return v_count;
end;
$$;

revoke execute on function public.compute_mastery(uuid) from public, anon, authenticated;
grant execute on function public.compute_mastery(uuid) to service_role;

-- public.enqueue_mastery_compute — definer (reads across all institutions,
-- mirrors 0094 enqueue_due_forecasts/M15 enqueue_due_reports shape). One
-- mastery.compute job per institution per institution-local day.
create function public.enqueue_mastery_compute()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_institution record;
  v_count int := 0;
begin
  for v_institution in
    select i.id, coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata') as tz
    from public.institutions i
    where app.module_enabled(i.id, 'mastery')
  loop
    perform app.enqueue_job(
      v_institution.id,
      'mastery.compute',
      '{}'::jsonb,
      'mastery.compute:' || v_institution.id || ':' || to_char((now() at time zone v_institution.tz)::date, 'YYYYMMDD')
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.enqueue_mastery_compute() from public, anon, authenticated;
grant execute on function public.enqueue_mastery_compute() to service_role;

-- public.mastery_heatmap / public.mastery_student_stats — security invoker
-- read functions; the caller's mastery_snapshots RLS applies, so these need
-- no 07 §4 row (rulings "SQL read functions"). Thresholds are always
-- caller-supplied (src/modules/mastery/rules.ts owns the numbers).
create function public.mastery_heatmap(
  p_academic_year_id uuid,
  p_class_section_id uuid,
  p_subject_id uuid,
  p_gap_threshold numeric,
  p_min_confidence numeric
)
returns table (
  class_section_id uuid,
  subject_id uuid,
  curriculum_unit_id uuid,
  mean_score numeric,
  students int,
  below int
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    ms.class_section_id,
    ms.subject_id,
    ms.curriculum_unit_id,
    round(avg(ms.score), 3) as mean_score,
    count(*)::int as students,
    count(*) filter (where ms.confidence >= p_min_confidence and ms.score < p_gap_threshold)::int as below
  from public.mastery_snapshots ms
  where ms.academic_year_id = p_academic_year_id
    and (p_class_section_id is null or ms.class_section_id = p_class_section_id)
    and (p_subject_id is null or ms.subject_id = p_subject_id)
  group by ms.class_section_id, ms.subject_id, ms.curriculum_unit_id
  order by ms.class_section_id, ms.subject_id, ms.curriculum_unit_id;
$$;

revoke execute on function public.mastery_heatmap(uuid, uuid, uuid, numeric, numeric) from public, anon;
grant execute on function public.mastery_heatmap(uuid, uuid, uuid, numeric, numeric) to authenticated, service_role;

create function public.mastery_student_stats(
  p_academic_year_id uuid,
  p_class_section_id uuid,
  p_gap_threshold numeric,
  p_min_confidence numeric
)
returns table (
  student_id uuid,
  class_section_id uuid,
  gap_units int,
  confident_units int,
  mean_score numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    ms.student_id,
    ms.class_section_id,
    count(*) filter (where ms.confidence >= p_min_confidence and ms.score < p_gap_threshold)::int as gap_units,
    count(*) filter (where ms.confidence >= p_min_confidence)::int as confident_units,
    round(avg(ms.score) filter (where ms.confidence >= p_min_confidence), 3) as mean_score
  from public.mastery_snapshots ms
  where ms.academic_year_id = p_academic_year_id
    and (p_class_section_id is null or ms.class_section_id = p_class_section_id)
  group by ms.student_id, ms.class_section_id
  order by ms.student_id;
$$;

revoke execute on function public.mastery_student_stats(uuid, uuid, numeric, numeric) from public, anon;
grant execute on function public.mastery_student_stats(uuid, uuid, numeric, numeric) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- M20-T6: migration 0093 part 3 — interventions on insight_actions (rulings
-- "Interventions"). M19's insight_actions (0092) gains a kind discriminator
-- plus six intervention-only columns; M19's own columns, functions and
-- policies are untouched — this only adds new columns/constraints/indexes/
-- policies/grant to that same table (rulings "M20 never edits M19's files,
-- policies or functions"). M19 added no INSERT/UPDATE/DELETE policy on this
-- table, so a non-trusted INSERT is already denied by RLS alone (raw 42501,
-- no permissive INSERT policy exists before or after this part) — the
-- trigger below never raises its own exception on INSERT, so that denial
-- surfaces unmodified.
-- ---------------------------------------------------------------------------

alter table public.insight_actions
  add column kind text not null default 'action' check (kind in ('action', 'intervention')),
  add column student_id uuid references public.students (id),
  add column goal text check (length(goal) between 1 and 300),
  add column steps jsonb,
  add column review_date date,
  add column intervention_status text check (intervention_status in ('proposed', 'active', 'review', 'closed')),
  add column owner_staff_id uuid references public.staff (id);

alter table public.insight_actions
  add constraint insight_actions_intervention_fields check (
    (
      kind = 'intervention'
      and student_id is not null
      and goal is not null
      and steps is not null
      and review_date is not null
      and intervention_status is not null
    )
    or (
      kind = 'action'
      and student_id is null
      and goal is null
      and steps is null
      and review_date is null
      and intervention_status is null
      and owner_staff_id is null
    )
  );

create unique index insight_actions_one_intervention
  on public.insight_actions (insight_id)
  where kind = 'intervention';

create index insight_actions_student_intervention_idx
  on public.insight_actions (student_id)
  where kind = 'intervention';

-- app.guard_intervention — security invoker, BEFORE INSERT OR UPDATE.
-- Validates `steps` and syncs the M19 `status` column for every writer of
-- an intervention row, then (service_role/postgres bypass per lesson 5)
-- enforces the state machine for everyone else: no direct INSERT (left to
-- RLS, see above), no edit of a closed plan, no identity-field change, and
-- only the proposed/active/review/closed edges the rulings allow. Kind
-- itself can never change on UPDATE, trusted or not — 'action' rows return
-- immediately and are otherwise unaffected.
create function app.guard_intervention()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_steps_len int;
  v_bad_step boolean;
  v_trusted boolean;
begin
  if tg_op = 'UPDATE' and new.kind is distinct from old.kind then
    raise exception 'code:forbidden' using detail = 'kind cannot change on an insight_actions row';
  end if;

  if new.kind <> 'intervention' then
    return new;
  end if;

  if jsonb_typeof(new.steps) <> 'array' then
    raise exception 'code:validation_failed' using detail = 'steps must be a JSON array of 1 to 8 entries';
  end if;

  v_steps_len := jsonb_array_length(new.steps);
  if v_steps_len < 1 or v_steps_len > 8 or length(new.steps::text) > 4000 then
    raise exception 'code:validation_failed'
      using detail = 'steps must have 1 to 8 entries and serialize to at most 4000 characters';
  end if;

  -- Short-circuit OR, left to right (same reliance as the jsonb_typeof/
  -- jsonb_array_length AND pattern on insights.evidence/briefings.items,
  -- 0092): the type check always runs before jsonb_object_keys/->>, so a
  -- non-object element never reaches a function that would error on it.
  select exists (
    select 1 from jsonb_array_elements(new.steps) elem
    where jsonb_typeof(elem) <> 'object'
      or (select array_agg(k order by k) from jsonb_object_keys(elem) k) is distinct from array['done', 'due', 'title']
      or jsonb_typeof(elem -> 'title') <> 'string'
      or length(elem ->> 'title') not between 1 and 120
      or jsonb_typeof(elem -> 'due') <> 'string'
      or elem ->> 'due' !~ '^\d{4}-\d{2}-\d{2}$'
      or jsonb_typeof(elem -> 'done') <> 'boolean'
  ) into v_bad_step;

  if v_bad_step then
    raise exception 'code:validation_failed'
      using detail = 'each step needs exactly title (1-120 chars), due (YYYY-MM-DD), and done (boolean)';
  end if;

  new.status := case when new.intervention_status = 'closed' then 'done' else 'planned' end;

  v_trusted := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres';
  if v_trusted then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.intervention_status = 'closed' then
      raise exception 'code:invalid_state' using detail = 'a closed intervention cannot be updated';
    end if;

    if new.institution_id is distinct from old.institution_id
      or new.insight_id is distinct from old.insight_id
      or new.student_id is distinct from old.student_id
      or new.owner_staff_id is distinct from old.owner_staff_id
    then
      raise exception 'code:forbidden'
        using detail = 'institution_id, insight_id, student_id, and owner_staff_id cannot change on an intervention';
    end if;

    if new.intervention_status is distinct from old.intervention_status
      and not (
        (old.intervention_status = 'proposed' and new.intervention_status in ('active', 'closed'))
        or (old.intervention_status = 'active' and new.intervention_status in ('review', 'closed'))
        or (old.intervention_status = 'review' and new.intervention_status in ('active', 'closed'))
      )
    then
      raise exception 'code:invalid_state' using detail = 'invalid intervention_status transition';
    end if;
  end if;

  return new;
end;
$$;

create trigger guard_intervention
before insert or update on public.insight_actions
for each row
execute function app.guard_intervention();

-- RLS: S = owner/principal of the institution, or the class teacher of the
-- student (app.my_class_teacher_student_ids, X07/0090 — reused, not
-- redefined). Permissive policies grant intervention visibility to S
-- independently of the parent insight's own visibility (rulings "keep M20
-- independent of M19's"); restrictive policies then deny everyone else,
-- even if M19's insight_actions_select would otherwise have let them
-- through via the parent insight.
create policy insight_actions_intervention_select on public.insight_actions
  for select to authenticated
  using (
    kind = 'intervention'
    and (
      institution_id = any((select app.my_institution_ids(array['owner', 'principal'])))
      or student_id = any((select app.my_class_teacher_student_ids()))
    )
  );

create policy insight_actions_intervention_update on public.insight_actions
  for update to authenticated
  using (
    kind = 'intervention'
    and (
      institution_id = any((select app.my_institution_ids(array['owner', 'principal'])))
      or student_id = any((select app.my_class_teacher_student_ids()))
    )
  )
  with check (
    kind = 'intervention'
    and (
      institution_id = any((select app.my_institution_ids(array['owner', 'principal'])))
      or student_id = any((select app.my_class_teacher_student_ids()))
    )
  );

create policy insight_actions_intervention_restrict_select on public.insight_actions
  as restrictive
  for select to authenticated
  using (
    kind <> 'intervention'
    or institution_id = any((select app.my_institution_ids(array['owner', 'principal'])))
    or student_id = any((select app.my_class_teacher_student_ids()))
  );

create policy insight_actions_intervention_restrict_update on public.insight_actions
  as restrictive
  for update to authenticated
  using (
    kind <> 'intervention'
    or institution_id = any((select app.my_institution_ids(array['owner', 'principal'])))
    or student_id = any((select app.my_class_teacher_student_ids()))
  )
  with check (
    kind <> 'intervention'
    or institution_id = any((select app.my_institution_ids(array['owner', 'principal'])))
    or student_id = any((select app.my_class_teacher_student_ids()))
  );

create policy insight_actions_intervention_restrict_insert on public.insight_actions
  as restrictive
  for insert to authenticated
  with check (kind <> 'intervention');

create policy insight_actions_intervention_restrict_delete on public.insight_actions
  as restrictive
  for delete to authenticated
  using (kind <> 'intervention');

-- Harmless alongside the table-level grant authenticated already has
-- (0045 default); narrows what a non-trusted UPDATE can touch by column.
grant update (goal, steps, review_date, intervention_status) on public.insight_actions to authenticated;

-- ---------------------------------------------------------------------------
-- M20-T12: migration 0093 part 4 — M19's insights checks admit the gap
-- detector (rulings "Gap detector"). 0092 enumerates its 11 signals and 6
-- reviewer roles; mastery_gap_v1 writes signal 'academics.mastery_gap' with
-- reviewer_role 'teacher' (the class teacher owns the plan). Widen-only:
-- every existing row and value stays valid; no M19 function or policy
-- changes. detector_version stays M19's int (1 = mastery_gap_v1).
-- ---------------------------------------------------------------------------

alter table public.insights drop constraint insights_signal_check;
alter table public.insights add constraint insights_signal_check check (signal in (
  'attendance.section_drop', 'attendance.student_drop',
  'academics.marks_decline', 'academics.missing_work', 'academics.awaiting_review',
  'finance.overdue_growth', 'finance.concession_spike',
  'admissions.stage_dwell',
  'staff.workload',
  'operations.room_capacity', 'operations.room_pressure',
  'academics.mastery_gap'
));

alter table public.insights drop constraint insights_reviewer_role_check;
alter table public.insights add constraint insights_reviewer_role_check check (reviewer_role in (
  'owner', 'principal', 'admin', 'admissions', 'accountant', 'exam_controller', 'teacher'
));
