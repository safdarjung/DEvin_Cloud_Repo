-- T-042 fix round 1 (review HIGH, cross-tenant): the teacher-scope initPlan
-- helpers trusted every enrolments / subject_assignments row without
-- checking that its student, section and subject belong to the row's own
-- institution. With a cross-institution row (an A admin enrolling B's
-- student into an A section — possible until 0036 bound those FKs), A's
-- teacher could read B's student, guardian links and results.
--
-- `create or replace` both helpers (same signatures, still security
-- definer, same grants) with institution joins, and point `results_select`'s
-- teacher branch (0020) at the fixed helper instead of its own unchecked
-- enrolments subquery (same rule: active enrolment in a taught section).

create or replace function app.my_taught_student_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct e.student_id
  from public.enrolments e
  join public.class_sections cs
    on cs.id = e.class_section_id
   and cs.institution_id = e.institution_id
  join public.students st
    on st.id = e.student_id
   and st.institution_id = e.institution_id
  where e.status = 'active'
    and e.class_section_id = any(array(select app.my_taught_section_ids()));
$$;

create or replace function app.my_taught_section_subjects()
returns table (class_section_id uuid, subject_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct sa.class_section_id, sa.subject_id
  from public.subject_assignments sa
  join public.memberships m
    on m.staff_id = sa.teacher_id
   and m.institution_id = sa.institution_id
  join public.class_sections cs
    on cs.id = sa.class_section_id
   and cs.institution_id = sa.institution_id
  join public.subjects s
    on s.id = sa.subject_id
   and s.institution_id = sa.institution_id
  where m.user_id = app.current_user_id()
    and m.status = 'active';
$$;

drop policy results_select on public.results;
create policy results_select on public.results
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(app.exam_roles())))
    or student_id = any((select app.my_taught_student_ids()))
    or student_id = any((select app.my_student_ids()))
  );
