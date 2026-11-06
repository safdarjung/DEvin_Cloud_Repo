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
  where cs.id = new.class_section_id;

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
