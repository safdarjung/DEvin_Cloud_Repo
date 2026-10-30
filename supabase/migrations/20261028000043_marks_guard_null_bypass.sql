-- T-042 fix round 2 (review MED): `app.marks_guard` built its bypass as
-- `... or current_setting('app.allow_marks_revision', true) = 'on'`. On a
-- pooled connection that never set that GUC the term is NULL, so `v_bypass`
-- became NULL and `if not v_bypass and ...` never raised — the
-- published/draft-exam check silently stopped applying (same class as 0042).
-- `create or replace` from the live definition (0041) with
-- `coalesce(..., '')`; nothing else changes.

CREATE OR REPLACE FUNCTION app.marks_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_max_marks numeric(6, 2);
  v_exam_status text;
  v_bypass boolean;
  v_target public.marks;
begin
  if current_setting('app.allow_reset', true) = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'code:invalid_state' using detail = 'marks rows are never deleted; supersede instead';
  end if;

  select e.status into v_exam_status
  from public.exam_papers p
  join public.exams e on e.id = p.exam_id
  where p.id = coalesce(new.exam_paper_id, old.exam_paper_id);

  v_bypass := (
    coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
    or coalesce(current_setting('app.allow_marks_revision', true), '') = 'on'
  );

  if not v_bypass and v_exam_status not in ('marks_entry', 'verification') then
    raise exception 'code:invalid_state' using detail = format('marks cannot be entered or revised while the exam is %s', v_exam_status);
  end if;

  if tg_op = 'UPDATE' then
    if old.superseded_by is not null
      or new.exam_paper_id is distinct from old.exam_paper_id
      or new.student_id is distinct from old.student_id
      or new.marks_obtained is distinct from old.marks_obtained
      or new.is_absent is distinct from old.is_absent
      or new.version_no is distinct from old.version_no
      or new.source is distinct from old.source
      or new.entered_by is distinct from old.entered_by
      or new.created_at is distinct from old.created_at
      or new.superseded_by is null
    then
      raise exception 'code:invalid_state' using detail = 'marks rows are immutable; only superseded_by may be set once';
    end if;

    select * into v_target from public.marks where id = new.superseded_by;

    if v_target.id is null
      or v_target.exam_paper_id is distinct from old.exam_paper_id
      or v_target.student_id is distinct from old.student_id
      or v_target.institution_id is distinct from old.institution_id
      or v_target.superseded_by is not null
      or v_target.created_at <= old.created_at
    then
      raise exception 'code:invalid_state' using detail = 'superseded_by must reference the current, later marks row for the same paper, student and institution';
    end if;

    return new;
  end if;

  -- INSERT
  if not new.is_absent then
    select max_marks into v_max_marks from public.exam_papers where id = new.exam_paper_id;
    if v_max_marks is null then
      raise exception 'code:not_found' using detail = 'exam paper not found';
    end if;
    if new.marks_obtained is null or new.marks_obtained < 0 or new.marks_obtained > v_max_marks then
      raise exception 'code:validation_failed' using detail = format('marks_obtained must be between 0 and %s', v_max_marks);
    end if;
  end if;

  return new;
end;
$function$

;
