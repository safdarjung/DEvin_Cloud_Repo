-- 0111 (DBT-153) — chunked compute_mastery.
-- compute_mastery gains optional p_class_section_id / p_run_at. With a section it
-- upserts only that section's students and skips the stale-row delete; the job
-- handler calls it once per section (one short statement each, so no
-- PostgREST statement_timeout on a large school) with a shared p_run_at, then
-- compute_mastery_sweep deletes rows no section touched (unit unmapped, mark
-- superseded, student withdrawn). Old one-arg calls (seed, tests) behave as in
-- 0104. A retry restarts with a new run_at: upserts are idempotent.

drop function public.compute_mastery(uuid);

create function public.compute_mastery(
  p_institution_id uuid,
  p_class_section_id uuid default null,
  p_run_at timestamptz default null
)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_year_id uuid;
  v_run_at timestamptz := coalesce(p_run_at, now());
  v_count int;
begin
  select id into v_year_id
  from public.academic_years
  where institution_id = p_institution_id and is_current;

  if v_year_id is null then
    return 0;
  end if;

  with observations as (
    select
      m.student_id,
      cu.id as curriculum_unit_id,
      cu.subject_id,
      least(1, greatest(0, m.marks_obtained / ep.max_marks)) as s,
      2 as w,
      'mark'::text as src,
      m.id as src_id,
      coalesce(ep.held_on, ex.published_at::date) as on_date
    from public.marks m
    join public.exam_papers ep on ep.id = m.exam_paper_id and ep.institution_id = p_institution_id
    join public.exams ex on ex.id = ep.exam_id and ex.institution_id = p_institution_id
    join lateral unnest(ep.unit_ids) as unit_id(id) on true
    join public.curriculum_units cu on cu.id = unit_id.id and cu.institution_id = p_institution_id
    where m.institution_id = p_institution_id
      and m.superseded_by is null
      and not m.is_absent
      and m.marks_obtained is not null
      and cardinality(ep.unit_ids) > 0
      and ex.status = 'published'
      and ex.academic_year_id = v_year_id

    union all

    select
      asu.student_id,
      cu.id as curriculum_unit_id,
      cu.subject_id,
      least(1, greatest(0, asu.score / asu.max_score)) as s,
      1 as w,
      'submission'::text as src,
      asu.id as src_id,
      asu.graded_at::date as on_date
    from public.assignment_submissions asu
    join public.assignments a on a.id = asu.assignment_id and a.institution_id = p_institution_id
    join public.curriculum_units cu on cu.id = a.curriculum_unit_id and cu.institution_id = p_institution_id
    join public.class_sections cs on cs.id = a.class_section_id and cs.institution_id = p_institution_id
    where asu.institution_id = p_institution_id
      and asu.status = 'graded'
      and a.curriculum_unit_id is not null
      and cs.academic_year_id = v_year_id
  ),
  scoped as (
    select o.*, e.class_section_id
    from observations o
    join public.enrolments e
      on e.student_id = o.student_id
      and e.academic_year_id = v_year_id
      and e.status = 'active'
      and e.institution_id = p_institution_id
      and (p_class_section_id is null or e.class_section_id = p_class_section_id)
  ),
  ranked_evidence as (
    select
      scoped.*,
      row_number() over (
        partition by student_id, curriculum_unit_id
        order by on_date desc, src_id
      ) as rn
    from scoped
  ),
  aggregated as (
    select
      student_id,
      curriculum_unit_id,
      subject_id,
      class_section_id,
      round(sum(w * s) / sum(w), 3) as score,
      round(least(1, sum(w) / 4.0), 2) as confidence,
      count(*) filter (where src = 'mark') as mark_count,
      count(*) filter (where src = 'submission') as submission_count,
      jsonb_agg(
        jsonb_build_object('src', src, 'id', src_id, 'score', round(s, 3), 'w', w, 'on', on_date)
        order by on_date desc, src_id
      ) filter (where rn <= 50) as evidence
    from ranked_evidence
    -- subject_id/class_section_id are functionally determined by
    -- (student_id, curriculum_unit_id); see 0093.
    group by student_id, curriculum_unit_id, subject_id, class_section_id
  ),
  upserted as (
    insert into public.mastery_snapshots (
      institution_id, academic_year_id, student_id, class_section_id, subject_id, curriculum_unit_id,
      score, confidence, mark_count, submission_count, evidence, detector_version, computed_at
    )
    select
      p_institution_id, v_year_id, agg.student_id, agg.class_section_id, agg.subject_id, agg.curriculum_unit_id,
      agg.score, agg.confidence, agg.mark_count, agg.submission_count, agg.evidence, 'mastery_v1', v_run_at
    from aggregated agg
    on conflict (academic_year_id, student_id, curriculum_unit_id) do update set
      institution_id = excluded.institution_id,
      class_section_id = excluded.class_section_id,
      subject_id = excluded.subject_id,
      score = excluded.score,
      confidence = excluded.confidence,
      mark_count = excluded.mark_count,
      submission_count = excluded.submission_count,
      evidence = excluded.evidence,
      detector_version = excluded.detector_version,
      computed_at = excluded.computed_at
    returning 1
  )
  select count(*) into v_count from upserted;

  -- Whole-tenant call deletes stale rows itself; a per-section call leaves
  -- that to compute_mastery_sweep so other sections' rows survive.
  if p_class_section_id is null then
    delete from public.mastery_snapshots
    where institution_id = p_institution_id
      and academic_year_id = v_year_id
      and computed_at < v_run_at;
  end if;

  return v_count;
end;
$$;

revoke execute on function public.compute_mastery(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.compute_mastery(uuid, uuid, timestamptz) to service_role;

create function public.compute_mastery_sweep(p_institution_id uuid, p_run_at timestamptz)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count int;
begin
  with gone as (
    delete from public.mastery_snapshots ms
    using public.academic_years ay
    where ay.id = ms.academic_year_id
      and ay.institution_id = p_institution_id
      and ay.is_current
      and ms.institution_id = p_institution_id
      and ms.computed_at < p_run_at
    returning 1
  )
  select count(*) into v_count from gone;
  return v_count;
end;
$$;

revoke execute on function public.compute_mastery_sweep(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.compute_mastery_sweep(uuid, timestamptz) to service_role;
