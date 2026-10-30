-- T-042 (T-041 "Found"): `exams_select` (0009) is staff-only, so the
-- guardian/student report card's `results -> exams(name)` embed was always
-- null — every report card in the portal rendered without its exam name.
--
-- Narrowest read that fixes it: a guardian/student may read a *published*
-- exam only when one of their own/linked students has a result in it, in
-- the same institution. initPlan helper for the caller's students
-- (`(select app.my_student_ids())`, lesson 7); the results subquery keeps the
-- institution correlation and runs under results' own RLS (0020, same
-- my_student_ids scope). Additive permissive policy — the staff policy and
-- every write policy are untouched. No new security definer.

create policy exams_select_own_results on public.exams
  for select to authenticated
  using (
    status = 'published'
    and exists (
      select 1
      from public.results r
      where r.exam_id = exams.id
        and r.institution_id = exams.institution_id
        and r.student_id = any((select app.my_student_ids()))
    )
  );
