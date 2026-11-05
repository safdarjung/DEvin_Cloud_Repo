-- X01: student leave requests + daily diary (X01-tasks.md header rulings).
-- One file, two parts appended in order:
--   Part 1 (X01-T4, this part): student_leave_requests + guard +
--     app.premark_student_leave + decide_student_leave;
--     app.module_catalog rows for `student_leave`, `diary`.
--   Part 2 (X01-T5): diary_entries + diary_acknowledgements + notify trigger.

-- ---------------------------------------------------------------------------
-- student_leave_requests + app.guard_student_leave_requests (state machine;
-- lesson 5 bypass; identity columns immutable outside decide_student_leave).
-- No UPDATE/DELETE policy: decisions go through the RPC only. Mirrors
-- 0070's leave_requests/guard_leave_requests shape; class_section_id is set
-- by the guard from the student's active enrolment, never from input.
-- ---------------------------------------------------------------------------

create table public.student_leave_requests (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  student_id uuid not null references public.students (id),
  class_section_id uuid not null references public.class_sections (id),
  start_date date not null,
  end_date date not null,
  reason text not null check (length(reason) between 1 and 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  created_by uuid not null references public.profiles (id),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text check (length(decision_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date and end_date - start_date <= 30)
);

create index student_leave_requests_institution_status_idx on public.student_leave_requests (institution_id, status);
create index student_leave_requests_student_start_idx on public.student_leave_requests (student_id, start_date);
create index student_leave_requests_section_status_idx on public.student_leave_requests (class_section_id, status);

create trigger set_updated_at
before update on public.student_leave_requests
for each row execute function app.set_updated_at();

-- security definer: the overlap probe below must see every
-- student_leave_requests row for the target student regardless of the
-- caller's own SELECT visibility of other students' rows (same reasoning
-- as 0070's guard_leave_requests).
create function app.guard_student_leave_requests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_section_id uuid;
  v_timezone text;
  v_today date;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.decided_by := null;
    new.decided_at := null;
    new.created_by := app.current_user_id();

    select e.class_section_id into v_section_id
    from public.enrolments e
    where e.student_id = new.student_id
      and e.institution_id = new.institution_id
      and e.status = 'active'
    limit 1;

    if v_section_id is null then
      raise exception 'code:validation_failed' using detail = 'student has no active enrolment in this institution';
    end if;
    new.class_section_id := v_section_id;

    select coalesce(settings -> 'locale' ->> 'timezone', 'Asia/Kolkata')
      into v_timezone
      from public.institutions
      where id = new.institution_id;
    v_today := (now() at time zone v_timezone)::date;

    if new.start_date < v_today - 7 then
      raise exception 'code:validation_failed' using detail = 'leave cannot start more than 7 days in the past';
    end if;

    if exists (
      select 1 from public.student_leave_requests slr
      where slr.student_id = new.student_id
        and slr.status in ('pending', 'approved')
        and daterange(slr.start_date, slr.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')
    ) then
      raise exception 'code:conflict' using detail = 'overlapping leave request for this student';
    end if;

    return new;
  end if;

  if current_setting('app.allow_student_leave_decision', true) is distinct from 'on' then
    raise exception 'code:forbidden' using detail = 'student leave request status changes only via decide_student_leave';
  end if;

  if new.institution_id is distinct from old.institution_id
    or new.student_id is distinct from old.student_id
    or new.class_section_id is distinct from old.class_section_id
    or new.start_date is distinct from old.start_date
    or new.end_date is distinct from old.end_date
    or new.reason is distinct from old.reason
    or new.created_by is distinct from old.created_by
  then
    raise exception 'code:invalid_state' using detail = 'student leave request identity columns are immutable';
  end if;

  return new;
end;
$$;

create trigger guard_student_leave_requests
before insert or update on public.student_leave_requests
for each row execute function app.guard_student_leave_requests();

alter table public.student_leave_requests enable row level security;

create policy student_leave_requests_select on public.student_leave_requests
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or class_section_id = any((select app.my_class_teacher_section_ids()))
    or student_id = any((select app.my_student_ids()))
  );

create policy student_leave_requests_insert on public.student_leave_requests
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['guardian'])
    and student_id in (select app.guardian_student_ids(institution_id))
  );

-- ---------------------------------------------------------------------------
-- app.premark_student_leave — attendance-owned SQL helper (rulings),
-- called only by decide_student_leave's approved branch. Daily sessions
-- only (period_id is null); never touches period registers; never
-- enqueues notify.attendance_absence. Mirrors 0014's correct_attendance
-- shape for the submitted-session correction branch.
-- ---------------------------------------------------------------------------

create function app.premark_student_leave(p_leave public.student_leave_requests)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_leave_code_configured boolean;
  v_actively_enrolled boolean;
  v_timezone text;
  v_today date;
  v_staff_id uuid;
  v_d date;
  v_touched int := 0;
  v_session public.attendance_sessions;
  v_record public.attendance_records;
  v_is_holiday boolean;
begin
  select exists (
    select 1
    from public.institutions i,
         jsonb_array_elements(coalesce(i.settings -> 'attendance' -> 'statuses', '[]'::jsonb)) as s
    where i.id = p_leave.institution_id and s ->> 'code' = 'OL'
  ) into v_leave_code_configured;

  if not v_leave_code_configured then
    return 0;
  end if;

  select exists (
    select 1 from public.enrolments e
    where e.student_id = p_leave.student_id
      and e.class_section_id = p_leave.class_section_id
      and e.status = 'active'
  ) into v_actively_enrolled;

  if not v_actively_enrolled then
    return 0;
  end if;

  select coalesce(settings -> 'locale' ->> 'timezone', 'Asia/Kolkata')
    into v_timezone
    from public.institutions
    where id = p_leave.institution_id;
  v_today := (now() at time zone v_timezone)::date;

  v_staff_id := app.staff_id(p_leave.institution_id);
  v_d := p_leave.start_date;

  while v_d <= p_leave.end_date loop
    if extract(isodow from v_d) = 7 then
      v_d := v_d + 1;
      continue;
    end if;

    select * into v_session
    from public.attendance_sessions
    where class_section_id = p_leave.class_section_id and date = v_d and period_id is null;

    if v_session.id is not null then
      if v_session.status = 'open' then
        insert into public.attendance_records (institution_id, session_id, student_id, status)
        values (p_leave.institution_id, v_session.id, p_leave.student_id, 'OL')
        on conflict (session_id, student_id) do update set status = 'OL';
        v_touched := v_touched + 1;
      else
        select * into v_record
        from public.attendance_records
        where session_id = v_session.id and student_id = p_leave.student_id;

        if v_record.id is not null and v_record.status <> 'OL' then
          insert into public.attendance_corrections (institution_id, record_id, old_status, new_status, reason, corrected_by)
          values (p_leave.institution_id, v_record.id, v_record.status, 'OL', 'Student leave approved', v_staff_id);

          update public.attendance_records
          set status = 'OL'
          where id = v_record.id;

          perform app.audit(
            p_leave.institution_id,
            app.current_user_id(),
            'attendance.corrected',
            'attendance_record',
            v_record.id,
            jsonb_build_object('status', v_record.status),
            jsonb_build_object('status', 'OL'),
            null
          );

          v_touched := v_touched + 1;
        end if;
      end if;
    elsif v_d < v_today then
      -- no register was taken for a past date; nothing to pre-mark.
      null;
    else
      select exists (
        select 1
        from public.academic_calendar_events ce
        where ce.institution_id = p_leave.institution_id
          and ce.kind = 'holiday'
          and v_d between ce.starts_on and ce.ends_on
      ) and app.module_enabled(p_leave.institution_id, 'calendar') into v_is_holiday;

      if not v_is_holiday then
        insert into public.attendance_sessions (institution_id, class_section_id, date, status, marked_by)
        values (p_leave.institution_id, p_leave.class_section_id, v_d, 'open', null)
        returning * into v_session;

        insert into public.attendance_records (institution_id, session_id, student_id, status)
        values (p_leave.institution_id, v_session.id, p_leave.student_id, 'OL');

        v_touched := v_touched + 1;
      end if;
    end if;

    v_d := v_d + 1;
  end loop;

  return v_touched;
end;
$$;

revoke all on function app.premark_student_leave(public.student_leave_requests) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- public.decide_student_leave — app.* core (revoked from everyone) +
-- public.* thin wrapper, same split as 0070's decide_leave. State machine
-- (ruling): pending -> approved|rejected (owner/principal/admin or the
-- section's class teacher); pending -> cancelled (requester only).
-- Approved/rejected/cancelled are all terminal. Audits {status} before/
-- after (+ premarked count when approved) only — never the reason or
-- decision_note (lesson 10).
-- ---------------------------------------------------------------------------

create function app.decide_student_leave(p_leave_id uuid, p_decision text, p_note text default null)
returns public.student_leave_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_leave public.student_leave_requests;
  v_old_status text;
  v_is_admin boolean;
  v_is_class_teacher boolean;
  v_action text;
  v_premarked int := 0;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if p_decision not in ('approved', 'rejected', 'cancelled') or (p_note is not null and length(p_note) > 500) then
    raise exception 'code:validation_failed' using detail = 'decision must be approved, rejected or cancelled; note max 500 characters';
  end if;

  select * into v_leave from public.student_leave_requests where id = p_leave_id for update;

  if v_leave.id is null or not app.is_member(v_leave.institution_id) then
    raise exception 'code:not_found' using detail = 'student leave request not found';
  end if;

  v_old_status := v_leave.status;
  v_is_admin := app.has_role(v_leave.institution_id, array['owner', 'principal', 'admin']);
  v_is_class_teacher := exists (
    select 1 from public.class_sections cs
    where cs.id = v_leave.class_section_id and cs.class_teacher_id = app.staff_id(v_leave.institution_id)
  );

  if p_decision in ('approved', 'rejected') then
    if not (v_is_admin or v_is_class_teacher) then
      raise exception 'code:forbidden' using detail = 'only owner/principal/admin or the class teacher may decide a student leave request';
    end if;
  else
    if v_leave.created_by <> v_caller then
      raise exception 'code:forbidden' using detail = 'only the requester may cancel their own leave request';
    end if;
  end if;

  if v_old_status <> 'pending' then
    raise exception 'code:invalid_state' using detail = format('student leave request status %s cannot be %s', v_old_status, p_decision);
  end if;

  perform set_config('app.allow_student_leave_decision', 'on', true);

  update public.student_leave_requests
  set status = p_decision, decided_by = v_caller, decided_at = now(), decision_note = p_note
  where id = p_leave_id
  returning * into v_leave;

  if p_decision = 'approved' then
    v_premarked := app.premark_student_leave(v_leave);
  end if;

  if p_decision in ('approved', 'rejected') then
    perform app.enqueue_job(
      v_leave.institution_id,
      'notify.student_leave_decided',
      jsonb_build_object('leave_id', v_leave.id),
      'student_leave:' || v_leave.id
    );
  end if;

  v_action := case p_decision
    when 'approved' then 'student_leave.approved'
    when 'rejected' then 'student_leave.rejected'
    else 'student_leave.cancelled'
  end;

  perform app.audit(
    v_leave.institution_id,
    v_caller,
    v_action,
    'student_leave_request',
    v_leave.id,
    jsonb_build_object('status', v_old_status),
    case when p_decision = 'approved'
      then jsonb_build_object('status', v_leave.status, 'premarked', v_premarked)
      else jsonb_build_object('status', v_leave.status)
    end,
    null
  );

  return v_leave;
end;
$$;

revoke execute on function app.decide_student_leave(uuid, text, text) from public, anon, authenticated;

create function public.decide_student_leave(p_leave_id uuid, p_decision text, p_note text default null)
returns public.student_leave_requests
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.decide_student_leave(p_leave_id, p_decision, p_note);
end;
$$;

revoke execute on function public.decide_student_leave(uuid, text, text) from public, anon;
grant execute on function public.decide_student_leave(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- app.module_catalog rows for `student_leave`, `diary` (D45 module system,
-- 0084's table; never redefined here, only inserted into).
-- ---------------------------------------------------------------------------

insert into app.module_catalog (key, default_enabled) values
  ('student_leave', true),
  ('diary', true)
on conflict (key) do update set default_enabled = excluded.default_enabled;

-- ---------------------------------------------------------------------------
-- Part 2 (X01-T5): diary_entries + diary_acknowledgements.
-- No UPDATE policy on either table (post is delete + repost; ack is
-- insert-once, enforced by the unique constraint — 23505 is mapped to
-- success by the action layer). FK binding to the row's own institution
-- follows 0072's lesson-2, table-qualified pattern. The notify trigger is
-- a plain AFTER INSERT definer, bypassed under the lesson-5 predicate so
-- service-role seed/import rows never enqueue a job.
-- ---------------------------------------------------------------------------

create table public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  class_section_id uuid not null references public.class_sections (id),
  subject_id uuid references public.subjects (id),
  entry_date date not null,
  body text not null check (length(body) between 1 and 2000),
  due_date date check (due_date is null or due_date >= entry_date),
  requires_ack boolean not null default false,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index diary_entries_section_date_idx on public.diary_entries (class_section_id, entry_date desc);
create index diary_entries_institution_date_idx on public.diary_entries (institution_id, entry_date);

create trigger set_updated_at
before update on public.diary_entries
for each row execute function app.set_updated_at();

alter table public.diary_entries enable row level security;

create policy diary_entries_select on public.diary_entries
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or class_section_id = any((select app.my_taught_section_ids()))
    or class_section_id = any((select app.my_student_section_ids()))
  );

create policy diary_entries_insert on public.diary_entries
  for insert to authenticated
  with check (
    (
      app.has_role(institution_id, array['owner', 'principal', 'admin'])
      or class_section_id = any((select app.my_taught_section_ids()))
    )
    and exists (
      select 1 from public.class_sections cs
      where cs.id = diary_entries.class_section_id and cs.institution_id = diary_entries.institution_id
    )
    and (
      diary_entries.subject_id is null
      or exists (
        select 1 from public.subjects s
        where s.id = diary_entries.subject_id and s.institution_id = diary_entries.institution_id
      )
    )
    and created_by = (select app.current_user_id())
  );

create policy diary_entries_delete on public.diary_entries
  for delete to authenticated
  using (
    created_by = (select app.current_user_id())
    or app.has_role(institution_id, array['owner', 'principal', 'admin'])
  );

-- AAI (after-insert-always, lesson-5 bypass) — a plain insert trigger, not a
-- state-machine guard, so it runs after the row commits visibly rather than
-- inside a BEFORE trigger. service_role/postgres (seed, demo:reset,
-- imports) never enqueue a notification.
create function app.enqueue_diary_entry_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  then
    return new;
  end if;

  perform app.enqueue_job(
    new.institution_id,
    'notify.diary_entry',
    jsonb_build_object('entry_id', new.id),
    'diary:' || new.id
  );

  return new;
end;
$$;

revoke execute on function app.enqueue_diary_entry_notification() from public;

create trigger enqueue_diary_entry_notification
after insert on public.diary_entries
for each row execute function app.enqueue_diary_entry_notification();

create table public.diary_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  entry_id uuid not null references public.diary_entries (id) on delete cascade,
  student_id uuid not null references public.students (id),
  acknowledged_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entry_id, student_id)
);

create trigger set_updated_at
before update on public.diary_acknowledgements
for each row execute function app.set_updated_at();

alter table public.diary_acknowledgements enable row level security;

create policy diary_acknowledgements_select on public.diary_acknowledgements
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or student_id = any((select app.my_student_ids()))
    or exists (
      select 1 from public.diary_entries e
      where e.id = diary_acknowledgements.entry_id
        and e.class_section_id = any((select app.my_taught_section_ids()))
    )
  );

create policy diary_acknowledgements_insert on public.diary_acknowledgements
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['guardian'])
    and student_id in (select app.guardian_student_ids(institution_id))
    and acknowledged_by = (select app.current_user_id())
    and exists (
      select 1 from public.diary_entries e
      join public.enrolments en
        on en.class_section_id = e.class_section_id
        and en.student_id = diary_acknowledgements.student_id
        and en.status = 'active'
      where e.id = diary_acknowledgements.entry_id
        and e.institution_id = diary_acknowledgements.institution_id
        and e.requires_ack
    )
  );
