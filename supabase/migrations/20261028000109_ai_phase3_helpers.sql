-- T8 phase 3 (ai-roles P4, DB owner) — exams.markOutliers deterministic
-- query. `security invoker`: marks/exam_papers/results RLS (0009/0020)
-- already scopes every row exactly as a normal PostgREST select would —
-- same reasoning as 0082's ledger_totals/term_collection_totals. Needed
-- because an exam's `marks` rows can run well past PostgREST's
-- `max_rows = 1000` (supabase/config.toml), so the three outlier scans
-- (marks above paper max, >=25-point subject percentage drop vs the
-- student's previous published exam in that subject, section paper average
-- >=2 population-SD from the exam's paper mean) must run in SQL, not after
-- a truncated TS-side fetch.
--
-- No student/section/subject names returned here — only ids. A caller
-- already holding RLS-scoped access resolves names via its own normal
-- selects if it wants them (same split exams/queries.ts uses for
-- hydrateResultRow), so this function never discloses more than the
-- caller's RLS already shows elsewhere. Capped at 50 rows total (<=20 per
-- outlier kind) per the P4 packet.

create function public.exam_mark_outliers(p_institution_id uuid, p_exam_id uuid)
returns table (
  outlier_type text,
  student_id uuid,
  exam_paper_id uuid,
  subject_id uuid,
  class_section_id uuid,
  details jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with current_marks as (
    select
      m.student_id,
      m.exam_paper_id,
      p.subject_id,
      p.class_section_id,
      m.marks_obtained,
      p.max_marks
    from public.marks m
    join public.exam_papers p on p.id = m.exam_paper_id
    where p.exam_id = p_exam_id
      and p.institution_id = p_institution_id
      and m.institution_id = p_institution_id
      and m.superseded_by is null
      and m.is_absent = false
      and m.marks_obtained is not null
  ),
  above_max as (
    select
      'above_max'::text as outlier_type,
      cm.student_id,
      cm.exam_paper_id,
      cm.subject_id,
      cm.class_section_id,
      jsonb_build_object('marksObtained', cm.marks_obtained, 'maxMarks', cm.max_marks) as details
    from current_marks cm
    where cm.marks_obtained > cm.max_marks
    limit 20
  ),
  -- Previous published result for the same student + subject (any other
  -- exam), most recent by published_at, pulled from `results.snapshot`
  -- (0009's `{ subjects: [{ subject_id, marks_obtained, max_marks, ... }] }`
  -- shape) via a per-row LATERAL — results aren't normalised per subject.
  previous_subject as (
    select
      cm.student_id,
      cm.exam_paper_id,
      cm.subject_id,
      cm.class_section_id,
      cm.marks_obtained,
      cm.max_marks,
      prev.previous_exam_id,
      prev.previous_marks_obtained,
      prev.previous_max_marks
    from current_marks cm
    left join lateral (
      select
        r.exam_id as previous_exam_id,
        (subj ->> 'marks_obtained')::numeric as previous_marks_obtained,
        (subj ->> 'max_marks')::numeric as previous_max_marks
      from public.results r
      cross join lateral jsonb_array_elements(r.snapshot -> 'subjects') as subj
      where r.student_id = cm.student_id
        and r.institution_id = p_institution_id
        and r.exam_id <> p_exam_id
        and r.superseded_by is null
        and (subj ->> 'subject_id')::uuid = cm.subject_id
        and (subj ->> 'marks_obtained') is not null
      order by r.published_at desc
      limit 1
    ) prev on true
  ),
  percentage_drop as (
    select
      'percentage_drop'::text as outlier_type,
      ps.student_id,
      ps.exam_paper_id,
      ps.subject_id,
      ps.class_section_id,
      jsonb_build_object(
        'currentPercentage', round(ps.marks_obtained / ps.max_marks * 100, 2),
        'previousPercentage', round(ps.previous_marks_obtained / ps.previous_max_marks * 100, 2),
        'previousExamId', ps.previous_exam_id
      ) as details
    from previous_subject ps
    where ps.previous_exam_id is not null
      and ps.max_marks > 0
      and ps.previous_max_marks > 0
      and (ps.previous_marks_obtained / ps.previous_max_marks * 100) - (ps.marks_obtained / ps.max_marks * 100) >= 25
    limit 20
  ),
  paper_stats as (
    select
      exam_paper_id,
      subject_id,
      class_section_id,
      avg(marks_obtained / max_marks * 100) as avg_pct
    from current_marks
    where max_marks > 0
    group by exam_paper_id, subject_id, class_section_id
  ),
  exam_stats as (
    select avg(avg_pct) as mean_pct, stddev_pop(avg_pct) as stddev_pct from paper_stats
  ),
  section_outliers as (
    select
      'section_average'::text as outlier_type,
      null::uuid as student_id,
      ps.exam_paper_id,
      ps.subject_id,
      ps.class_section_id,
      jsonb_build_object(
        'sectionAveragePercentage', round(ps.avg_pct, 2),
        'examMeanPercentage', round(es.mean_pct, 2),
        'examStddevPercentage', round(es.stddev_pct, 2)
      ) as details
    from paper_stats ps
    cross join exam_stats es
    where es.stddev_pct > 0
      and abs(ps.avg_pct - es.mean_pct) >= 2 * es.stddev_pct
    limit 20
  )
  select * from above_max
  union all
  select * from percentage_drop
  union all
  select * from section_outliers
  limit 50;
$$;

revoke execute on function public.exam_mark_outliers(uuid, uuid) from public, anon;
grant execute on function public.exam_mark_outliers(uuid, uuid) to authenticated;
comment on function public.exam_mark_outliers(uuid, uuid) is
  'AI roles P4 (exams.markOutliers): deterministic outlier scan for one exam -- marks above paper max, >=25-point subject percentage drop vs the student''s previous published exam, section paper average >=2 population-SD from the exam''s paper mean. security invoker -- RLS on marks/exam_papers (exam_write_roles + assigned teacher) and results (exam_roles + scoped teacher/guardian/student) scopes every row exactly as a normal PostgREST select would; no names returned. Capped at 50 rows (<=20 per kind) -- marks tables can run past PostgREST''s 1000-row max_rows.';
