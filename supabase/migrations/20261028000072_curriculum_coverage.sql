-- M10-T1: lesson_plans, curriculum_unit_coverage (M10-tasks.md rulings).
--
-- Lesson plans are editable teacher notes; coverage is a fact row
-- (upsert/delete) — neither is in rule 5's immutable list, so deletes are
-- allowed. Write scope W is 0026's assignments_insert rule verbatim (owner/
-- principal, the section's class teacher for any subject, or a teacher
-- with a subject_assignments row for exactly (section, subject); admin
-- excluded — no assignment.manage). Every user-supplied FK is bound to the
-- row's own institution in `with check` (lesson 2), table-qualified.
-- Identity columns are frozen post-insert by invoker BEFORE UPDATE guards
-- (lesson 5), bypassed only for service_role/postgres. No security
-- definer functions are added here — RLS reuses 0020/0026's existing
-- initPlan helpers (my_institution_ids, my_class_teacher_section_ids,
-- my_taught_section_subjects, my_student_section_ids, staff_roles).

create table public.lesson_plans (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  class_section_id uuid not null references public.class_sections (id),
  subject_id uuid not null references public.subjects (id),
  curriculum_unit_id uuid references public.curriculum_units (id),
  planned_on date not null,
  title text not null check (length(title) between 1 and 120),
  objectives text not null check (length(objectives) between 1 and 2000),
  resources text check (resources is null or length(resources) <= 2000),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lesson_plans_section_subject_planned_idx
  on public.lesson_plans (class_section_id, subject_id, planned_on);

create trigger set_updated_at
before update on public.lesson_plans
for each row execute function app.set_updated_at();

create table public.curriculum_unit_coverage (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  class_section_id uuid not null references public.class_sections (id),
  subject_id uuid not null references public.subjects (id),
  curriculum_unit_id uuid not null references public.curriculum_units (id),
  covered_on date not null,
  lesson_plan_id uuid references public.lesson_plans (id) on delete set null,
  notes text check (notes is null or length(notes) <= 500),
  marked_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One fact per unit per section; sections are per academic year, so
  -- coverage is per year by construction.
  unique (class_section_id, curriculum_unit_id)
);

create trigger set_updated_at
before update on public.curriculum_unit_coverage
for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Identity guards (invoker, BEFORE UPDATE; bypass only service_role/
-- postgres, same shape as 0068/0069's guard_*_update).
-- ---------------------------------------------------------------------------

create function app.guard_lesson_plan_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  then
    return new;
  end if;

  if new.institution_id is distinct from old.institution_id
    or new.class_section_id is distinct from old.class_section_id
    or new.created_by is distinct from old.created_by
  then
    raise exception 'code:forbidden' using detail = 'institution_id, class_section_id, and created_by cannot change on a lesson plan';
  end if;

  return new;
end;
$$;

create trigger guard_lesson_plan_identity
before update on public.lesson_plans
for each row execute function app.guard_lesson_plan_identity();

create function app.guard_coverage_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  then
    return new;
  end if;

  if new.institution_id is distinct from old.institution_id
    or new.class_section_id is distinct from old.class_section_id
    or new.curriculum_unit_id is distinct from old.curriculum_unit_id
  then
    raise exception 'code:forbidden' using detail = 'institution_id, class_section_id, and curriculum_unit_id cannot change on a coverage row';
  end if;

  return new;
end;
$$;

create trigger guard_coverage_identity
before update on public.curriculum_unit_coverage
for each row execute function app.guard_coverage_identity();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.lesson_plans enable row level security;

-- SELECT: owner/principal/admin see every plan; a teacher sees plans in
-- their own write scope W (class-teacher section, or taught section+
-- subject). No guardian/student, accountant, admissions, exam_controller.
create policy lesson_plans_select on public.lesson_plans
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or class_section_id = any((select app.my_class_teacher_section_ids()))
    or (class_section_id, subject_id) in (select t.class_section_id, t.subject_id from app.my_taught_section_subjects() t)
  );

create policy lesson_plans_insert on public.lesson_plans
  for insert to authenticated
  with check (
    (
      institution_id = any((select app.my_institution_ids(array['owner', 'principal'])))
      or class_section_id = any((select app.my_class_teacher_section_ids()))
      or (class_section_id, subject_id) in (select t.class_section_id, t.subject_id from app.my_taught_section_subjects() t)
    )
    and exists (
      select 1 from public.class_sections cs
      where cs.id = lesson_plans.class_section_id and cs.institution_id = lesson_plans.institution_id
    )
    and exists (
      select 1 from public.subjects s
      where s.id = lesson_plans.subject_id and s.institution_id = lesson_plans.institution_id
    )
    and (
      lesson_plans.curriculum_unit_id is null
      or exists (
        select 1 from public.curriculum_units cu
        join public.class_sections cs on cs.id = lesson_plans.class_section_id
        where cu.id = lesson_plans.curriculum_unit_id
          and cu.institution_id = lesson_plans.institution_id
          and cu.subject_id = lesson_plans.subject_id
          and cu.grade_id = cs.grade_id
      )
    )
    and lesson_plans.created_by = (select app.current_user_id())
  );

create policy lesson_plans_update on public.lesson_plans
  for update to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal'])))
    or class_section_id = any((select app.my_class_teacher_section_ids()))
    or (class_section_id, subject_id) in (select t.class_section_id, t.subject_id from app.my_taught_section_subjects() t)
  )
  with check (
    (
      institution_id = any((select app.my_institution_ids(array['owner', 'principal'])))
      or class_section_id = any((select app.my_class_teacher_section_ids()))
      or (class_section_id, subject_id) in (select t.class_section_id, t.subject_id from app.my_taught_section_subjects() t)
    )
    and exists (
      select 1 from public.class_sections cs
      where cs.id = lesson_plans.class_section_id and cs.institution_id = lesson_plans.institution_id
    )
    and exists (
      select 1 from public.subjects s
      where s.id = lesson_plans.subject_id and s.institution_id = lesson_plans.institution_id
    )
    and (
      lesson_plans.curriculum_unit_id is null
      or exists (
        select 1 from public.curriculum_units cu
        join public.class_sections cs on cs.id = lesson_plans.class_section_id
        where cu.id = lesson_plans.curriculum_unit_id
          and cu.institution_id = lesson_plans.institution_id
          and cu.subject_id = lesson_plans.subject_id
          and cu.grade_id = cs.grade_id
      )
    )
  );

create policy lesson_plans_delete on public.lesson_plans
  for delete to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal'])))
    or class_section_id = any((select app.my_class_teacher_section_ids()))
    or (class_section_id, subject_id) in (select t.class_section_id, t.subject_id from app.my_taught_section_subjects() t)
  );

alter table public.curriculum_unit_coverage enable row level security;

-- SELECT: all staff roles (same shape as 0020's subject_assignments_select)
-- plus a guardian/student via their own/linked child's current section.
create policy curriculum_unit_coverage_select on public.curriculum_unit_coverage
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(app.staff_roles())))
    or class_section_id = any((select app.my_student_section_ids()))
  );

create policy curriculum_unit_coverage_insert on public.curriculum_unit_coverage
  for insert to authenticated
  with check (
    (
      institution_id = any((select app.my_institution_ids(array['owner', 'principal'])))
      or class_section_id = any((select app.my_class_teacher_section_ids()))
      or (class_section_id, subject_id) in (select t.class_section_id, t.subject_id from app.my_taught_section_subjects() t)
    )
    and exists (
      select 1 from public.class_sections cs
      where cs.id = curriculum_unit_coverage.class_section_id and cs.institution_id = curriculum_unit_coverage.institution_id
    )
    and exists (
      select 1 from public.subjects s
      where s.id = curriculum_unit_coverage.subject_id and s.institution_id = curriculum_unit_coverage.institution_id
    )
    and exists (
      select 1 from public.curriculum_units cu
      join public.class_sections cs on cs.id = curriculum_unit_coverage.class_section_id
      where cu.id = curriculum_unit_coverage.curriculum_unit_id
        and cu.institution_id = curriculum_unit_coverage.institution_id
        and cu.subject_id = curriculum_unit_coverage.subject_id
        and cu.grade_id = cs.grade_id
    )
    and (
      curriculum_unit_coverage.lesson_plan_id is null
      or exists (
        select 1 from public.lesson_plans lp
        where lp.id = curriculum_unit_coverage.lesson_plan_id
          and lp.institution_id = curriculum_unit_coverage.institution_id
          and lp.class_section_id = curriculum_unit_coverage.class_section_id
      )
    )
    and curriculum_unit_coverage.marked_by = (select app.current_user_id())
  );

create policy curriculum_unit_coverage_update on public.curriculum_unit_coverage
  for update to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal'])))
    or class_section_id = any((select app.my_class_teacher_section_ids()))
    or (class_section_id, subject_id) in (select t.class_section_id, t.subject_id from app.my_taught_section_subjects() t)
  )
  with check (
    (
      institution_id = any((select app.my_institution_ids(array['owner', 'principal'])))
      or class_section_id = any((select app.my_class_teacher_section_ids()))
      or (class_section_id, subject_id) in (select t.class_section_id, t.subject_id from app.my_taught_section_subjects() t)
    )
    and exists (
      select 1 from public.class_sections cs
      where cs.id = curriculum_unit_coverage.class_section_id and cs.institution_id = curriculum_unit_coverage.institution_id
    )
    and exists (
      select 1 from public.subjects s
      where s.id = curriculum_unit_coverage.subject_id and s.institution_id = curriculum_unit_coverage.institution_id
    )
    and exists (
      select 1 from public.curriculum_units cu
      join public.class_sections cs on cs.id = curriculum_unit_coverage.class_section_id
      where cu.id = curriculum_unit_coverage.curriculum_unit_id
        and cu.institution_id = curriculum_unit_coverage.institution_id
        and cu.subject_id = curriculum_unit_coverage.subject_id
        and cu.grade_id = cs.grade_id
    )
    and (
      curriculum_unit_coverage.lesson_plan_id is null
      or exists (
        select 1 from public.lesson_plans lp
        where lp.id = curriculum_unit_coverage.lesson_plan_id
          and lp.institution_id = curriculum_unit_coverage.institution_id
          and lp.class_section_id = curriculum_unit_coverage.class_section_id
      )
    )
    -- Re-marking re-stamps marked_by.
    and curriculum_unit_coverage.marked_by = (select app.current_user_id())
  );

create policy curriculum_unit_coverage_delete on public.curriculum_unit_coverage
  for delete to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal'])))
    or class_section_id = any((select app.my_class_teacher_section_ids()))
    or (class_section_id, subject_id) in (select t.class_section_id, t.subject_id from app.my_taught_section_subjects() t)
  );
