-- M16-T3: public.attendance_daily_counts — a daily-count aggregate for the
-- dashboard trend/summary reads (06 M16 rulings, "0078 is an aggregate, not
-- an approvals view"). `supabase/config.toml` `max_rows = 1000` silently
-- truncates row-level reads; the demo tenant marks ~2,500 students a day, so
-- a 42-day trend would be ~100k rows. This aggregate returns at most
-- 92 x statuses rows (or x sections x statuses for one day, by section).
--
-- SECURITY INVOKER (not definer): the only filter is RLS on
-- attendance_records/attendance_sessions (0006, teacher/guardian/student
-- scoping unchanged), exactly as a direct PostgREST read would be. No
-- `app` helper calls, so no 07 §4 definer row.

create function public.attendance_daily_counts(
  p_institution_id uuid,
  p_from date,
  p_to date,
  p_class_section_id uuid default null,
  p_student_id uuid default null,
  p_by_section boolean default false
)
returns table (date date, class_section_id uuid, status text, n bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_to < p_from or p_to - p_from > 91 then
    raise exception 'code:validation_failed' using detail = 'p_to must be on or after p_from, and the range must be at most 91 days';
  end if;

  return query
    select
      s.date,
      case when p_by_section then s.class_section_id else null::uuid end as class_section_id,
      r.status,
      count(*) as n
    from public.attendance_records r
    join public.attendance_sessions s on s.id = r.session_id
    where r.institution_id = p_institution_id
      and s.institution_id = p_institution_id
      and s.period_id is null
      and s.date between p_from and p_to
      and (p_class_section_id is null or s.class_section_id = p_class_section_id)
      and (p_student_id is null or r.student_id = p_student_id)
    group by s.date, (case when p_by_section then s.class_section_id else null::uuid end), r.status
    order by s.date;
end;
$$;

revoke execute on function public.attendance_daily_counts(uuid, date, date, uuid, uuid, boolean) from public, anon;
grant execute on function public.attendance_daily_counts(uuid, date, date, uuid, uuid, boolean) to authenticated;
