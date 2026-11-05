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
