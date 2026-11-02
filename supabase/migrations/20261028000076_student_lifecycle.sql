-- M14-T2: migration 0076 part 1 — student_lifecycle_events (append-only
-- log) + RLS, and the enrolment/student status guards that force every
-- status change through the 0076 lifecycle functions (T3-T5 append to this
-- same file). Rulings: docs/planning/fabric/06-backend-packets/M14-tasks.md.
--
-- `tests/db/academics.test.ts` C-13 used to update `enrolments.status`
-- directly as owner and expect it to succeed; that write now fails
-- `invalid_state` (rewritten in this packet). The history-row assertion
-- (from/to/changed_by) moves to T4, exercised through `exit_student`.

create table public.student_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  student_id uuid not null references public.students (id),
  kind text not null check (kind in ('promoted', 'graduated', 'transferred_out', 'withdrawn')),
  batch_id uuid,
  from_enrolment_id uuid references public.enrolments (id),
  to_enrolment_id uuid references public.enrolments (id),
  effective_on date not null,
  reason text check (char_length(reason) <= 500),
  tc_no text,
  tc_snapshot jsonb,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind in ('transferred_out', 'withdrawn')) = (tc_no is not null and tc_snapshot is not null)),
  check ((kind = 'promoted') = (to_enrolment_id is not null))
);

create unique index student_lifecycle_events_tc_no_idx
  on public.student_lifecycle_events (institution_id, tc_no) where tc_no is not null;
create index student_lifecycle_events_student_created_idx
  on public.student_lifecycle_events (student_id, created_at);

create trigger set_updated_at
before update on public.student_lifecycle_events
for each row execute function app.set_updated_at();

create trigger block_mutation
before update or delete on public.student_lifecycle_events
for each row execute function app.block_mutation();

alter table public.student_lifecycle_events enable row level security;

-- SELECT only (07 §2.2 student.read, same shape as 0025's students_select).
-- No INSERT/UPDATE/DELETE policy: rows come only from the 0076 SECURITY
-- DEFINER functions (T3-T5), which run as the table owner and bypass RLS.
create policy student_lifecycle_events_select on public.student_lifecycle_events
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'admissions', 'accountant', 'exam_controller'])))
    or student_id = any((select app.my_student_ids()))
    or student_id = any((select app.my_taught_student_ids()))
  );

-- ---------------------------------------------------------------------------
-- Status guards: `enrolments.status` and `students.status` only change
-- through the 0076 lifecycle functions (T3-T5), which open a
-- transaction-local window with `set_config('app.allow_lifecycle', 'on', true)`
-- (0042 lesson). Security invoker BEFORE triggers; bypass only
-- service_role/postgres (seed/reset — 0041 lesson, nullif on claims).
-- ---------------------------------------------------------------------------

create function app.guard_enrolment_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status is distinct from 'active' then
      raise exception 'code:invalid_state' using detail = 'a new enrolment must start active';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if coalesce(current_setting('app.allow_lifecycle', true), '') = 'on' then
      if old.status is distinct from 'active' then
        raise exception 'code:invalid_state' using detail = 'a terminal enrolment status never changes';
      end if;
      if new.status not in ('completed', 'withdrawn', 'transferred') then
        raise exception 'code:invalid_state' using detail = format('illegal enrolment status transition to %s', new.status);
      end if;
    else
      raise exception 'code:invalid_state' using detail = 'enrolment status changes only through the lifecycle functions';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function app.guard_enrolment_status() from public;

create trigger guard_enrolment_status
before insert or update on public.enrolments
for each row execute function app.guard_enrolment_status();

create function app.guard_student_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status is distinct from 'active' then
      raise exception 'code:invalid_state' using detail = 'a new student must start active';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if coalesce(current_setting('app.allow_lifecycle', true), '') = 'on' then
      if old.status is distinct from 'active' then
        raise exception 'code:invalid_state' using detail = 'a terminal student status never changes';
      end if;
      if new.status not in ('alumni', 'withdrawn') then
        raise exception 'code:invalid_state' using detail = format('illegal student status transition to %s', new.status);
      end if;
    else
      raise exception 'code:invalid_state' using detail = 'student status changes only through the lifecycle functions';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function app.guard_student_status() from public;

create trigger guard_student_status
before insert or update on public.students
for each row execute function app.guard_student_status();

-- ---------------------------------------------------------------------------
-- M14-T3: public.promote_students — year-end rollover. Single public.*
-- definer (precedent 0017 enqueue_term_invoices), no app.* twin. Overrides
-- are resolved before section mappings so an override always wins; p_exclude
-- wins over both. Idempotent: a completed/alumni row never matches the
-- `status = 'active'` candidate filter again, so a re-run (or a concurrent
-- one, via FOR UPDATE's EvalPlanQual re-check) returns zero counts.
-- ---------------------------------------------------------------------------

create function public.promote_students(
  p_from_year_id uuid,
  p_to_year_id uuid,
  p_mappings jsonb,
  p_overrides jsonb default '[]',
  p_exclude uuid[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_from_year public.academic_years;
  v_to_year public.academic_years;
  v_batch_id uuid := gen_random_uuid();
  v_promoted int := 0;
  v_graduated int := 0;
  v_skipped uuid[] := array[]::uuid[];
  v_processed uuid[] := array[]::uuid[];
  v_mapping jsonb;
  v_override jsonb;
  v_student_id uuid;
  v_target_section uuid;
  v_enrolment public.enrolments;
  v_cand record;
  v_new_enrolment_id uuid;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_from_year from public.academic_years where id = p_from_year_id;
  if v_from_year.id is null then
    raise exception 'code:not_found' using detail = 'from academic year not found';
  end if;

  if not app.has_role(v_from_year.institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold an academics.manage role for this institution';
  end if;

  select * into v_to_year from public.academic_years
  where id = p_to_year_id and institution_id = v_from_year.institution_id;
  if v_to_year.id is null then
    raise exception 'code:validation_failed' using detail = 'to year not found in the from year''s institution';
  end if;
  if v_to_year.starts_on <= v_from_year.starts_on then
    raise exception 'code:validation_failed' using detail = 'to year must start after the from year';
  end if;

  for v_mapping in select elem from jsonb_array_elements(p_mappings) as elem
  loop
    if not exists (
      select 1 from public.class_sections
      where id = (v_mapping ->> 'from_section_id')::uuid
        and institution_id = v_from_year.institution_id
        and academic_year_id = p_from_year_id
    ) then
      raise exception 'code:validation_failed' using detail = 'mapping from_section_id is not in the from year';
    end if;
    if (v_mapping ->> 'to_section_id') is not null and not exists (
      select 1 from public.class_sections
      where id = (v_mapping ->> 'to_section_id')::uuid
        and institution_id = v_from_year.institution_id
        and academic_year_id = p_to_year_id
    ) then
      raise exception 'code:validation_failed' using detail = 'mapping to_section_id is not in the to year';
    end if;
  end loop;

  for v_override in select elem from jsonb_array_elements(p_overrides) as elem
  loop
    v_student_id := (v_override ->> 'student_id')::uuid;
    if not exists (
      select 1 from public.enrolments
      where student_id = v_student_id and academic_year_id = p_from_year_id and status = 'active'
    ) then
      raise exception 'code:validation_failed' using detail = format('override student %s has no active from-year enrolment', v_student_id);
    end if;
    if not exists (
      select 1 from public.class_sections
      where id = (v_override ->> 'to_section_id')::uuid
        and institution_id = v_from_year.institution_id
        and academic_year_id = p_to_year_id
    ) then
      raise exception 'code:validation_failed' using detail = format('override to_section_id is not in the to year for student %s', v_student_id);
    end if;
  end loop;

  perform set_config('app.allow_lifecycle', 'on', true);

  -- Overrides first — an override always wins over a section mapping.
  for v_override in select elem from jsonb_array_elements(p_overrides) as elem
  loop
    v_student_id := (v_override ->> 'student_id')::uuid;
    if v_student_id = any(p_exclude) then
      continue;
    end if;
    v_processed := v_processed || v_student_id;

    if exists (
      select 1 from public.enrolments
      where student_id = v_student_id and academic_year_id = p_to_year_id and status = 'active'
    ) then
      v_skipped := v_skipped || v_student_id;
      continue;
    end if;

    select * into v_enrolment from public.enrolments
    where student_id = v_student_id and academic_year_id = p_from_year_id and status = 'active'
    for update;

    update public.enrolments set status = 'completed', ended_on = v_from_year.ends_on where id = v_enrolment.id;

    v_target_section := (v_override ->> 'to_section_id')::uuid;
    insert into public.enrolments (institution_id, student_id, class_section_id, academic_year_id, roll_no, status, started_on)
    values (v_from_year.institution_id, v_student_id, v_target_section, p_to_year_id, null, 'active', v_to_year.starts_on)
    returning id into v_new_enrolment_id;

    insert into public.student_lifecycle_events
      (institution_id, student_id, kind, batch_id, from_enrolment_id, to_enrolment_id, effective_on, created_by)
    values
      (v_from_year.institution_id, v_student_id, 'promoted', v_batch_id, v_enrolment.id, v_new_enrolment_id, v_to_year.starts_on, v_caller);

    v_promoted := v_promoted + 1;
  end loop;

  -- Section-mapped candidates: active from-year enrolments in a mapped
  -- section, minus anything an override already processed and minus
  -- p_exclude. FOR UPDATE OF e locks the row (EvalPlanQual re-checks
  -- `status = 'active'` against a concurrent writer at lock time).
  for v_cand in
    select e.id as enrolment_id, e.student_id, (m.elem ->> 'to_section_id')::uuid as to_section_id
    from public.enrolments e
    join lateral (select elem from jsonb_array_elements(p_mappings) as elem) m
      on (m.elem ->> 'from_section_id')::uuid = e.class_section_id
    where e.academic_year_id = p_from_year_id and e.status = 'active'
    for update of e
  loop
    v_student_id := v_cand.student_id;
    if v_student_id = any(p_exclude) or v_student_id = any(v_processed) then
      continue;
    end if;
    v_processed := v_processed || v_student_id;

    if exists (
      select 1 from public.enrolments
      where student_id = v_student_id and academic_year_id = p_to_year_id and status = 'active'
    ) then
      v_skipped := v_skipped || v_student_id;
      continue;
    end if;

    update public.enrolments set status = 'completed', ended_on = v_from_year.ends_on where id = v_cand.enrolment_id;

    if v_cand.to_section_id is not null then
      insert into public.enrolments (institution_id, student_id, class_section_id, academic_year_id, roll_no, status, started_on)
      values (v_from_year.institution_id, v_student_id, v_cand.to_section_id, p_to_year_id, null, 'active', v_to_year.starts_on)
      returning id into v_new_enrolment_id;

      insert into public.student_lifecycle_events
        (institution_id, student_id, kind, batch_id, from_enrolment_id, to_enrolment_id, effective_on, created_by)
      values
        (v_from_year.institution_id, v_student_id, 'promoted', v_batch_id, v_cand.enrolment_id, v_new_enrolment_id, v_to_year.starts_on, v_caller);

      v_promoted := v_promoted + 1;
    else
      update public.students set status = 'alumni' where id = v_student_id;

      insert into public.student_lifecycle_events
        (institution_id, student_id, kind, batch_id, from_enrolment_id, effective_on, created_by)
      values
        (v_from_year.institution_id, v_student_id, 'graduated', v_batch_id, v_cand.enrolment_id, v_from_year.ends_on, v_caller);

      v_graduated := v_graduated + 1;
    end if;
  end loop;

  perform app.audit(
    v_from_year.institution_id,
    v_caller,
    'lifecycle.promoted',
    'academic_year',
    p_to_year_id,
    null,
    null,
    jsonb_build_object(
      'fromYearId', p_from_year_id,
      'toYearId', p_to_year_id,
      'promoted', v_promoted,
      'graduated', v_graduated,
      'skippedCount', coalesce(array_length(v_skipped, 1), 0)
    )
  );

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'promoted', v_promoted,
    'graduated', v_graduated,
    'skipped_student_ids', to_jsonb(v_skipped)
  );
end;
$$;

revoke execute on function public.promote_students(uuid, uuid, jsonb, jsonb, uuid[]) from public, anon;
grant execute on function public.promote_students(uuid, uuid, jsonb, jsonb, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- M14-T4: public.exit_student — transfer-out / withdrawal with a TC
-- snapshot built from rows (lesson 3) and the portal-access cleanup a TC
-- implies: the student's own membership and any guardian left with no
-- other active child are disabled, and their pending invitations revoked.
-- The caller's own membership is never touched (0033/0038 self-edit guard
-- would reject that update outright even though this function runs as
-- SECURITY DEFINER — triggers are not bypassed by table-owner RLS bypass).
-- ---------------------------------------------------------------------------

create function public.exit_student(
  p_student_id uuid,
  p_kind text,
  p_reason text,
  p_left_on date default null,
  p_destination_school text default null,
  p_conduct text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_student public.students;
  v_enrolment public.enrolments;
  v_left_on date := coalesce(p_left_on, current_date);
  v_pattern text;
  v_tc_no text;
  v_event_id uuid;
  v_snapshot jsonb;
  v_section_name text;
  v_grade_name text;
  v_year_name text;
  v_admitted_on date;
  v_primary_guardian_name text;
  v_dues numeric;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  -- `for update`: without this lock, two concurrent exit_student calls on
  -- the same student can both read status = 'active' before either
  -- commits and both succeed, double-issuing a TC (security-review
  -- finding, confirmed by a concurrent-call test). The lock serializes the
  -- second call behind the first so it sees the fresh post-commit row.
  select * into v_student from public.students where id = p_student_id for update;
  if v_student.id is null then
    raise exception 'code:not_found' using detail = 'student not found';
  end if;

  if not app.has_role(v_student.institution_id, array['owner', 'principal', 'admin', 'admissions']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold a student.write role for this institution';
  end if;

  if v_student.status <> 'active' then
    raise exception 'code:invalid_state' using detail = 'student is not active';
  end if;

  if p_kind not in ('transferred_out', 'withdrawn') then
    raise exception 'code:validation_failed' using detail = 'kind must be transferred_out or withdrawn';
  end if;

  if p_kind = 'transferred_out' and coalesce(char_length(btrim(p_destination_school)), 0) < 2 then
    raise exception 'code:validation_failed' using detail = 'transferred_out requires a destination school';
  end if;

  if p_reason is null or char_length(p_reason) < 3 or char_length(p_reason) > 500 then
    raise exception 'code:validation_failed' using detail = 'reason must be 3-500 characters';
  end if;

  if v_left_on > current_date then
    raise exception 'code:validation_failed' using detail = 'left_on cannot be in the future';
  end if;

  select * into v_enrolment from public.enrolments
  where student_id = p_student_id and status = 'active'
  for update;

  if v_enrolment.id is not null and v_left_on < v_enrolment.started_on then
    raise exception 'code:validation_failed' using detail = 'left_on cannot be before the active enrolment started';
  end if;

  if v_enrolment.id is not null then
    select cs.name, g.display_name, y.name
    into v_section_name, v_grade_name, v_year_name
    from public.class_sections cs
    join public.grades g on g.id = cs.grade_id
    join public.academic_years y on y.id = cs.academic_year_id
    where cs.id = v_enrolment.class_section_id;
  end if;

  select min(started_on) into v_admitted_on from public.enrolments where student_id = p_student_id;

  select g.full_name into v_primary_guardian_name
  from public.guardian_students gs
  join public.guardians g on g.id = gs.guardian_id
  where gs.student_id = p_student_id and gs.is_primary
  limit 1;

  select coalesce(sum(total - paid_total), 0) into v_dues
  from public.invoices
  where student_id = p_student_id and status in ('issued', 'part_paid');

  -- TC numbering (D15): create_institution sets no numbering patterns, so
  -- the first exit for an institution seeds settings.numbering.tc_no.
  select settings -> 'numbering' ->> 'tc_no' into v_pattern from public.institutions where id = v_student.institution_id;
  if v_pattern is null then
    update public.institutions
    set settings = jsonb_set(
      settings,
      '{numbering}',
      coalesce(settings -> 'numbering', '{}'::jsonb) || jsonb_build_object('tc_no', 'TC/{YYYY}/{SEQ:5}'),
      true
    )
    where id = v_student.institution_id;
  end if;

  v_tc_no := app.next_sequence(v_student.institution_id, 'tc_no');

  v_snapshot := jsonb_build_object(
    'tc_no', v_tc_no,
    'student_name', btrim(concat(v_student.first_name, ' ', coalesce(v_student.last_name, ''))),
    'admission_no', v_student.admission_no,
    'dob', v_student.dob,
    'gender', v_student.gender,
    'primary_guardian_name', v_primary_guardian_name,
    'grade', v_grade_name,
    'section', v_section_name,
    'academic_year', v_year_name,
    'admitted_on', v_admitted_on,
    'left_on', v_left_on,
    'kind', p_kind,
    'reason', p_reason,
    'destination_school', p_destination_school,
    'conduct', p_conduct,
    'dues_outstanding', v_dues,
    'issued_at', now()
  );

  perform set_config('app.allow_lifecycle', 'on', true);

  if v_enrolment.id is not null then
    update public.enrolments set status = 'withdrawn', ended_on = v_left_on where id = v_enrolment.id;
  end if;

  update public.students set status = 'withdrawn' where id = p_student_id;

  insert into public.student_lifecycle_events
    (institution_id, student_id, kind, from_enrolment_id, effective_on, reason, tc_no, tc_snapshot, created_by)
  values
    (v_student.institution_id, p_student_id, p_kind, v_enrolment.id, v_left_on, p_reason, v_tc_no, v_snapshot, v_caller)
  returning id into v_event_id;

  -- The exited student's own membership — never the caller's own row
  -- (0033/0038 self-edit guard).
  update public.memberships
  set status = 'disabled'
  where student_id = p_student_id and role = 'student' and status = 'active' and user_id <> v_caller;

  -- Linked guardians who have no other linked student still active lose
  -- portal access too; a guardian with an active sibling keeps it.
  update public.memberships gm
  set status = 'disabled'
  where gm.role = 'guardian'
    and gm.status = 'active'
    and gm.user_id <> v_caller
    and gm.guardian_id in (select gs.guardian_id from public.guardian_students gs where gs.student_id = p_student_id)
    and not exists (
      select 1
      from public.guardian_students gs2
      join public.students st2 on st2.id = gs2.student_id
      where gs2.guardian_id = gm.guardian_id and st2.status = 'active'
    );

  update public.invitations
  set revoked_at = now()
  where revoked_at is null
    and accepted_at is null
    and (
      student_id = p_student_id
      or guardian_id in (select gs.guardian_id from public.guardian_students gs where gs.student_id = p_student_id)
    );

  perform app.audit(
    v_student.institution_id,
    v_caller,
    'lifecycle.' || p_kind,
    'student',
    p_student_id,
    null,
    null,
    jsonb_build_object('tcNo', v_tc_no)
  );

  return jsonb_build_object('event_id', v_event_id, 'tc_no', v_tc_no);
end;
$$;

revoke execute on function public.exit_student(uuid, text, text, date, text, text) from public, anon;
grant execute on function public.exit_student(uuid, text, text, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- M14-T5: public.link_guardian — link an existing or brand-new guardian to
-- a student, optionally as primary. SECURITY DEFINER because a plain
-- invoker insert into guardian_students recurses (DBT-45: guardian_students
-- insert check -> guardians_select teacher-branch subquery -> back into
-- guardian_students; not fixed here, see 12-decision-log.md). Running as
-- the table owner bypasses RLS entirely, same as app.import_insert_guardian_student
-- (0066), so the recursive policy chain never evaluates.
-- ---------------------------------------------------------------------------

create function public.link_guardian(
  p_student_id uuid,
  p_relationship text,
  p_is_primary boolean default false,
  p_guardian_id uuid default null,
  p_full_name text default null,
  p_phone text default null,
  p_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_student public.students;
  v_guardian public.guardians;
  v_created boolean := false;
  v_has_id boolean := p_guardian_id is not null;
  v_has_new boolean := p_full_name is not null and p_phone is not null;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_student from public.students where id = p_student_id;
  if v_student.id is null then
    raise exception 'code:not_found' using detail = 'student not found';
  end if;

  if not app.has_role(v_student.institution_id, array['owner', 'principal', 'admin', 'admissions']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold a student.write role for this institution';
  end if;

  if v_has_id = v_has_new then
    raise exception 'code:validation_failed' using detail = 'provide exactly one of guardian_id or (full_name and phone)';
  end if;

  if v_has_id then
    select * into v_guardian from public.guardians
    where id = p_guardian_id and institution_id = v_student.institution_id;
    if v_guardian.id is null then
      raise exception 'code:validation_failed' using detail = 'guardian does not belong to this institution';
    end if;
  else
    select * into v_guardian from public.guardians
    where institution_id = v_student.institution_id and phone = p_phone;
    if v_guardian.id is null then
      insert into public.guardians (institution_id, full_name, phone, email)
      values (v_student.institution_id, p_full_name, p_phone, p_email)
      returning * into v_guardian;
      v_created := true;
    end if;
  end if;

  if p_is_primary then
    update public.guardian_students set is_primary = false
    where student_id = p_student_id and is_primary;
  end if;

  insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
  values (v_student.institution_id, v_guardian.id, p_student_id, p_relationship, p_is_primary)
  on conflict (guardian_id, student_id) do update
  set relationship = excluded.relationship, is_primary = excluded.is_primary;

  perform app.audit(
    v_student.institution_id,
    v_caller,
    'people.guardian.link',
    'guardian',
    v_guardian.id,
    null,
    null,
    jsonb_build_object('studentId', p_student_id, 'created', v_created)
  );

  return jsonb_build_object('guardian_id', v_guardian.id, 'created', v_created);
end;
$$;

revoke execute on function public.link_guardian(uuid, text, boolean, uuid, text, text, text) from public, anon;
grant execute on function public.link_guardian(uuid, text, boolean, uuid, text, text, text) to authenticated;
