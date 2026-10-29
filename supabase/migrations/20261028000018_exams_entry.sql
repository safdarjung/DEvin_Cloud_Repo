-- T-018 (lead ruling — one migration allowed on this packet): single-
-- transaction marks entry RPC, an exam-verification public wrapper, and the
-- exam-status transition guard 0009 never built (06 §W7). 0009 is merged and
-- never edited (CLAUDE.md rule 9); the one change to an 0009 function
-- (app.publish_exam_results, to set the new transition GUC) lands here as a
-- `create or replace` instead, same shape as 0016 doing the same for 0007's
-- functions via new triggers.

-- ---------------------------------------------------------------------------
-- app.guard_exam_status() — BEFORE UPDATE on exams. 0009's exams_update RLS
-- policy (app.exam_write_roles()) lets a direct PostgREST UPDATE set
-- `status` to anything, including `published` (skipping the results
-- snapshot entirely) or backwards out of `published` — same class of hole
-- 0014/0016 closed for attendance/applications/enquiries. Every legitimate
-- transition (draft->marks_entry, marks_entry->verification,
-- verification->marks_entry, verification->published) now goes through one
-- of the four RPCs below, each of which validates its OWN specific
-- precondition before setting this transaction-local GUC immediately before
-- its own UPDATE — so the GUC alone (not per-transition GUC names) is
-- enough: a direct UPDATE never sets it, and a legitimate RPC never sets it
-- without having already checked the transition is the right one.
-- ---------------------------------------------------------------------------

create function app.guard_exam_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bypass boolean;
begin
  if current_setting('app.allow_reset', true) = 'on' then
    return new;
  end if;

  if new.status is distinct from old.status then
    v_bypass := (
      coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
      or session_user = 'postgres'
      or coalesce(current_setting('app.allow_exam_status_change', true), '') = 'on'
    );

    if not v_bypass then
      raise exception 'code:invalid_state' using detail = format('exams.status may only move from %s through the exam workflow RPCs, not a direct update', old.status);
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function app.guard_exam_status() from public;

create trigger guard_exam_status
before update on public.exams
for each row execute function app.guard_exam_status();

-- ---------------------------------------------------------------------------
-- app.open_marks_entry / app.close_marks_entry / app.reopen_marks_entry —
-- 06 §W7 diagram (draft->marks_entry->verification->marks_entry). Same
-- shape throughout: lock the exam row, role-check against
-- app.exam_write_roles() (exam.manage — admin excluded, lesson #1), validate
-- the one precondition the diagram names for that edge, set the GUC, flip
-- status, audit. Thin public.* wrappers, `app.*` revoked from
-- anon/authenticated/service_role, `public.*` granted to authenticated only
-- — same shape as 0009's publish_exam_results/apply_recheck_decision.
-- ---------------------------------------------------------------------------

create function app.open_marks_entry(p_institution_id uuid, p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_exam public.exams;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_exam from public.exams where id = p_exam_id and institution_id = p_institution_id for update;
  if v_exam.id is null then
    raise exception 'code:not_found' using detail = 'exam not found for this institution';
  end if;

  if not app.has_role(v_exam.institution_id, app.exam_write_roles()) then
    raise exception 'code:forbidden' using detail = 'caller does not hold exam.manage for this institution';
  end if;

  if v_exam.status <> 'draft' then
    raise exception 'code:invalid_state' using detail = format('exam must be draft to open marks entry; current status is %s', v_exam.status);
  end if;

  if not exists (select 1 from public.exam_papers where exam_id = p_exam_id) then
    raise exception 'code:invalid_state' using detail = 'exam has no papers; create exam papers before opening marks entry';
  end if;

  perform set_config('app.allow_exam_status_change', 'on', true);
  update public.exams set status = 'marks_entry' where id = p_exam_id;

  perform app.audit(
    v_exam.institution_id, v_caller, 'exam.marks_entry.opened', 'exam', p_exam_id,
    jsonb_build_object('status', 'draft'), jsonb_build_object('status', 'marks_entry'), null
  );

  return jsonb_build_object('exam_id', p_exam_id, 'status', 'marks_entry');
end;
$$;

revoke execute on function app.open_marks_entry(uuid, uuid) from public, anon, authenticated;

create function public.open_marks_entry(p_institution_id uuid, p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.open_marks_entry(p_institution_id, p_exam_id);
end;
$$;

revoke execute on function public.open_marks_entry(uuid, uuid) from public, anon;
grant execute on function public.open_marks_entry(uuid, uuid) to authenticated;

create function app.close_marks_entry(p_institution_id uuid, p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_exam public.exams;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_exam from public.exams where id = p_exam_id and institution_id = p_institution_id for update;
  if v_exam.id is null then
    raise exception 'code:not_found' using detail = 'exam not found for this institution';
  end if;

  if not app.has_role(v_exam.institution_id, app.exam_write_roles()) then
    raise exception 'code:forbidden' using detail = 'caller does not hold exam.manage for this institution';
  end if;

  if v_exam.status <> 'marks_entry' then
    raise exception 'code:invalid_state' using detail = format('exam must be marks_entry to close marks entry; current status is %s', v_exam.status);
  end if;

  perform set_config('app.allow_exam_status_change', 'on', true);
  update public.exams set status = 'verification' where id = p_exam_id;

  perform app.audit(
    v_exam.institution_id, v_caller, 'exam.marks_entry.closed', 'exam', p_exam_id,
    jsonb_build_object('status', 'marks_entry'), jsonb_build_object('status', 'verification'), null
  );

  return jsonb_build_object('exam_id', p_exam_id, 'status', 'verification');
end;
$$;

revoke execute on function app.close_marks_entry(uuid, uuid) from public, anon, authenticated;

create function public.close_marks_entry(p_institution_id uuid, p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.close_marks_entry(p_institution_id, p_exam_id);
end;
$$;

revoke execute on function public.close_marks_entry(uuid, uuid) from public, anon;
grant execute on function public.close_marks_entry(uuid, uuid) to authenticated;

-- reopen_marks_entry is only ever reachable from `verification` (the
-- diagram's one backwards edge) — `published` is terminal and has no edge
-- back into `marks_entry` at all, so "unpublished only" (packet wording)
-- falls out of the status check below for free.
create function app.reopen_marks_entry(p_institution_id uuid, p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_exam public.exams;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_exam from public.exams where id = p_exam_id and institution_id = p_institution_id for update;
  if v_exam.id is null then
    raise exception 'code:not_found' using detail = 'exam not found for this institution';
  end if;

  if not app.has_role(v_exam.institution_id, app.exam_write_roles()) then
    raise exception 'code:forbidden' using detail = 'caller does not hold exam.manage for this institution';
  end if;

  if v_exam.status <> 'verification' then
    raise exception 'code:invalid_state' using detail = format('exam must be in verification to reopen marks entry; current status is %s', v_exam.status);
  end if;

  perform set_config('app.allow_exam_status_change', 'on', true);
  update public.exams set status = 'marks_entry' where id = p_exam_id;

  perform app.audit(
    v_exam.institution_id, v_caller, 'exam.marks_entry.reopened', 'exam', p_exam_id,
    jsonb_build_object('status', 'verification'), jsonb_build_object('status', 'marks_entry'), null
  );

  return jsonb_build_object('exam_id', p_exam_id, 'status', 'marks_entry');
end;
$$;

revoke execute on function app.reopen_marks_entry(uuid, uuid) from public, anon, authenticated;

create function public.reopen_marks_entry(p_institution_id uuid, p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.reopen_marks_entry(p_institution_id, p_exam_id);
end;
$$;

revoke execute on function public.reopen_marks_entry(uuid, uuid) from public, anon;
grant execute on function public.reopen_marks_entry(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- app.publish_exam_results — `create or replace`, byte-for-byte identical
-- to 0009 except for the one added line (`perform set_config(...)`
-- immediately before the status UPDATE) so app.guard_exam_status above
-- doesn't reject its own verification->published transition. Every other
-- check (role, status, re-verification, snapshot build, audit, job enqueue)
-- is T-017's, untouched.
-- ---------------------------------------------------------------------------

create or replace function app.publish_exam_results(p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exams;
  v_verification jsonb;
  v_result_count int := 0;
  v_student record;
  v_paper record;
  v_snapshot_subjects jsonb;
  v_total numeric(8, 2);
  v_max_total numeric(8, 2);
  v_percentage numeric(5, 2);
  v_grade text;
  v_attendance_pct numeric;
  v_result_id uuid;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_exam from public.exams where id = p_exam_id for update;
  if v_exam.id is null then
    raise exception 'code:not_found' using detail = 'exam not found';
  end if;

  if not app.has_role(v_exam.institution_id, app.exam_write_roles()) then
    raise exception 'code:forbidden' using detail = 'caller does not hold exam.result.publish for this institution';
  end if;

  if v_exam.status <> 'verification' then
    raise exception 'code:invalid_state' using detail = format('exam must be in verification to publish; current status is %s', v_exam.status);
  end if;

  v_verification := app.exam_verification(p_exam_id);
  if not (v_verification -> 'summary' ->> 'clean')::boolean then
    raise exception 'code:invalid_state' using detail = format('exam has unresolved verification issues: %s', v_verification -> 'summary');
  end if;

  for v_student in
    select distinct e.student_id
    from public.exam_papers p
    join public.enrolments e on e.class_section_id = p.class_section_id and e.status = 'active'
    where p.exam_id = p_exam_id
  loop
    v_snapshot_subjects := '[]'::jsonb;
    v_total := 0;
    v_max_total := 0;

    for v_paper in
      select p.id as exam_paper_id, p.subject_id, p.max_marks, p.pass_marks, m.marks_obtained, m.is_absent
      from public.exam_papers p
      join public.enrolments e on e.class_section_id = p.class_section_id and e.status = 'active'
      left join public.marks m on m.exam_paper_id = p.id and m.student_id = e.student_id and m.superseded_by is null
      where p.exam_id = p_exam_id and e.student_id = v_student.student_id
    loop
      v_snapshot_subjects := v_snapshot_subjects || jsonb_build_array(jsonb_build_object(
        'exam_paper_id', v_paper.exam_paper_id,
        'subject_id', v_paper.subject_id,
        'marks_obtained', v_paper.marks_obtained,
        'max_marks', v_paper.max_marks,
        'is_absent', v_paper.is_absent,
        'passed', (not v_paper.is_absent) and v_paper.marks_obtained >= v_paper.pass_marks,
        'grade', case when v_paper.is_absent or v_paper.marks_obtained is null then null
                       else app.grade_for(v_exam.institution_id, v_exam.grading_scale_key, round(v_paper.marks_obtained / v_paper.max_marks * 100, 2)) end
      ));
      v_total := v_total + coalesce(v_paper.marks_obtained, 0);
      v_max_total := v_max_total + v_paper.max_marks;
    end loop;

    v_percentage := case when v_max_total > 0 then round(v_total / v_max_total * 100, 2) else 0 end;
    v_grade := app.grade_for(v_exam.institution_id, v_exam.grading_scale_key, v_percentage);
    v_attendance_pct := app.term_attendance_percentage(v_exam.institution_id, v_student.student_id, v_exam.term_id);

    insert into public.results (institution_id, exam_id, student_id, snapshot, total, max_total, percentage, grade, version_no, published_at)
    values (
      v_exam.institution_id, p_exam_id, v_student.student_id,
      jsonb_build_object('subjects', v_snapshot_subjects, 'attendancePercentage', v_attendance_pct),
      v_total, v_max_total, v_percentage, v_grade, 1, now()
    )
    returning id into v_result_id;

    v_result_count := v_result_count + 1;

    perform app.enqueue_job(
      v_exam.institution_id,
      'notify.results_published',
      jsonb_build_object('result_id', v_result_id, 'student_id', v_student.student_id, 'exam_id', p_exam_id),
      'result:' || v_result_id
    );
  end loop;

  -- T-018 addition: set the transition GUC app.guard_exam_status now checks
  -- (see above) immediately before the one status-changing UPDATE below.
  perform set_config('app.allow_exam_status_change', 'on', true);
  update public.exams set status = 'published', published_at = now() where id = p_exam_id;

  perform app.audit(
    v_exam.institution_id,
    app.current_user_id(),
    'exam.published',
    'exam',
    p_exam_id,
    jsonb_build_object('status', v_exam.status),
    jsonb_build_object('status', 'published', 'result_count', v_result_count),
    null
  );

  return jsonb_build_object('exam_id', p_exam_id, 'result_count', v_result_count);
end;
$$;

revoke execute on function app.publish_exam_results(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- public.exam_verification(p_institution_id, p_exam_id) — T-017's follow-up
-- debt: app.exam_verification(p_exam_id) (0009) has no public.* wrapper
-- because no UI called it yet. Role-checked the same way as the other
-- exam.manage-gated RPCs here (07 §2.2 has no separate "exam.verify" row —
-- verification is part of exam.manage, done by the controller before
-- publish).
-- ---------------------------------------------------------------------------

create function public.exam_verification(p_institution_id uuid, p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exams;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_exam from public.exams where id = p_exam_id and institution_id = p_institution_id;
  if v_exam.id is null then
    raise exception 'code:not_found' using detail = 'exam not found for this institution';
  end if;

  if not app.has_role(v_exam.institution_id, app.exam_write_roles()) then
    raise exception 'code:forbidden' using detail = 'caller does not hold exam.manage for this institution';
  end if;

  return app.exam_verification(p_exam_id);
end;
$$;

revoke execute on function public.exam_verification(uuid, uuid) from public, anon;
grant execute on function public.exam_verification(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- app.enter_marks(p_institution_id, p_paper_id, p_rows) — 06 §W7, T-017's
-- follow-up debt ("the next exam-entry task should build it as a
-- single-transaction RPC, same shape as app.apply_recheck_decision, not two
-- separate client calls — a plain two-call RLS flow from the client can
-- never perform a supersede", since the deferred one-current-row check only
-- fires at commit). Role-checked inside (app.exam_write_roles() OR a
-- teacher with a subject_assignments row for exactly this paper's section
-- AND subject — exam.marks.enter's matrix row, subject-level per the T-022/
-- DBT-19 lesson, never section-level). Unchanged rows (same marks_obtained/
-- is_absent as the current version) are skipped — no new version, no
-- supersede (06 §W7 "Duplicates": "saving identical marks creates no new
-- version"). p_rows: jsonb array of {student_id, marks_obtained?,
-- is_absent}.
-- ---------------------------------------------------------------------------

create function app.enter_marks(p_institution_id uuid, p_paper_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_paper public.exam_papers;
  v_exam public.exams;
  v_is_write_role boolean;
  v_is_teacher boolean;
  v_row jsonb;
  v_row_count int;
  v_student_id uuid;
  v_marks_obtained numeric(6, 2);
  v_is_absent boolean;
  v_seen_students uuid[] := array[]::uuid[];
  v_touched_students uuid[] := array[]::uuid[];
  v_current public.marks;
  v_new_id uuid;
  v_entered int := 0;
  v_unchanged int := 0;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_paper from public.exam_papers where id = p_paper_id and institution_id = p_institution_id for update;
  if v_paper.id is null then
    raise exception 'code:not_found' using detail = 'exam paper not found for this institution';
  end if;

  select * into v_exam from public.exams where id = v_paper.exam_id;

  v_is_write_role := app.has_role(p_institution_id, app.exam_write_roles());
  v_is_teacher := exists (
    select 1 from public.subject_assignments sa
    where sa.institution_id = p_institution_id
      and sa.class_section_id = v_paper.class_section_id
      and sa.subject_id = v_paper.subject_id
      and sa.teacher_id = app.staff_id(p_institution_id)
  );

  if not v_is_write_role and not v_is_teacher then
    raise exception 'code:forbidden' using detail = 'caller does not hold exam.marks.enter for this paper';
  end if;

  if v_exam.status not in ('marks_entry', 'verification') then
    raise exception 'code:invalid_state' using detail = format('marks cannot be entered while the exam is %s', v_exam.status);
  end if;

  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'code:validation_failed' using detail = 'rows must be a JSON array';
  end if;

  select count(*) into v_row_count from jsonb_array_elements(p_rows);
  if v_row_count = 0 or v_row_count > 60 then
    raise exception 'code:validation_failed' using detail = 'rows must contain between 1 and 60 entries';
  end if;

  for v_row in select elem from jsonb_array_elements(p_rows) as elem
  loop
    v_student_id := (v_row ->> 'student_id')::uuid;
    v_is_absent := coalesce((v_row ->> 'is_absent')::boolean, false);
    v_marks_obtained := (v_row ->> 'marks_obtained')::numeric;

    if v_student_id is null then
      raise exception 'code:validation_failed' using detail = 'student_id is required for every row';
    end if;
    if v_student_id = any(v_seen_students) then
      raise exception 'code:validation_failed' using detail = format('duplicate student_id %s in rows', v_student_id);
    end if;
    v_seen_students := v_seen_students || v_student_id;

    if v_is_absent = (v_marks_obtained is not null) then
      raise exception 'code:validation_failed' using detail = format('student %s: exactly one of isAbsent or marksObtained is required', v_student_id);
    end if;
    if not v_is_absent and (v_marks_obtained < 0 or v_marks_obtained > v_paper.max_marks) then
      raise exception 'code:validation_failed' using detail = format('student %s: marks_obtained must be between 0 and %s', v_student_id, v_paper.max_marks);
    end if;

    if not exists (
      select 1 from public.enrolments e
      where e.student_id = v_student_id and e.class_section_id = v_paper.class_section_id
        and e.institution_id = p_institution_id and e.status = 'active'
    ) then
      raise exception 'code:validation_failed' using detail = format('student %s is not actively enrolled in this paper''s section', v_student_id);
    end if;

    select * into v_current from public.marks
    where exam_paper_id = p_paper_id and student_id = v_student_id and superseded_by is null;

    if v_current.id is not null
      and v_current.is_absent = v_is_absent
      and coalesce(v_current.marks_obtained, -1) = coalesce(v_marks_obtained, -1)
    then
      v_unchanged := v_unchanged + 1;
      continue;
    end if;

    -- Insert the new row FIRST, then point the old row at it — same order
    -- as app.apply_recheck_decision (0009), required by the deferred
    -- one-current-row constraint trigger.
    insert into public.marks (institution_id, exam_paper_id, student_id, marks_obtained, is_absent, version_no, source, entered_by)
    values (
      p_institution_id, p_paper_id, v_student_id, v_marks_obtained, v_is_absent,
      coalesce(v_current.version_no, 0) + 1, 'entry', v_caller
    )
    returning id into v_new_id;

    if v_current.id is not null then
      update public.marks set superseded_by = v_new_id where id = v_current.id;
    end if;

    v_entered := v_entered + 1;
    v_touched_students := v_touched_students || v_student_id;
  end loop;

  -- Aggregate summary row (counts + ids only, no marks values) — dual grain
  -- alongside app.marks_revision_audit's AFTER INSERT per-row audit rows,
  -- same pattern as app.publish_exam_results' own summary call.
  perform app.audit(
    p_institution_id, v_caller, 'exam.marks.entered', 'exam_paper', p_paper_id,
    null,
    jsonb_build_object('entered_count', v_entered, 'unchanged_count', v_unchanged, 'student_ids', to_jsonb(v_touched_students)),
    null
  );

  return jsonb_build_object('paper_id', p_paper_id, 'entered', v_entered, 'unchanged', v_unchanged);
end;
$$;

revoke execute on function app.enter_marks(uuid, uuid, jsonb) from public, anon, authenticated;

create function public.enter_marks(p_institution_id uuid, p_paper_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.enter_marks(p_institution_id, p_paper_id, p_rows);
end;
$$;

revoke execute on function public.enter_marks(uuid, uuid, jsonb) from public, anon;
grant execute on function public.enter_marks(uuid, uuid, jsonb) to authenticated;
