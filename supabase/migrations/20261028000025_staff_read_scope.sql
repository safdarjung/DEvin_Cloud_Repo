-- T-042 / DBT-17: narrow the "class S" SELECT policies (0004/0005, rewritten
-- for performance in 0020) from every `app.staff_roles()` member to the
-- 07 §2.2 read columns.
--
--   student.read  : own/pri/adm/ads/acc/exc full; teacher `s` (own sections)
--                   -> students, enrolments, enrolment_status_history,
--                      guardian_students lose the teacher's institution-wide read.
--   guardian.read : own/pri/adm/ads/acc full; teacher `s`; guardian `s`
--                   -> guardian_students also loses exam_controller (same
--                      role list as guardians_select, 0020).
--   assignment.read: own/pri/adm full; teacher `s`; student/guardian `s`
--                   -> assignments loses admissions/accountant/exam_controller,
--                      and the teacher's read narrows to sections they teach.
--
-- Teacher "own sections" = `app.my_taught_section_ids()` (class teacher or a
-- subject_assignments row, P-01). Students in those sections come from the
-- new initPlan helper below (lesson 7: `col = any((select app.my_*()))`, never
-- a per-row definer call). Guardian/student branches are unchanged.
-- Write policies are untouched (assignments writes: 0026).

create function app.my_taught_student_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct e.student_id
  from public.enrolments e
  where e.status = 'active'
    and e.class_section_id = any(array(select app.my_taught_section_ids()));
$$;

revoke execute on function app.my_taught_student_ids() from public;
grant execute on function app.my_taught_student_ids() to authenticated;

drop policy students_select on public.students;
create policy students_select on public.students
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'admissions', 'accountant', 'exam_controller'])))
    or id = any((select app.my_student_ids()))
    or id = any((select app.my_taught_student_ids()))
  );

drop policy enrolments_select on public.enrolments;
create policy enrolments_select on public.enrolments
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'admissions', 'accountant', 'exam_controller'])))
    or student_id = any((select app.my_student_ids()))
    or class_section_id = any((select app.my_taught_section_ids()))
  );

drop policy enrolment_status_history_select on public.enrolment_status_history;
create policy enrolment_status_history_select on public.enrolment_status_history
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'admissions', 'accountant', 'exam_controller'])))
    or exists (
      select 1
      from public.enrolments e
      where e.id = enrolment_status_history.enrolment_id
        and e.institution_id = enrolment_status_history.institution_id
        and (
          e.student_id = any((select app.my_student_ids()))
          or e.class_section_id = any((select app.my_taught_section_ids()))
        )
    )
  );

drop policy guardian_students_select on public.guardian_students;
create policy guardian_students_select on public.guardian_students
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'admissions', 'accountant'])))
    or student_id = any((select app.my_student_ids()))
    or student_id = any((select app.my_taught_student_ids()))
    or guardian_id = any((
      select m.guardian_id
      from public.memberships m
      where m.user_id = (select app.current_user_id())
        and m.guardian_id is not null
        and m.status = 'active'
        and m.institution_id = guardian_students.institution_id
    ))
  );

drop policy assignments_select on public.assignments;
create policy assignments_select on public.assignments
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or class_section_id = any((select app.my_taught_section_ids()))
    or (status = 'published' and class_section_id = any((select app.my_student_section_ids())))
  );
