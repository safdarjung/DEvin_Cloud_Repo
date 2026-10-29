-- T-015 (lead ruling): submit_attendance / correct_attendance as atomic
-- `security definer` RPCs under `public` (same pattern as 0012's job
-- wrappers / 0013's record_audit_event — `app` is not PostgREST-exposed).
-- Each RPC is itself the authorization boundary (callable directly via
-- PostgREST), so the direct-write policies on 0006's three tables that let
-- a caller skip these checks are closed below: a session/record may only be
-- written directly while its session is `open`; a session's `status` may
-- never be set to or left at `submitted` by a direct UPDATE; and
-- `attendance_corrections` loses its direct INSERT policy entirely —
-- corrections are RPC-only (no replacement policy; RLS default-denies with
-- no matching policy, same as `audit_events`/`jobs` already do for INSERT).

-- ---------------------------------------------------------------------------
-- public.submit_attendance — 06 §W5. One atomic transition: session
-- open -> submitted, then one `notify.attendance_absence` job per record
-- whose configured status has `notify_guardian: true`. Idempotent per W5
-- ("resubmitting a submitted session is a no-op success"): an
-- already-submitted session returns immediately with no further writes —
-- no second audit row, no re-stamped submitted_at, and (redundantly with
-- app.enqueue_job's own idempotency key) no duplicate jobs.
-- ---------------------------------------------------------------------------
create function public.submit_attendance(p_institution_id uuid, p_session_id uuid)
returns public.attendance_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_session public.attendance_sessions;
  v_staff_id uuid;
  v_is_class_teacher boolean;
  v_record_count int;
  v_notify_count int := 0;
  v_record_id uuid;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_session
  from public.attendance_sessions
  where id = p_session_id and institution_id = p_institution_id
  for update;

  if v_session.id is null then
    raise exception 'code:not_found' using detail = 'attendance session not found for this institution';
  end if;

  v_staff_id := app.staff_id(p_institution_id);
  v_is_class_teacher := v_staff_id is not null and exists (
    select 1 from public.class_sections cs
    where cs.id = v_session.class_section_id and cs.class_teacher_id = v_staff_id
  );

  if not (
    app.has_role(p_institution_id, array['owner', 'principal', 'admin'])
    or v_is_class_teacher
  ) then
    raise exception 'code:forbidden' using detail = 'caller is not the class teacher of this section';
  end if;

  if v_session.status = 'submitted' then
    return v_session;
  end if;

  update public.attendance_sessions
  set status = 'submitted', submitted_at = now(), marked_by = coalesce(v_staff_id, marked_by)
  where id = p_session_id
  returning * into v_session;

  select count(*) into v_record_count from public.attendance_records where session_id = p_session_id;

  for v_record_id in
    select r.id
    from public.attendance_records r
    join public.institutions i on i.id = p_institution_id
    join lateral jsonb_array_elements(coalesce(i.settings -> 'attendance' -> 'statuses', '[]'::jsonb)) as s on true
    where r.session_id = p_session_id
      and s ->> 'code' = r.status
      and coalesce((s ->> 'notify_guardian')::boolean, false)
  loop
    perform app.enqueue_job(
      p_institution_id,
      'notify.attendance_absence',
      jsonb_build_object('record_id', v_record_id),
      'absence:' || v_record_id
    );
    v_notify_count := v_notify_count + 1;
  end loop;

  perform app.audit(
    p_institution_id,
    v_caller,
    'attendance.submitted',
    'attendance_session',
    p_session_id,
    jsonb_build_object('status', 'open'),
    jsonb_build_object('status', 'submitted'),
    jsonb_build_object('record_count', v_record_count, 'notified_count', v_notify_count)
  );

  return v_session;
end;
$$;

revoke execute on function public.submit_attendance(uuid, uuid) from public, anon;
grant execute on function public.submit_attendance(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.correct_attendance — 06 §W5. Insert + update + audit in one
-- transaction. The correction window (`settings.attendance.
-- correction_window_days`) only constrains a class teacher; owner/principal/
-- admin may correct at any time (07 §2.2 `attendance.correct`: "s (window)"
-- for teacher, unscoped for the three admin roles). `notify.attendance_
-- updated` (W5's notifying -> non-notifying case) is NOT enqueued here: no
-- handler for that job type exists yet (src/modules/jobs/handlers has no
-- notify.attendance_updated.ts — grepped; T-038 only built notify.
-- attendance_absence) and it isn't in this packet's acceptance criteria.
-- Logged as a follow-up in the completion report rather than enqueuing a
-- job type nothing can ever claim.
-- ---------------------------------------------------------------------------
create function public.correct_attendance(
  p_institution_id uuid,
  p_record_id uuid,
  p_new_status text,
  p_reason text
)
returns public.attendance_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_record public.attendance_records;
  v_section_id uuid;
  v_session_date date;
  v_class_teacher_id uuid;
  v_staff_id uuid;
  v_is_admin boolean;
  v_is_class_teacher boolean;
  v_window_days int;
  v_timezone text;
  v_today date;
  v_old_status text;
  v_valid_status boolean;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if p_reason is null or length(btrim(p_reason)) = 0 or length(p_reason) > 200 then
    raise exception 'code:validation_failed' using detail = 'reason is required (max 200 characters)';
  end if;

  select * into v_record
  from public.attendance_records
  where id = p_record_id and institution_id = p_institution_id
  for update;

  if v_record.id is null then
    raise exception 'code:not_found' using detail = 'attendance record not found for this institution';
  end if;

  select s.class_section_id, s.date into v_section_id, v_session_date
  from public.attendance_sessions s
  where s.id = v_record.session_id;

  select cs.class_teacher_id into v_class_teacher_id
  from public.class_sections cs
  where cs.id = v_section_id;

  v_staff_id := app.staff_id(p_institution_id);
  v_is_admin := app.has_role(p_institution_id, array['owner', 'principal', 'admin']);
  v_is_class_teacher := v_staff_id is not null and v_class_teacher_id = v_staff_id;

  if not (v_is_admin or v_is_class_teacher) then
    raise exception 'code:forbidden' using detail = 'caller may not correct this attendance record';
  end if;

  if v_is_class_teacher and not v_is_admin then
    select
      coalesce((i.settings -> 'attendance' ->> 'correction_window_days')::int, 0),
      coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata')
    into v_window_days, v_timezone
    from public.institutions i
    where i.id = p_institution_id;

    -- Security review fix (MEDIUM): `current_date` is the DB session's UTC
    -- date — from IST 00:00 to 05:29 that is still "yesterday" in UTC,
    -- silently extending the teacher's correction window by a day.
    -- Institution-local date instead, same source (`settings.locale.
    -- timezone`, DEFAULT_INSTITUTION_SETTINGS' default) as todayInTimezone()
    -- in src/modules/attendance/actions.ts.
    v_today := (now() at time zone v_timezone)::date;

    if v_session_date < (v_today - v_window_days) then
      raise exception 'code:forbidden' using detail = 'correction window has passed for this record';
    end if;
  end if;

  select exists (
    select 1
    from public.institutions i,
         jsonb_array_elements(coalesce(i.settings -> 'attendance' -> 'statuses', '[]'::jsonb)) as s
    where i.id = p_institution_id and s ->> 'code' = p_new_status
  ) into v_valid_status;

  if not v_valid_status then
    raise exception 'code:validation_failed' using detail = format(
      'status %L is not a configured attendance status', p_new_status
    );
  end if;

  v_old_status := v_record.status;

  if v_old_status = p_new_status then
    raise exception 'code:invalid_state' using detail = 'new status matches the current status';
  end if;

  insert into public.attendance_corrections (institution_id, record_id, old_status, new_status, reason, corrected_by)
  values (p_institution_id, p_record_id, v_old_status, p_new_status, p_reason, v_staff_id);

  update public.attendance_records
  set status = p_new_status
  where id = p_record_id
  returning * into v_record;

  perform app.audit(
    p_institution_id,
    v_caller,
    'attendance.corrected',
    'attendance_record',
    p_record_id,
    jsonb_build_object('status', v_old_status),
    jsonb_build_object('status', p_new_status),
    null
  );

  return v_record;
end;
$$;

revoke execute on function public.correct_attendance(uuid, uuid, text, text) from public, anon;
grant execute on function public.correct_attendance(uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Close the direct-write bypasses (lead ruling, security review of 0006).
-- Never edit 0006 — drop and recreate here instead.
-- ---------------------------------------------------------------------------

-- attendance_sessions: a direct UPDATE could previously set `status` to
-- `submitted` (skipping the jobs and the audit in submit_attendance above)
-- or mutate a session that is already `submitted` (reopening it, or
-- changing `marked_by`/`submitted_at` without a trace). `using` blocks any
-- UPDATE whose OLD row is already submitted; `with_check` blocks any
-- resulting NEW row from being `submitted` — together, a session can only
-- ever become `submitted` through submit_attendance (security definer,
-- bypasses RLS as the function owner), and once submitted it is frozen
-- against direct writes entirely.
drop policy attendance_sessions_update on public.attendance_sessions;

create policy attendance_sessions_update on public.attendance_sessions
  for update to authenticated
  using (
    (
      app.has_role(institution_id, array['owner', 'principal', 'admin'])
      or app.teaches_section(institution_id, class_section_id)
    )
    and status <> 'submitted'
  )
  with check (
    (
      app.has_role(institution_id, array['owner', 'principal', 'admin'])
      or app.teaches_section(institution_id, class_section_id)
    )
    and status <> 'submitted'
  );

-- attendance_records: a direct INSERT/UPDATE could previously target a
-- record whose session was already `submitted` (skipping the correction
-- window and the audit that correct_attendance enforces). Added the same
-- `s.status = 'open'` condition to the existing session-join subquery in
-- both policies — once a session is submitted, its records are writable
-- only through correct_attendance.
drop policy attendance_records_insert on public.attendance_records;
drop policy attendance_records_update on public.attendance_records;

create policy attendance_records_insert on public.attendance_records
  for insert to authenticated
  with check (
    (
      app.has_role(institution_id, array['owner', 'principal', 'admin'])
      or app.teaches_section(
        institution_id,
        (select s.class_section_id from public.attendance_sessions s where s.id = attendance_records.session_id)
      )
    )
    and exists (
      select 1
      from public.attendance_sessions s
      join public.enrolments e on e.class_section_id = s.class_section_id
      where s.id = attendance_records.session_id
        and s.status = 'open'
        and e.institution_id = attendance_records.institution_id
        and e.student_id = attendance_records.student_id
    )
  );

create policy attendance_records_update on public.attendance_records
  for update to authenticated
  using (
    (
      app.has_role(institution_id, array['owner', 'principal', 'admin'])
      or app.teaches_section(
        institution_id,
        (select s.class_section_id from public.attendance_sessions s where s.id = attendance_records.session_id)
      )
    )
    and exists (
      select 1
      from public.attendance_sessions s
      join public.enrolments e on e.class_section_id = s.class_section_id
      where s.id = attendance_records.session_id
        and s.status = 'open'
        and e.institution_id = attendance_records.institution_id
        and e.student_id = attendance_records.student_id
    )
  )
  with check (
    (
      app.has_role(institution_id, array['owner', 'principal', 'admin'])
      or app.teaches_section(
        institution_id,
        (select s.class_section_id from public.attendance_sessions s where s.id = attendance_records.session_id)
      )
    )
    and exists (
      select 1
      from public.attendance_sessions s
      join public.enrolments e on e.class_section_id = s.class_section_id
      where s.id = attendance_records.session_id
        and s.status = 'open'
        and e.institution_id = attendance_records.institution_id
        and e.student_id = attendance_records.student_id
    )
  );

-- attendance_corrections: dropped with no replacement. A direct INSERT
-- previously let a teacher/admin write a correction log row with no window
-- check and no matching record update (logically inconsistent, and a clean
-- bypass of correct_attendance's own checks). RLS default-denies with no
-- matching policy, so only the security-definer function (table owner,
-- bypasses RLS) can insert now — same shape as audit_events/jobs having no
-- INSERT policy at all.
drop policy attendance_corrections_insert on public.attendance_corrections;
