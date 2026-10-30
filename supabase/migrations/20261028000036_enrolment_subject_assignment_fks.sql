-- T-042 fix round 1 (review HIGH, lesson 2): `enrolments` and
-- `subject_assignments` INSERT/UPDATE policies (0005) checked only the
-- caller's role, never that the user-supplied FKs belong to the row's
-- institution — the write side of the cross-tenant hole 0035 closes on the
-- read side. Same role sets; every FK now bound to `institution_id`.
-- Policy subqueries run under the caller's RLS; every role here reads
-- students/class_sections/academic_years/subjects of its own institution,
-- and staff is checked through the existing definer `app.staff_in_institution`.

drop policy enrolments_insert on public.enrolments;
create policy enrolments_insert on public.enrolments
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions'])
    and exists (select 1 from public.students st where st.id = enrolments.student_id and st.institution_id = enrolments.institution_id)
    and exists (select 1 from public.class_sections cs where cs.id = enrolments.class_section_id and cs.institution_id = enrolments.institution_id)
    and exists (select 1 from public.academic_years y where y.id = enrolments.academic_year_id and y.institution_id = enrolments.institution_id)
  );

drop policy enrolments_update on public.enrolments;
create policy enrolments_update on public.enrolments
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']))
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions'])
    and exists (select 1 from public.students st where st.id = enrolments.student_id and st.institution_id = enrolments.institution_id)
    and exists (select 1 from public.class_sections cs where cs.id = enrolments.class_section_id and cs.institution_id = enrolments.institution_id)
    and exists (select 1 from public.academic_years y where y.id = enrolments.academic_year_id and y.institution_id = enrolments.institution_id)
  );

drop policy subject_assignments_insert on public.subject_assignments;
create policy subject_assignments_insert on public.subject_assignments
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and exists (select 1 from public.class_sections cs where cs.id = subject_assignments.class_section_id and cs.institution_id = subject_assignments.institution_id)
    and exists (select 1 from public.subjects s where s.id = subject_assignments.subject_id and s.institution_id = subject_assignments.institution_id)
    and app.staff_in_institution(subject_assignments.teacher_id, subject_assignments.institution_id)
  );

drop policy subject_assignments_update on public.subject_assignments;
create policy subject_assignments_update on public.subject_assignments
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and exists (select 1 from public.class_sections cs where cs.id = subject_assignments.class_section_id and cs.institution_id = subject_assignments.institution_id)
    and exists (select 1 from public.subjects s where s.id = subject_assignments.subject_id and s.institution_id = subject_assignments.institution_id)
    and app.staff_in_institution(subject_assignments.teacher_id, subject_assignments.institution_id)
  );
