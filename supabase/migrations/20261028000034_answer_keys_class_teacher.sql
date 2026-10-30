-- T-042 (found while closing DBT-19): `assignment_answer_keys` RLS (0023)
-- grants teachers only the (section, subject) pairs they subject-teach, but
-- the app rule (teacher-scope.ts `managesWholeSection`) and now `assignments`
-- RLS (0026) also let a section's class teacher write any subject there. A
-- class teacher saving a quiz for a subject they don't personally teach got
-- the `assignments` row and then a 42501 on the answer-key insert, leaving a
-- quiz with no key (publish then refuses it). Same three policies, plus the
-- class-teacher branch via 0026's initPlan helper. No new security definer.

drop policy assignment_answer_keys_select on public.assignment_answer_keys;
create policy assignment_answer_keys_select on public.assignment_answer_keys
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal'])))
    or exists (
      select 1 from public.assignments a
      where a.id = assignment_answer_keys.assignment_id
        and a.institution_id = assignment_answer_keys.institution_id
        and (
          a.class_section_id = any((select app.my_class_teacher_section_ids()))
          or (a.class_section_id, a.subject_id) in (select t.class_section_id, t.subject_id from app.my_taught_section_subjects() t)
        )
    )
  );

drop policy assignment_answer_keys_insert on public.assignment_answer_keys;
create policy assignment_answer_keys_insert on public.assignment_answer_keys
  for insert to authenticated
  with check (
    exists (
      select 1 from public.assignments a
      where a.id = assignment_answer_keys.assignment_id and a.institution_id = assignment_answer_keys.institution_id
    )
    and (
      institution_id = any((select app.my_institution_ids(array['owner', 'principal'])))
      or exists (
        select 1 from public.assignments a
        where a.id = assignment_answer_keys.assignment_id
          and a.institution_id = assignment_answer_keys.institution_id
          and (
            a.class_section_id = any((select app.my_class_teacher_section_ids()))
            or (a.class_section_id, a.subject_id) in (select t.class_section_id, t.subject_id from app.my_taught_section_subjects() t)
          )
      )
    )
  );

drop policy assignment_answer_keys_update on public.assignment_answer_keys;
create policy assignment_answer_keys_update on public.assignment_answer_keys
  for update to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal'])))
    or exists (
      select 1 from public.assignments a
      where a.id = assignment_answer_keys.assignment_id
        and a.institution_id = assignment_answer_keys.institution_id
        and (
          a.class_section_id = any((select app.my_class_teacher_section_ids()))
          or (a.class_section_id, a.subject_id) in (select t.class_section_id, t.subject_id from app.my_taught_section_subjects() t)
        )
    )
  )
  with check (
    exists (
      select 1 from public.assignments a
      where a.id = assignment_answer_keys.assignment_id and a.institution_id = assignment_answer_keys.institution_id
    )
    and (
      institution_id = any((select app.my_institution_ids(array['owner', 'principal'])))
      or exists (
        select 1 from public.assignments a
        where a.id = assignment_answer_keys.assignment_id
          and a.institution_id = assignment_answer_keys.institution_id
          and (
            a.class_section_id = any((select app.my_class_teacher_section_ids()))
            or (a.class_section_id, a.subject_id) in (select t.class_section_id, t.subject_id from app.my_taught_section_subjects() t)
          )
      )
    )
  );
