-- Exact dashboard aggregates. PostgREST caps one response at max_rows (1000), so
-- client-side counting over selected rows silently truncated on large schools.
-- Every function is security invoker (the caller's RLS still applies), takes the
-- institution as an argument, and is granted to authenticated only.

create function public.dash_admissions_counts(p_institution_id uuid, p_academic_year_id uuid default null)
returns table (kind text, status text, n bigint)
language sql stable security invoker set search_path = public, pg_temp as $$
  select 'enquiry'::text, e.status, count(*) from public.enquiries e
   where e.institution_id = p_institution_id group by e.status
  union all
  select 'application'::text, a.status, count(*) from public.applications a
   where a.institution_id = p_institution_id
     and (p_academic_year_id is null or a.academic_year_id = p_academic_year_id)
   group by a.status;
$$;

create function public.dash_room_slot_counts(p_institution_id uuid, p_version_id uuid)
returns table (room_id uuid, n bigint, working_days bigint)
language sql stable security invoker set search_path = public, pg_temp as $$
  select s.room_id, count(*),
         (select count(distinct w.weekday) from public.timetable_slots w
           where w.institution_id = p_institution_id and w.version_id = p_version_id and w.room_id is not null)
    from public.timetable_slots s
   where s.institution_id = p_institution_id and s.version_id = p_version_id and s.room_id is not null
   group by s.room_id;
$$;

create function public.dash_section_headcounts(p_institution_id uuid)
returns table (class_section_id uuid, n bigint)
language sql stable security invoker set search_path = public, pg_temp as $$
  select e.class_section_id, count(*) from public.enrolments e
   where e.institution_id = p_institution_id and e.status = 'active'
   group by e.class_section_id;
$$;

create function public.dash_route_section_edges(p_institution_id uuid)
returns table (route_id uuid, class_section_id uuid)
language sql stable security invoker set search_path = public, pg_temp as $$
  select distinct t.route_id, e.class_section_id
    from public.transport_assignments t
    join public.enrolments e on e.student_id = t.student_id and e.institution_id = t.institution_id and e.status = 'active'
   where t.institution_id = p_institution_id;
$$;

create function public.dash_curriculum_unit_counts(p_institution_id uuid)
returns table (grade_id uuid, subject_id uuid, n bigint)
language sql stable security invoker set search_path = public, pg_temp as $$
  select u.grade_id, u.subject_id, count(*) from public.curriculum_units u
   where u.institution_id = p_institution_id group by u.grade_id, u.subject_id;
$$;

create function public.dash_curriculum_coverage_counts(p_institution_id uuid)
returns table (class_section_id uuid, subject_id uuid, n bigint)
language sql stable security invoker set search_path = public, pg_temp as $$
  select c.class_section_id, c.subject_id, count(*) from public.curriculum_unit_coverage c
   where c.institution_id = p_institution_id group by c.class_section_id, c.subject_id;
$$;

-- One row per domain with an open insight: open count, its top insight (severity,
-- then confidence desc, then oldest), and any-status creation counts for the
-- last 7 and previous 7 days.
create function public.dash_open_insight_domains(p_institution_id uuid, p_now timestamptz default now())
returns table (domain text, n bigint, top_id uuid, top_severity text, last7 bigint, prev7 bigint)
language sql stable security invoker set search_path = public, pg_temp as $$
  with open_rows as (
    select i.*, count(*) over (partition by i.domain) as total
      from public.insights i
     where i.institution_id = p_institution_id and i.status in ('new', 'reviewing', 'actioned')
  ), top as (
    select distinct on (o.domain) o.domain, o.total, o.id, o.severity
      from open_rows o
     order by o.domain,
              case o.severity when 'critical' then 3 when 'warning' then 2 when 'watch' then 1 else 0 end desc,
              o.confidence desc, o.created_at asc, o.id
  ), recent as (
    select r.domain,
           count(*) filter (where r.created_at > p_now - interval '7 days') as last7,
           count(*) filter (where r.created_at <= p_now - interval '7 days') as prev7
      from public.insights r
     where r.institution_id = p_institution_id
       and r.created_at > p_now - interval '14 days' and r.created_at <= p_now
     group by r.domain
  )
  select t.domain, t.total, t.id, t.severity, coalesce(c.last7, 0), coalesce(c.prev7, 0)
    from top t left join recent c on c.domain = t.domain;
$$;

revoke all on function public.dash_admissions_counts(uuid, uuid) from public, anon;
revoke all on function public.dash_room_slot_counts(uuid, uuid) from public, anon;
revoke all on function public.dash_section_headcounts(uuid) from public, anon;
revoke all on function public.dash_route_section_edges(uuid) from public, anon;
revoke all on function public.dash_curriculum_unit_counts(uuid) from public, anon;
revoke all on function public.dash_curriculum_coverage_counts(uuid) from public, anon;
revoke all on function public.dash_open_insight_domains(uuid, timestamptz) from public, anon;
grant execute on function public.dash_admissions_counts(uuid, uuid) to authenticated;
grant execute on function public.dash_room_slot_counts(uuid, uuid) to authenticated;
grant execute on function public.dash_section_headcounts(uuid) to authenticated;
grant execute on function public.dash_route_section_edges(uuid) to authenticated;
grant execute on function public.dash_curriculum_unit_counts(uuid) to authenticated;
grant execute on function public.dash_curriculum_coverage_counts(uuid) to authenticated;
grant execute on function public.dash_open_insight_domains(uuid, timestamptz) to authenticated;
