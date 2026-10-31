-- M03-T3 (lesson 2): `terms`/`class_sections`/`staff`/`curriculum_units`
-- INSERT/UPDATE policies (0002/0004/0005) checked only the caller's role,
-- never that the row's user-supplied FKs point inside the same
-- institution — the write-side hole 0036 closed for enrolments/
-- subject_assignments. Same role sets as today; every FK now bound to
-- `institution_id`, mirroring 0036's style.

drop policy terms_insert on public.terms;
create policy terms_insert on public.terms
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and exists (select 1 from public.academic_years y where y.id = terms.academic_year_id and y.institution_id = terms.institution_id)
  );

drop policy terms_update on public.terms;
create policy terms_update on public.terms
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and exists (select 1 from public.academic_years y where y.id = terms.academic_year_id and y.institution_id = terms.institution_id)
  );

drop policy class_sections_insert on public.class_sections;
create policy class_sections_insert on public.class_sections
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and exists (select 1 from public.grades g where g.id = class_sections.grade_id and g.institution_id = class_sections.institution_id)
    and exists (select 1 from public.academic_years y where y.id = class_sections.academic_year_id and y.institution_id = class_sections.institution_id)
    and (class_sections.class_teacher_id is null or app.staff_in_institution(class_sections.class_teacher_id, class_sections.institution_id))
  );

drop policy class_sections_update on public.class_sections;
create policy class_sections_update on public.class_sections
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and exists (select 1 from public.grades g where g.id = class_sections.grade_id and g.institution_id = class_sections.institution_id)
    and exists (select 1 from public.academic_years y where y.id = class_sections.academic_year_id and y.institution_id = class_sections.institution_id)
    and (class_sections.class_teacher_id is null or app.staff_in_institution(class_sections.class_teacher_id, class_sections.institution_id))
  );

drop policy staff_insert on public.staff;
create policy staff_insert on public.staff
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and (staff.department_id is null or exists (select 1 from public.departments d where d.id = staff.department_id and d.institution_id = staff.institution_id))
  );

drop policy staff_update on public.staff;
create policy staff_update on public.staff
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and (staff.department_id is null or exists (select 1 from public.departments d where d.id = staff.department_id and d.institution_id = staff.institution_id))
  );

drop policy curriculum_units_insert on public.curriculum_units;
create policy curriculum_units_insert on public.curriculum_units
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and exists (select 1 from public.subjects s where s.id = curriculum_units.subject_id and s.institution_id = curriculum_units.institution_id)
    and exists (select 1 from public.grades g where g.id = curriculum_units.grade_id and g.institution_id = curriculum_units.institution_id)
  );

drop policy curriculum_units_update on public.curriculum_units;
create policy curriculum_units_update on public.curriculum_units
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and exists (select 1 from public.subjects s where s.id = curriculum_units.subject_id and s.institution_id = curriculum_units.institution_id)
    and exists (select 1 from public.grades g where g.id = curriculum_units.grade_id and g.institution_id = curriculum_units.institution_id)
  );
