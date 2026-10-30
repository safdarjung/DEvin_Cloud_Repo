-- T-042 fix round 1 (review LOW): `guardian_students_select` (0025) kept
-- 0020's `student_id = any(app.my_student_ids())` branch, which also lets a
-- *student* read their own guardian links — but 07 §2.2 `guardian.read` has
-- no student column. Dropped that branch; the guardian keeps reading their
-- own links through the existing `guardian_id` branch, which is all the
-- portal queries use (listMyChildren / listGuardianChildren filter by the
-- caller's guardian_id). Staff and teacher branches are 0025's.

drop policy guardian_students_select on public.guardian_students;
create policy guardian_students_select on public.guardian_students
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'admissions', 'accountant'])))
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
