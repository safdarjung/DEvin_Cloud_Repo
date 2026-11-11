-- 0125 (features-18 §D) — Fabric "Analysis lab" aggregates. Functions only,
-- no tables. All four are `security invoker`, `stable`, `search_path = ''`:
-- the caller's RLS on every table read applies exactly as a normal PostgREST
-- select would (same reasoning as 0082/0109/0112), so no 07 §4 definer row.
-- Every table read is also filtered by p_institution_id.
--
-- Privacy (all four): aggregates only — no student names, no student ids.
-- Small-cell rule: any group built from fewer than 5 students is dropped
-- (or, in lab_section_anomalies, that one metric is nulled). Capped at 200
-- rows each.
--
-- Shared definitions (mirror existing readers, do not drift):
--   * Scope = the institution's current academic year (academic_years.is_current,
--     one per institution via academic_years_one_current_idx). Sections =
--     class_sections of that year; students = active enrolments in them.
--   * Attendance % = sum(counts_present) / count(in_denominator records) * 100,
--     weights read from institutions.settings.attendance.statuses — same
--     weighting as app.term_attendance_percentage (0009/0070), 0077, 0094.
--     Daily sessions only (period_id is null), submitted sessions only (as
--     0094). `OL` (on leave) is whatever the school configured; the default
--     (core/schemas.ts) is counts_present 0, in_denominator true. Holidays
--     never have a session (0075/0084 block_attendance_on_holiday), so they
--     simply drop out of numerator and denominator.
--     The status list is expanded once per call (`codes` CTE, first entry wins
--     on a duplicate code, like the `limit 1` lateral in 0077/0070) and
--     hash-joined, instead of a per-row jsonb lateral.
--   * Mark % = sum(marks_obtained) / sum(max_marks) * 100 over current marks
--     (superseded_by is null), not absent, of exams with status 'published'
--     in the current year (published results only; a recheck after publish
--     supersedes the mark, so only the current version counts).
--   * Overdue invoice = status in ('issued','part_paid') and due_on <= today
--     (institution timezone) — 0077 report_fee_defaulters with
--     p_min_days_overdue 0 — plus total > paid_total (balance > 0). Invoices
--     counted = current-year, status <> 'cancelled'. Money out as integer
--     paise (lesson 8).
--
-- 1. lab_attendance_marks_correlation(p_institution_id uuid)
--    -> class_section_id uuid, grade text, section text, subject_id uuid,
--       subject text, n int, pearson_r numeric, avg_attendance_pct numeric,
--       avg_mark_pct numeric
--    One row per section x subject. n = students with both an attendance %
--    and a mark % there; groups with n < 5 dropped. pearson_r = corr() of
--    per-student attendance % vs mark % (null when either has zero variance).
--
-- 2. lab_section_anomalies(p_institution_id uuid)
--    -> class_section_id uuid, grade text, section text, students int,
--       attendance_pct numeric, attendance_z numeric, avg_mark_pct numeric,
--       mark_z numeric, fee_overdue_rate numeric, fee_overdue_z numeric
--    One row per section with >= 5 active students. Each metric is nulled
--    when fewer than 5 students contribute to it. fee_overdue_rate = overdue
--    invoices / invoices * 100. z = (x - mean) / nullif(stddev_pop, 0), mean
--    and SD taken across the returned sections (unweighted).
--
-- 3. lab_fee_risk_cohorts(p_institution_id uuid)
--    -> grade_id uuid, grade text, attendance_band text, students int,
--       invoices int, overdue_invoices int, overdue_paise bigint,
--       avg_days_overdue numeric
--    One row per grade x attendance band; cohorts with < 5 students dropped.
--    Band per student from settings.attendance.alert_thresholds (defaults
--    critical 75, warn 80): 'critical' (< critical), 'warning' (< warn),
--    'ok', 'no_data' (no attendance yet). avg_days_overdue = mean of
--    (today - due_on) over overdue invoices.
--
-- 4. lab_trend_breaks(p_institution_id uuid)
--    -> class_section_id uuid, grade text, section text, students int,
--       recent_weeks int, prior_weeks int, recent_pct numeric,
--       prior_pct numeric, delta_pct numeric, weekly_sd numeric,
--       is_break boolean
--    Weekly attendance % per section over the last 12 complete weeks (ISO
--    weeks, current partial week excluded). recent = last 4 weeks, prior =
--    the 8 before (both pooled). weekly_sd = stddev_pop of the prior weeks'
--    weekly %. is_break = prior_weeks >= 4 and delta < -greatest(2 *
--    weekly_sd, 5) (5 = minimum drop in percentage points). Only records of
--    students actively enrolled in the section count; a week with < 5
--    contributing students is dropped, and sections with < 5 active students
--    are dropped. Breaks first, biggest drop first.
--
-- Planner: every function runs with enable_nestloop = off. A SQL function is
-- planned without its parameter value (generic plan), and the RLS quals on
-- these tables (OR of hashed subplans, per-row app.is_member/has_role) push
-- every row estimate to ~1. The planner then nested-loops over CTE scans and
-- re-runs per-row RLS functions inside the loop: lab_attendance_marks_correlation
-- took 6.6 s as principal on the demo tenant (subjects' app.is_member ran per
-- joined row, the roster CTE was rescanned 22k times). These are whole-tenant
-- aggregates where hash joins are always the right shape; a cross join or
-- lateral still uses a nested loop when nothing else can. RLS is unchanged.
--
-- Indexes serving these (all pre-existing): attendance_sessions_class_section_idx
-- and attendance_sessions_institution_date_idx (sessions), attendance_records_session_id_idx
-- (records by session), enrolments_section_status_idx (roster),
-- exam_papers_exam_id_idx + exams_institution_id_idx (papers),
-- marks_current_idx (exam_paper_id, student_id) where superseded_by is null,
-- invoices_institution_id_idx / invoices_student_id_idx (invoices),
-- academic_years_one_current_idx (current year).

-- ---------------------------------------------------------------------------
-- 1. lab_attendance_marks_correlation
-- ---------------------------------------------------------------------------
create function public.lab_attendance_marks_correlation(p_institution_id uuid)
returns table (
  class_section_id uuid,
  grade text,
  section text,
  subject_id uuid,
  subject text,
  n int,
  pearson_r numeric,
  avg_attendance_pct numeric,
  avg_mark_pct numeric
)
language sql
stable
security invoker
set search_path = ''
set enable_nestloop = off
as $$
  with inst as (
    select coalesce(i.settings -> 'attendance' -> 'statuses', '[]'::jsonb) as statuses
    from public.institutions i
    where i.id = p_institution_id
  ),
  codes as (
    select distinct on (e.elem ->> 'code')
      e.elem ->> 'code' as code,
      coalesce((e.elem ->> 'in_denominator')::boolean, false) as in_denom,
      coalesce((e.elem ->> 'counts_present')::numeric, 0) as present_w
    from inst
    cross join lateral jsonb_array_elements(inst.statuses) with ordinality as e(elem, ord)
    order by e.elem ->> 'code', e.ord
  ),
  yr as (
    select ay.id
    from public.academic_years ay
    where ay.institution_id = p_institution_id
      and ay.is_current
  ),
  sections as (
    select cs.id as class_section_id, g.display_name as grade, g.sort_key, cs.name as section
    from public.class_sections cs
    join yr on yr.id = cs.academic_year_id
    join public.grades g on g.id = cs.grade_id and g.institution_id = p_institution_id
    where cs.institution_id = p_institution_id
  ),
  roster as (
    select e.student_id, e.class_section_id
    from public.enrolments e
    join sections sec on sec.class_section_id = e.class_section_id
    where e.institution_id = p_institution_id
      and e.status = 'active'
  ),
  student_att as (
    select r.class_section_id, r.student_id, sum(c.present_w) / count(*) * 100 as att_pct
    from roster r
    join public.attendance_sessions s on s.class_section_id = r.class_section_id
    join public.attendance_records ar on ar.session_id = s.id and ar.student_id = r.student_id
    join codes c on c.code = ar.status and c.in_denom
    where s.institution_id = p_institution_id
      and ar.institution_id = p_institution_id
      and s.period_id is null
      and s.status = 'submitted'
    group by r.class_section_id, r.student_id
  ),
  student_marks as (
    select p.class_section_id, p.subject_id, m.student_id, sum(m.marks_obtained) / sum(p.max_marks) * 100 as mark_pct
    from public.exams x
    join yr on yr.id = x.academic_year_id
    join public.exam_papers p on p.exam_id = x.id and p.institution_id = p_institution_id
    join public.marks m on m.exam_paper_id = p.id and m.institution_id = p_institution_id
    join roster r on r.class_section_id = p.class_section_id and r.student_id = m.student_id
    where x.institution_id = p_institution_id
      and x.status = 'published'
      and m.superseded_by is null
      and not m.is_absent
      and m.marks_obtained is not null
    group by p.class_section_id, p.subject_id, m.student_id
  )
  select
    sec.class_section_id,
    sec.grade,
    sec.section,
    sm.subject_id,
    sub.name as subject,
    count(*)::int as n,
    round(corr(sa.att_pct::float8, sm.mark_pct::float8)::numeric, 3) as pearson_r,
    round(avg(sa.att_pct), 2) as avg_attendance_pct,
    round(avg(sm.mark_pct), 2) as avg_mark_pct
  from student_marks sm
  join student_att sa on sa.class_section_id = sm.class_section_id and sa.student_id = sm.student_id
  join sections sec on sec.class_section_id = sm.class_section_id
  join public.subjects sub on sub.id = sm.subject_id and sub.institution_id = p_institution_id
  group by sec.class_section_id, sec.grade, sec.sort_key, sec.section, sm.subject_id, sub.name
  having count(*) >= 5
  order by sec.sort_key, sec.section, sub.name
  limit 200;
$$;

revoke execute on function public.lab_attendance_marks_correlation(uuid) from public, anon;
grant execute on function public.lab_attendance_marks_correlation(uuid) to authenticated;
comment on function public.lab_attendance_marks_correlation(uuid) is
  'Analysis lab (features-18 §D): per section x subject, Pearson r of student attendance % vs published mark %, current year. security invoker (RLS applies); aggregates only, groups with n < 5 dropped, max 200 rows.';

-- ---------------------------------------------------------------------------
-- 2. lab_section_anomalies
-- ---------------------------------------------------------------------------
create function public.lab_section_anomalies(p_institution_id uuid)
returns table (
  class_section_id uuid,
  grade text,
  section text,
  students int,
  attendance_pct numeric,
  attendance_z numeric,
  avg_mark_pct numeric,
  mark_z numeric,
  fee_overdue_rate numeric,
  fee_overdue_z numeric
)
language sql
stable
security invoker
set search_path = ''
set enable_nestloop = off
as $$
  with inst as (
    select
      (now() at time zone coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata'))::date as today,
      coalesce(i.settings -> 'attendance' -> 'statuses', '[]'::jsonb) as statuses
    from public.institutions i
    where i.id = p_institution_id
  ),
  codes as (
    select distinct on (e.elem ->> 'code')
      e.elem ->> 'code' as code,
      coalesce((e.elem ->> 'in_denominator')::boolean, false) as in_denom,
      coalesce((e.elem ->> 'counts_present')::numeric, 0) as present_w
    from inst
    cross join lateral jsonb_array_elements(inst.statuses) with ordinality as e(elem, ord)
    order by e.elem ->> 'code', e.ord
  ),
  yr as (
    select ay.id
    from public.academic_years ay
    where ay.institution_id = p_institution_id
      and ay.is_current
  ),
  sections as (
    select cs.id as class_section_id, g.display_name as grade, g.sort_key, cs.name as section
    from public.class_sections cs
    join yr on yr.id = cs.academic_year_id
    join public.grades g on g.id = cs.grade_id and g.institution_id = p_institution_id
    where cs.institution_id = p_institution_id
  ),
  roster as (
    select e.student_id, e.class_section_id
    from public.enrolments e
    join sections sec on sec.class_section_id = e.class_section_id
    where e.institution_id = p_institution_id
      and e.status = 'active'
  ),
  section_size as (
    select r.class_section_id, count(*) as n
    from roster r
    group by r.class_section_id
  ),
  section_att as (
    select r.class_section_id, count(distinct r.student_id) as n, sum(c.present_w) / count(*) * 100 as pct
    from roster r
    join public.attendance_sessions s on s.class_section_id = r.class_section_id
    join public.attendance_records ar on ar.session_id = s.id and ar.student_id = r.student_id
    join codes c on c.code = ar.status and c.in_denom
    where s.institution_id = p_institution_id
      and ar.institution_id = p_institution_id
      and s.period_id is null
      and s.status = 'submitted'
    group by r.class_section_id
  ),
  section_marks as (
    select p.class_section_id, count(distinct m.student_id) as n, sum(m.marks_obtained) / sum(p.max_marks) * 100 as pct
    from public.exams x
    join yr on yr.id = x.academic_year_id
    join public.exam_papers p on p.exam_id = x.id and p.institution_id = p_institution_id
    join public.marks m on m.exam_paper_id = p.id and m.institution_id = p_institution_id
    join roster r on r.class_section_id = p.class_section_id and r.student_id = m.student_id
    where x.institution_id = p_institution_id
      and x.status = 'published'
      and m.superseded_by is null
      and not m.is_absent
      and m.marks_obtained is not null
    group by p.class_section_id
  ),
  section_fees as (
    select
      r.class_section_id,
      count(distinct inv.student_id) as n,
      count(*) as invoices,
      count(*) filter (
        where inv.status in ('issued', 'part_paid')
          and inv.due_on <= inst.today
          and inv.total > inv.paid_total
      ) as overdue
    from roster r
    join public.invoices inv on inv.student_id = r.student_id
    join yr on yr.id = inv.academic_year_id
    cross join inst
    where inv.institution_id = p_institution_id
      and inv.status <> 'cancelled'
    group by r.class_section_id
  ),
  metrics as (
    select
      sec.class_section_id,
      sec.grade,
      sec.sort_key,
      sec.section,
      ss.n as students,
      case when sa.n >= 5 then sa.pct end as attendance_pct,
      case when sm.n >= 5 then sm.pct end as mark_pct,
      case when sf.n >= 5 then sf.overdue::numeric / sf.invoices * 100 end as overdue_rate
    from sections sec
    join section_size ss on ss.class_section_id = sec.class_section_id
    left join section_att sa on sa.class_section_id = sec.class_section_id
    left join section_marks sm on sm.class_section_id = sec.class_section_id
    left join section_fees sf on sf.class_section_id = sec.class_section_id
    where ss.n >= 5
  )
  select
    mt.class_section_id,
    mt.grade,
    mt.section,
    mt.students::int,
    round(mt.attendance_pct, 2) as attendance_pct,
    round((mt.attendance_pct - avg(mt.attendance_pct) over ()) / nullif(stddev_pop(mt.attendance_pct) over (), 0), 2) as attendance_z,
    round(mt.mark_pct, 2) as avg_mark_pct,
    round((mt.mark_pct - avg(mt.mark_pct) over ()) / nullif(stddev_pop(mt.mark_pct) over (), 0), 2) as mark_z,
    round(mt.overdue_rate, 2) as fee_overdue_rate,
    round((mt.overdue_rate - avg(mt.overdue_rate) over ()) / nullif(stddev_pop(mt.overdue_rate) over (), 0), 2) as fee_overdue_z
  from metrics mt
  order by mt.sort_key, mt.section
  limit 200;
$$;

revoke execute on function public.lab_section_anomalies(uuid) from public, anon;
grant execute on function public.lab_section_anomalies(uuid) to authenticated;
comment on function public.lab_section_anomalies(uuid) is
  'Analysis lab (features-18 §D): per section attendance %, published mark %, fee overdue rate, each with a z-score vs the mean across sections, current year. security invoker (RLS applies); sections with < 5 students dropped, a metric with < 5 contributing students nulled, max 200 rows.';

-- ---------------------------------------------------------------------------
-- 3. lab_fee_risk_cohorts
-- ---------------------------------------------------------------------------
create function public.lab_fee_risk_cohorts(p_institution_id uuid)
returns table (
  grade_id uuid,
  grade text,
  attendance_band text,
  students int,
  invoices int,
  overdue_invoices int,
  overdue_paise bigint,
  avg_days_overdue numeric
)
language sql
stable
security invoker
set search_path = ''
set enable_nestloop = off
as $$
  with inst as (
    select
      (now() at time zone coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata'))::date as today,
      coalesce(i.settings -> 'attendance' -> 'statuses', '[]'::jsonb) as statuses,
      coalesce((i.settings -> 'attendance' -> 'alert_thresholds' ->> 'critical')::numeric, 75) as critical,
      coalesce((i.settings -> 'attendance' -> 'alert_thresholds' ->> 'warn')::numeric, 80) as warn
    from public.institutions i
    where i.id = p_institution_id
  ),
  codes as (
    select distinct on (e.elem ->> 'code')
      e.elem ->> 'code' as code,
      coalesce((e.elem ->> 'in_denominator')::boolean, false) as in_denom,
      coalesce((e.elem ->> 'counts_present')::numeric, 0) as present_w
    from inst
    cross join lateral jsonb_array_elements(inst.statuses) with ordinality as e(elem, ord)
    order by e.elem ->> 'code', e.ord
  ),
  yr as (
    select ay.id
    from public.academic_years ay
    where ay.institution_id = p_institution_id
      and ay.is_current
  ),
  sections as (
    select cs.id as class_section_id, g.id as grade_id, g.display_name as grade, g.sort_key
    from public.class_sections cs
    join yr on yr.id = cs.academic_year_id
    join public.grades g on g.id = cs.grade_id and g.institution_id = p_institution_id
    where cs.institution_id = p_institution_id
  ),
  roster as (
    select e.student_id, e.class_section_id
    from public.enrolments e
    join sections sec on sec.class_section_id = e.class_section_id
    where e.institution_id = p_institution_id
      and e.status = 'active'
  ),
  student_att as (
    select r.student_id, sum(c.present_w) / count(*) * 100 as att_pct
    from roster r
    join public.attendance_sessions s on s.class_section_id = r.class_section_id
    join public.attendance_records ar on ar.session_id = s.id and ar.student_id = r.student_id
    join codes c on c.code = ar.status and c.in_denom
    where s.institution_id = p_institution_id
      and ar.institution_id = p_institution_id
      and s.period_id is null
      and s.status = 'submitted'
    group by r.student_id
  ),
  student_band as (
    select
      r.student_id,
      sec.grade_id,
      sec.grade,
      sec.sort_key,
      case
        when sa.att_pct is null then 'no_data'
        when sa.att_pct < inst.critical then 'critical'
        when sa.att_pct < inst.warn then 'warning'
        else 'ok'
      end as band
    from roster r
    join sections sec on sec.class_section_id = r.class_section_id
    cross join inst
    left join student_att sa on sa.student_id = r.student_id
  ),
  student_fees as (
    select
      inv.student_id,
      count(*) as invoices,
      count(*) filter (where od.is_overdue) as overdue_invoices,
      sum(inv.total - inv.paid_total) filter (where od.is_overdue) as overdue_amount,
      sum(inst.today - inv.due_on) filter (where od.is_overdue) as overdue_days
    from public.invoices inv
    join yr on yr.id = inv.academic_year_id
    cross join inst
    cross join lateral (
      select (inv.status in ('issued', 'part_paid') and inv.due_on <= inst.today and inv.total > inv.paid_total) as is_overdue
    ) od
    where inv.institution_id = p_institution_id
      and inv.status <> 'cancelled'
    group by inv.student_id
  )
  select
    sb.grade_id,
    sb.grade,
    sb.band as attendance_band,
    count(*)::int as students,
    coalesce(sum(sf.invoices), 0)::int as invoices,
    coalesce(sum(sf.overdue_invoices), 0)::int as overdue_invoices,
    round(coalesce(sum(sf.overdue_amount), 0) * 100)::bigint as overdue_paise,
    round(sum(sf.overdue_days)::numeric / nullif(sum(sf.overdue_invoices), 0), 1) as avg_days_overdue
  from student_band sb
  left join student_fees sf on sf.student_id = sb.student_id
  group by sb.grade_id, sb.grade, sb.sort_key, sb.band
  having count(*) >= 5
  order by
    sb.sort_key,
    case sb.band when 'critical' then 1 when 'warning' then 2 when 'ok' then 3 else 4 end
  limit 200;
$$;

revoke execute on function public.lab_fee_risk_cohorts(uuid) from public, anon;
grant execute on function public.lab_fee_risk_cohorts(uuid) to authenticated;
comment on function public.lab_fee_risk_cohorts(uuid) is
  'Analysis lab (features-18 §D): per grade x attendance band (settings alert thresholds), current-year invoices, overdue count, overdue paise, avg days overdue. security invoker (RLS applies); cohorts with < 5 students dropped, max 200 rows.';

-- ---------------------------------------------------------------------------
-- 4. lab_trend_breaks
-- ---------------------------------------------------------------------------
create function public.lab_trend_breaks(p_institution_id uuid)
returns table (
  class_section_id uuid,
  grade text,
  section text,
  students int,
  recent_weeks int,
  prior_weeks int,
  recent_pct numeric,
  prior_pct numeric,
  delta_pct numeric,
  weekly_sd numeric,
  is_break boolean
)
language sql
stable
security invoker
set search_path = ''
set enable_nestloop = off
as $$
  with inst as (
    select
      date_trunc('week', (now() at time zone coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata'))::date)::date as this_week,
      coalesce(i.settings -> 'attendance' -> 'statuses', '[]'::jsonb) as statuses
    from public.institutions i
    where i.id = p_institution_id
  ),
  codes as (
    select distinct on (e.elem ->> 'code')
      e.elem ->> 'code' as code,
      coalesce((e.elem ->> 'in_denominator')::boolean, false) as in_denom,
      coalesce((e.elem ->> 'counts_present')::numeric, 0) as present_w
    from inst
    cross join lateral jsonb_array_elements(inst.statuses) with ordinality as e(elem, ord)
    order by e.elem ->> 'code', e.ord
  ),
  yr as (
    select ay.id
    from public.academic_years ay
    where ay.institution_id = p_institution_id
      and ay.is_current
  ),
  sections as (
    select cs.id as class_section_id, g.display_name as grade, g.sort_key, cs.name as section
    from public.class_sections cs
    join yr on yr.id = cs.academic_year_id
    join public.grades g on g.id = cs.grade_id and g.institution_id = p_institution_id
    where cs.institution_id = p_institution_id
  ),
  section_size as (
    select e.class_section_id, count(*) as n
    from public.enrolments e
    join sections sec on sec.class_section_id = e.class_section_id
    where e.institution_id = p_institution_id
      and e.status = 'active'
    group by e.class_section_id
  ),
  weekly as (
    select
      s.class_section_id,
      date_trunc('week', s.date)::date as week_start,
      sum(c.present_w) / count(*) * 100 as pct,
      sum(c.present_w) as present,
      count(*) as denom
    from public.attendance_sessions s
    join sections sec on sec.class_section_id = s.class_section_id
    join public.attendance_records ar on ar.session_id = s.id and ar.institution_id = p_institution_id
    join public.enrolments e
      on e.student_id = ar.student_id
      and e.class_section_id = s.class_section_id
      and e.status = 'active'
      and e.institution_id = p_institution_id
    join codes c on c.code = ar.status and c.in_denom
    cross join inst
    where s.institution_id = p_institution_id
      and s.period_id is null
      and s.status = 'submitted'
      and s.date >= inst.this_week - 84
      and s.date < inst.this_week
    group by s.class_section_id, date_trunc('week', s.date)::date
    -- Small-cell rule: a week built from fewer than 5 contributing students is dropped.
    having count(distinct ar.student_id) >= 5
  ),
  per_section as (
    select
      w.class_section_id,
      count(*) filter (where w.week_start >= inst.this_week - 28) as recent_weeks,
      count(*) filter (where w.week_start < inst.this_week - 28) as prior_weeks,
      sum(w.present) filter (where w.week_start >= inst.this_week - 28)
        / nullif(sum(w.denom) filter (where w.week_start >= inst.this_week - 28), 0) * 100 as recent_pct,
      sum(w.present) filter (where w.week_start < inst.this_week - 28)
        / nullif(sum(w.denom) filter (where w.week_start < inst.this_week - 28), 0) * 100 as prior_pct,
      stddev_pop(w.pct) filter (where w.week_start < inst.this_week - 28) as weekly_sd
    from weekly w
    cross join inst
    group by w.class_section_id
  ),
  -- 5 = minimum drop in percentage points, so a near-flat prior SD cannot flag noise.
  flagged as (
    select
      ps.*,
      coalesce(ps.prior_weeks >= 4 and ps.recent_pct - ps.prior_pct < -greatest(2 * ps.weekly_sd, 5), false) as is_break
    from per_section ps
  )
  select
    sec.class_section_id,
    sec.grade,
    sec.section,
    ss.n::int as students,
    ps.recent_weeks::int,
    ps.prior_weeks::int,
    round(ps.recent_pct, 2) as recent_pct,
    round(ps.prior_pct, 2) as prior_pct,
    round(ps.recent_pct - ps.prior_pct, 2) as delta_pct,
    round(ps.weekly_sd, 2) as weekly_sd,
    ps.is_break
  from flagged ps
  join sections sec on sec.class_section_id = ps.class_section_id
  join section_size ss on ss.class_section_id = ps.class_section_id
  where ss.n >= 5
  order by
    ps.is_break desc,
    ps.recent_pct - ps.prior_pct asc nulls last,
    sec.sort_key,
    sec.section
  limit 200;
$$;

revoke execute on function public.lab_trend_breaks(uuid) from public, anon;
grant execute on function public.lab_trend_breaks(uuid) to authenticated;
comment on function public.lab_trend_breaks(uuid) is
  'Analysis lab (features-18 §D): per section, last-4-weeks vs prior-8-weeks attendance % (12 complete weeks), delta, and a break flag when the drop exceeds max(2 SD of the prior weeks'' weekly %, 5 points). security invoker (RLS applies); active-enrolment records only; weeks with < 5 contributing students and sections with < 5 students dropped, max 200 rows.';
