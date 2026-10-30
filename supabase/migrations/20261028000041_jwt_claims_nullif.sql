-- T-042 fix round 1 / DBT-34: these guards (0009 marks_guard, 0016
-- guard_application_decision / guard_enquiry_mutation / staff_in_institution,
-- 0018 guard_exam_status, 0022 guard_recheck_request_status) cast
-- `current_setting('request.jwt.claims', true)` straight to jsonb. On a
-- reused postgres session that earlier set the claim transaction-locally,
-- the setting reads back as '' and the cast raises "invalid input syntax for
-- type json" before the `session_user = 'postgres'` bypass is reached.
-- `create or replace` of each, byte-for-byte from the live definitions except
-- `nullif(..., '')` around the setting. Signatures, security mode, search_path
-- and grants are unchanged.

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
    or current_setting('app.allow_marks_revision', true) = 'on'
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

CREATE OR REPLACE FUNCTION app.guard_application_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_bypass boolean;
begin
  v_bypass := (
    coalesce(current_setting('app.allow_decide', true), '') = 'on'
    or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  );

  if new.status is distinct from old.status
    and new.status in ('offered', 'accepted', 'rejected', 'withdrawn')
    and not v_bypass
  then
    raise exception 'code:invalid_state' using detail = 'applications.status may only move into offered/accepted/rejected/withdrawn through app.decide_application';
  end if;

  return new;
end;
$function$

;

CREATE OR REPLACE FUNCTION app.guard_enquiry_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_trusted boolean;
begin
  v_trusted := (
    coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  );

  if new.status = 'converted'
    and old.status is distinct from new.status
    and coalesce(current_setting('app.allow_convert', true), '') <> 'on'
    and not v_trusted
  then
    raise exception 'code:invalid_state' using detail = 'enquiries.status may only become converted through app.convert_enquiry';
  end if;

  if new.notes is distinct from old.notes
    and coalesce(current_setting('app.allow_notes', true), '') <> 'on'
    and not v_trusted
  then
    raise exception 'code:invalid_state' using detail = 'enquiries.notes is append-only; use app.add_enquiry_note';
  end if;

  return new;
end;
$function$

;

CREATE OR REPLACE FUNCTION app.guard_exam_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_bypass boolean;
begin
  if current_setting('app.allow_reset', true) = 'on' then
    return new;
  end if;

  if new.status is distinct from old.status then
    v_bypass := (
      coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
      or session_user = 'postgres'
      or coalesce(current_setting('app.allow_exam_status_change', true), '') = 'on'
    );

    if not v_bypass then
      raise exception 'code:invalid_state' using detail = format('exams.status may only move from %s through the exam workflow RPCs, not a direct update', old.status);
    end if;
  end if;

  return new;
end;
$function$

;

CREATE OR REPLACE FUNCTION app.guard_recheck_request_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_trusted boolean;
begin
  v_trusted := (
    coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  );

  if new.status is distinct from old.status and not v_trusted then
    if not (
      (old.status = 'submitted' and new.status = 'under_review')
      or (old.status = 'under_review' and new.status in ('approved', 'rejected', 'applied'))
    ) then
      raise exception 'code:invalid_state' using detail = format('recheck_requests.status cannot move from %s to %s directly', old.status, new.status);
    end if;
  end if;

  return new;
end;
$function$

;

CREATE OR REPLACE FUNCTION app.staff_in_institution(p_staff_id uuid, p_institution_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_trusted boolean;
begin
  v_trusted := (
    coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  );

  if not v_trusted and not app.is_member(p_institution_id) then
    return false;
  end if;

  return exists (select 1 from public.staff s where s.id = p_staff_id and s.institution_id = p_institution_id);
end;
$function$

;

