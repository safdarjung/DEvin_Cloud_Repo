-- Hosted PostgREST statement_timeout (57014) on fabric/students and fabric/twin.
-- Both read attendance_records through RLS (OR of hashed subplans). Without
-- enable_nestloop = off the generic plan can nest-loop with per-row RLS (see 0125 header).
-- 1. attendance_daily_counts (twin section heat, dashboards): same planner pin the lab functions use.
-- 2. mastery_section_attendance: one grouped call replaces the student-success roster's paged
--    attendance_records reads (4+ full RLS scans of the table per section view, plus a huge IN list).

alter function public.attendance_daily_counts(uuid, date, date, uuid, uuid, boolean) set enable_nestloop = off;

create function public.mastery_section_attendance(p_class_section_id uuid, p_from date, p_to date)
returns table (student_id uuid, status text, n bigint)
language sql
stable
security invoker
set search_path = ''
set enable_nestloop = off
as $$
  select r.student_id, r.status, count(*) as n
  from public.attendance_sessions s
  join public.attendance_records r on r.session_id = s.id
  where s.class_section_id = p_class_section_id
    and s.period_id is null
    and s.date between p_from and p_to
  group by r.student_id, r.status;
$$;

revoke execute on function public.mastery_section_attendance(uuid, date, date) from public, anon;
grant execute on function public.mastery_section_attendance(uuid, date, date) to authenticated;
