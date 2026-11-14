-- 0154 exam_marks_deadline — a date by which every paper's marks are due, the
-- per-paper progress behind "who has not submitted", and the daily sweep that
-- reminds the paper's teacher and the exam office until the marks are in.
--
-- Owner request (2026-11-14): after UT1 the office sets e.g. 20 July; the class
-- teacher gets reminders until her marks are in, the office person sees by name
-- who is late, and reminders keep coming after the date passes.

-- ---------------------------------------------------------------------------
-- exams.marks_due_on — set by exam.manage roles through the existing
-- exams_update policy (app.exam_write_roles()). guard_exam_status only fences
-- `status`, so this column needs no RPC.
-- ---------------------------------------------------------------------------

alter table public.exams add column marks_due_on date;

comment on column public.exams.marks_due_on is
  'Date by which every paper''s marks are due (0154). Reminders start 2 days before and repeat daily while marks are missing.';

-- ---------------------------------------------------------------------------
-- public.exam_marks_progress — per paper of one exam: active students in the
-- paper's section (total) and how many of them have a current mark or an
-- absent flag (entered). Counted in SQL so a large exam never hits the API's
-- row cap. security invoker: the caller's RLS decides what it can count (staff
-- read papers, marks and enrolments; the job runner calls it as service_role).
-- ---------------------------------------------------------------------------

create function public.exam_marks_progress(p_institution_id uuid, p_exam_id uuid)
returns table (paper_id uuid, entered int, total int)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id,
    (
      select count(*)::int
      from public.marks m
      join public.enrolments e
        on e.student_id = m.student_id
       and e.class_section_id = p.class_section_id
       and e.status = 'active'
      where m.exam_paper_id = p.id
        and m.institution_id = p.institution_id
        and m.superseded_by is null
    ),
    (
      select count(*)::int
      from public.enrolments e
      where e.class_section_id = p.class_section_id
        and e.institution_id = p.institution_id
        and e.status = 'active'
    )
  from public.exam_papers p
  where p.institution_id = p_institution_id
    and p.exam_id = p_exam_id;
$$;

revoke execute on function public.exam_marks_progress(uuid, uuid) from public, anon;
grant execute on function public.exam_marks_progress(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- public.enqueue_marks_reminders — runner sweep (0138 enqueue_study_reminders
-- pattern): once per local day per institution with the exams module on and
-- an exam still in marks entry whose due date is at most 2 days away (or
-- passed), enqueue `notify.marks_reminders`. The handler decides who is
-- missing marks; a paper set that is complete sends nothing.
-- ---------------------------------------------------------------------------

create function public.enqueue_marks_reminders()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_institution record;
  v_count int := 0;
begin
  for v_institution in
    select i.id, coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata') as tz
    from public.institutions i
    where app.module_enabled(i.id, 'exams')
      and exists (
        select 1
        from public.exams x
        where x.institution_id = i.id
          and x.status = 'marks_entry'
          and x.marks_due_on is not null
          and x.marks_due_on - 2 <= (now() at time zone coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata'))::date
      )
  loop
    perform app.enqueue_job(
      v_institution.id,
      'notify.marks_reminders',
      '{}'::jsonb,
      'notify.marks_reminders:' || v_institution.id || ':' || to_char((now() at time zone v_institution.tz)::date, 'YYYYMMDD')
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.enqueue_marks_reminders() from public, anon, authenticated;
grant execute on function public.enqueue_marks_reminders() to service_role;
