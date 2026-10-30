-- T-042 / DBT-19: `assignments` INSERT/UPDATE (0005) let any teacher of a
-- section write an assignment for ANY subject in it (`app.teaches_section`
-- is section-level). The app rule (src/modules/academics/teacher-scope.ts,
-- T-022) is: owner/principal, the section's class teacher (any subject), or
-- a teacher with a subject_assignments row for exactly (section, subject).
-- This moves that rule into RLS with initPlan helpers (lesson 7) and binds
-- every user-supplied FK — class_section_id, subject_id, curriculum_unit_id,
-- created_by — to the row's institution (lesson 2; 0005 bound none).
-- SELECT is 0025's.

create function app.my_class_teacher_section_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select cs.id
  from public.memberships m
  join public.class_sections cs
    on cs.class_teacher_id = m.staff_id
   and cs.institution_id = m.institution_id
  where m.user_id = app.current_user_id()
    and m.status = 'active'
    and m.staff_id is not null;
$$;

revoke execute on function app.my_class_teacher_section_ids() from public;
grant execute on function app.my_class_teacher_section_ids() to authenticated;

drop policy assignments_insert on public.assignments;
create policy assignments_insert on public.assignments
  for insert to authenticated
  with check (
    (
      institution_id = any((select app.my_institution_ids(array['owner', 'principal'])))
      or class_section_id = any((select app.my_class_teacher_section_ids()))
      or (class_section_id, subject_id) in (select t.class_section_id, t.subject_id from app.my_taught_section_subjects() t)
    )
    and exists (
      select 1 from public.class_sections cs
      where cs.id = assignments.class_section_id and cs.institution_id = assignments.institution_id
    )
    and exists (
      select 1 from public.subjects s
      where s.id = assignments.subject_id and s.institution_id = assignments.institution_id
    )
    and (
      assignments.curriculum_unit_id is null
      or exists (
        select 1 from public.curriculum_units cu
        where cu.id = assignments.curriculum_unit_id and cu.institution_id = assignments.institution_id
      )
    )
    and app.staff_in_institution(assignments.created_by, assignments.institution_id)
  );

drop policy assignments_update on public.assignments;
create policy assignments_update on public.assignments
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
      where cs.id = assignments.class_section_id and cs.institution_id = assignments.institution_id
    )
    and exists (
      select 1 from public.subjects s
      where s.id = assignments.subject_id and s.institution_id = assignments.institution_id
    )
    and (
      assignments.curriculum_unit_id is null
      or exists (
        select 1 from public.curriculum_units cu
        where cu.id = assignments.curriculum_unit_id and cu.institution_id = assignments.institution_id
      )
    )
    and app.staff_in_institution(assignments.created_by, assignments.institution_id)
  );
