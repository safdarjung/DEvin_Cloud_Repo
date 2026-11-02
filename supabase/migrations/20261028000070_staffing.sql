-- M08: period attendance, staff attendance, leave, substitution (M08-tasks.md
-- header rulings). One file, three parts appended in order:
--   Part 1 (M08-T2, this part): app.my_staff_ids, staff_attendance,
--     leave_requests + guard_leave_requests, staff_check_in, decide_leave.
--   Part 2 (M08-T3): substitutions + assign_substitution/cancel_substitution.
--   Part 3 (M08-T4): attendance_sessions.period_id + mark_period_attendance.

-- ---------------------------------------------------------------------------
-- app.my_staff_ids — RLS perf helper (lesson 7), mirrors
-- app.my_class_teacher_section_ids (0026) exactly: row-independent, called
-- as `staff_id = any((select app.my_staff_ids()))` so Postgres caches it as
-- an InitPlan per statement instead of re-evaluating per row.
-- ---------------------------------------------------------------------------

create function app.my_staff_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.staff_id
  from public.memberships m
  where m.user_id = app.current_user_id()
    and m.status = 'active'
    and m.staff_id is not null;
$$;

revoke execute on function app.my_staff_ids() from public;
grant execute on function app.my_staff_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- staff_attendance — "on leave" is never a stored status: it is derived
-- from approved leave_requests by readers (T11), never written here.
-- ---------------------------------------------------------------------------

create table public.staff_attendance (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  staff_id uuid not null references public.staff (id),
  date date not null,
  status text not null check (status in ('present', 'absent', 'late', 'half_day')),
  source text not null default 'admin' check (source in ('admin', 'self')),
  check_in_at timestamptz,
  note text check (length(note) <= 200),
  marked_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, date)
);

create index staff_attendance_institution_date_idx on public.staff_attendance (institution_id, date);

create trigger set_updated_at
before update on public.staff_attendance
for each row execute function app.set_updated_at();

alter table public.staff_attendance enable row level security;

create policy staff_attendance_select on public.staff_attendance
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or staff_id = any((select app.my_staff_ids()))
  );

create policy staff_attendance_insert on public.staff_attendance
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and app.staff_in_institution(staff_id, institution_id)
    and source = 'admin'
  );

create policy staff_attendance_update on public.staff_attendance
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and app.staff_in_institution(staff_id, institution_id)
    and source = 'admin'
  );

-- No delete policy (ruling): RLS default-denies with no matching policy.

-- ---------------------------------------------------------------------------
-- leave_requests + app.guard_leave_requests (state machine; lesson 5 bypass;
-- identity columns immutable outside decide_leave). No UPDATE/DELETE
-- policy: decisions go through the RPC only.
-- ---------------------------------------------------------------------------

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  staff_id uuid not null references public.staff (id),
  leave_type text not null check (leave_type in ('casual', 'sick', 'earned', 'unpaid', 'other')),
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

create index leave_requests_institution_status_idx on public.leave_requests (institution_id, status);
create index leave_requests_staff_start_idx on public.leave_requests (staff_id, start_date);

create trigger set_updated_at
before update on public.leave_requests
for each row execute function app.set_updated_at();

-- security definer: the overlap probe below must see every leave_requests
-- row for the target staff member regardless of the caller's own SELECT
-- visibility of other staff's rows (same reasoning as 0069's
-- guard_timetable_slots_write).
create function app.guard_leave_requests()
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

  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.decided_by := null;
    new.decided_at := null;
    new.created_by := app.current_user_id();

    if exists (
      select 1 from public.leave_requests lr
      where lr.staff_id = new.staff_id
        and lr.status in ('pending', 'approved')
        and daterange(lr.start_date, lr.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')
    ) then
      raise exception 'code:conflict' using detail = 'overlapping leave request for this staff member';
    end if;

    return new;
  end if;

  if current_setting('app.allow_leave_decision', true) is distinct from 'on' then
    raise exception 'code:forbidden' using detail = 'leave request status changes only via decide_leave';
  end if;

  if new.institution_id is distinct from old.institution_id
    or new.staff_id is distinct from old.staff_id
    or new.leave_type is distinct from old.leave_type
    or new.start_date is distinct from old.start_date
    or new.end_date is distinct from old.end_date
    or new.reason is distinct from old.reason
    or new.created_by is distinct from old.created_by
  then
    raise exception 'code:invalid_state' using detail = 'leave request identity columns are immutable';
  end if;

  return new;
end;
$$;

create trigger guard_leave_requests
before insert or update on public.leave_requests
for each row execute function app.guard_leave_requests();

alter table public.leave_requests enable row level security;

create policy leave_requests_select on public.leave_requests
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or staff_id = any((select app.my_staff_ids()))
  );

create policy leave_requests_insert on public.leave_requests
  for insert to authenticated
  with check (
    (
      app.has_role(institution_id, array['owner', 'principal', 'admin'])
      or staff_id = any((select app.my_staff_ids()))
    )
    and app.staff_in_institution(staff_id, institution_id)
  );

-- ---------------------------------------------------------------------------
-- public.staff_check_in — app.* core (revoked from everyone) + public.*
-- thin wrapper (granted to authenticated only), same split as 0069's
-- publish_timetable.
-- ---------------------------------------------------------------------------

create function app.staff_check_in(p_institution_id uuid)
returns public.staff_attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid := app.staff_id(p_institution_id);
  v_timezone text;
  v_today date;
  v_row public.staff_attendance;
begin
  if v_staff_id is null then
    raise exception 'code:forbidden' using detail = 'caller has no staff record in this institution';
  end if;

  select coalesce(settings -> 'locale' ->> 'timezone', 'Asia/Kolkata')
    into v_timezone
    from public.institutions
    where id = p_institution_id;

  v_today := (now() at time zone v_timezone)::date;

  if exists (
    select 1 from public.leave_requests lr
    where lr.staff_id = v_staff_id
      and lr.status = 'approved'
      and daterange(lr.start_date, lr.end_date, '[]') @> v_today
  ) then
    raise exception 'code:invalid_state' using detail = 'staff member is on approved leave today';
  end if;

  insert into public.staff_attendance (institution_id, staff_id, date, status, source, check_in_at, marked_by)
  values (p_institution_id, v_staff_id, v_today, 'present', 'self', now(), app.current_user_id())
  on conflict (staff_id, date) do nothing;

  select * into v_row from public.staff_attendance where staff_id = v_staff_id and date = v_today;

  return v_row;
end;
$$;

revoke execute on function app.staff_check_in(uuid) from public, anon, authenticated;

create function public.staff_check_in(p_institution_id uuid)
returns public.staff_attendance
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.staff_check_in(p_institution_id);
end;
$$;

revoke execute on function public.staff_check_in(uuid) from public, anon;
grant execute on function public.staff_check_in(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.decide_leave — app.* core (revoked from everyone) + public.*
-- thin wrapper. State machine (ruling): pending -> approved|rejected
-- (approver, never own); pending -> cancelled (requester or approver);
-- approved -> cancelled (approver, never own). Audits {status} before/after
-- only — never the reason or decision_note (lesson 10).
-- ---------------------------------------------------------------------------

create function app.decide_leave(p_leave_id uuid, p_decision text, p_note text default null)
returns public.leave_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_leave public.leave_requests;
  v_old_status text;
  v_is_approver boolean;
  v_is_requester boolean;
  v_action text;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if p_decision not in ('approved', 'rejected', 'cancelled') then
    raise exception 'code:validation_failed' using detail = 'decision must be approved, rejected or cancelled';
  end if;

  select * into v_leave from public.leave_requests where id = p_leave_id for update;
  if v_leave.id is null then
    raise exception 'code:not_found' using detail = 'leave request not found';
  end if;

  v_old_status := v_leave.status;
  v_is_approver := app.has_role(v_leave.institution_id, array['owner', 'principal', 'admin']);
  v_is_requester := v_leave.staff_id = app.staff_id(v_leave.institution_id);

  if p_decision in ('approved', 'rejected') then
    if not v_is_approver then
      raise exception 'code:forbidden' using detail = 'only owner/principal/admin may decide a leave request';
    end if;
    if v_is_requester then
      raise exception 'code:forbidden' using detail = 'cannot decide own leave request';
    end if;
    if v_old_status <> 'pending' then
      raise exception 'code:invalid_state' using detail = format('leave request must be pending to %s', p_decision);
    end if;
  elsif v_old_status = 'pending' then
    if not (v_is_requester or v_is_approver) then
      raise exception 'code:forbidden' using detail = 'only the requester or an approver may cancel a pending leave request';
    end if;
  elsif v_old_status = 'approved' then
    if not v_is_approver then
      raise exception 'code:forbidden' using detail = 'only owner/principal/admin may cancel an approved leave request';
    end if;
    if v_is_requester then
      raise exception 'code:forbidden' using detail = 'cannot decide own leave request';
    end if;
  else
    raise exception 'code:invalid_state' using detail = format('leave request status %s cannot be cancelled', v_old_status);
  end if;

  perform set_config('app.allow_leave_decision', 'on', true);

  update public.leave_requests
  set status = p_decision, decided_by = v_caller, decided_at = now(), decision_note = p_note
  where id = p_leave_id
  returning * into v_leave;

  v_action := case p_decision
    when 'approved' then 'leave.approved'
    when 'rejected' then 'leave.rejected'
    else 'leave.cancelled'
  end;

  perform app.audit(
    v_leave.institution_id,
    v_caller,
    v_action,
    'leave_request',
    v_leave.id,
    jsonb_build_object('status', v_old_status),
    jsonb_build_object('status', v_leave.status),
    null
  );

  return v_leave;
end;
$$;

revoke execute on function app.decide_leave(uuid, text, text) from public, anon, authenticated;

create function public.decide_leave(p_leave_id uuid, p_decision text, p_note text default null)
returns public.leave_requests
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.decide_leave(p_leave_id, p_decision, p_note);
end;
$$;

revoke execute on function public.decide_leave(uuid, text, text) from public, anon;
grant execute on function public.decide_leave(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- substitutions (M08-T3). No write policies: writes are RPC-only (lesson 3).
-- The two partial unique indexes (status = 'assigned') are the double-
-- booking backstop the RPC's own checks already enforce.
-- ---------------------------------------------------------------------------

create table public.substitutions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  slot_id uuid not null references public.timetable_slots (id),
  date date not null,
  period_id uuid not null references public.periods (id),
  original_teacher_id uuid not null references public.staff (id),
  substitute_teacher_id uuid not null references public.staff (id),
  leave_request_id uuid references public.leave_requests (id),
  status text not null default 'assigned' check (status in ('assigned', 'cancelled')),
  note text check (length(note) <= 200),
  created_by uuid references public.profiles (id),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (substitute_teacher_id <> original_teacher_id)
);

create unique index substitutions_slot_date_idx
  on public.substitutions (slot_id, date)
  where status = 'assigned';

create unique index substitutions_substitute_period_idx
  on public.substitutions (substitute_teacher_id, date, period_id)
  where status = 'assigned';

create trigger set_updated_at
before update on public.substitutions
for each row execute function app.set_updated_at();

alter table public.substitutions enable row level security;

create policy substitutions_select on public.substitutions
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or substitute_teacher_id = any((select app.my_staff_ids()))
    or original_teacher_id = any((select app.my_staff_ids()))
  );

-- No insert/update/delete policy (ruling): RLS default-denies every direct
-- write; assign_substitution/cancel_substitution run as the migration owner
-- (postgres), which bypasses RLS, same as every other RPC-only table here.

-- ---------------------------------------------------------------------------
-- public.assign_substitution — app.* core (revoked from everyone) +
-- public.* thin wrapper, same split as staff_check_in/decide_leave above.
-- Checks run in the exact order of the ruling so the first failing one
-- decides the error code.
-- ---------------------------------------------------------------------------

create function app.assign_substitution(
  p_slot_id uuid,
  p_date date,
  p_substitute_id uuid,
  p_leave_request_id uuid default null,
  p_note text default null
)
returns public.substitutions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_slot public.timetable_slots;
  v_version_status text;
  v_timezone text;
  v_today date;
  v_leave public.leave_requests;
  v_row public.substitutions;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_slot from public.timetable_slots where id = p_slot_id;
  if v_slot.id is null then
    raise exception 'code:not_found' using detail = 'timetable slot not found';
  end if;

  if not app.has_role(v_slot.institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold timetable.manage for this institution';
  end if;

  select status into v_version_status from public.timetable_versions where id = v_slot.version_id;
  if v_version_status is distinct from 'published' then
    raise exception 'code:invalid_state' using detail = 'the slot''s timetable version is not published';
  end if;

  select coalesce(settings -> 'locale' ->> 'timezone', 'Asia/Kolkata')
    into v_timezone
    from public.institutions
    where id = v_slot.institution_id;
  v_today := (now() at time zone v_timezone)::date;

  if extract(isodow from p_date)::int is distinct from v_slot.weekday or p_date < v_today then
    raise exception 'code:validation_failed' using detail = 'date must match the slot''s weekday and not be in the past';
  end if;

  if not exists (
    select 1 from public.staff s
    where s.id = p_substitute_id and s.institution_id = v_slot.institution_id and s.status = 'active'
  ) or p_substitute_id = v_slot.teacher_id then
    raise exception 'code:validation_failed' using detail = 'substitute must be active staff of the institution and not the slot teacher';
  end if;

  if exists (
    select 1 from public.leave_requests lr
    where lr.staff_id = p_substitute_id
      and lr.status = 'approved'
      and daterange(lr.start_date, lr.end_date, '[]') @> p_date
  ) then
    raise exception 'code:conflict' using detail = 'substitute is on approved leave for that date';
  end if;

  if exists (
    select 1 from public.timetable_slots ts
    where ts.version_id = v_slot.version_id
      and ts.teacher_id = p_substitute_id
      and ts.weekday = v_slot.weekday
      and ts.period_id = v_slot.period_id
  ) then
    raise exception 'code:conflict' using detail = 'substitute already teaches at that weekday and period';
  end if;

  if exists (
    select 1 from public.substitutions sub
    where sub.substitute_teacher_id = p_substitute_id
      and sub.date = p_date
      and sub.period_id = v_slot.period_id
      and sub.status = 'assigned'
  ) then
    raise exception 'code:conflict' using detail = 'substitute already has an assigned substitution at that date and period';
  end if;

  if exists (
    select 1 from public.substitutions sub
    where sub.slot_id = p_slot_id
      and sub.date = p_date
      and sub.status = 'assigned'
  ) then
    raise exception 'code:conflict' using detail = 'this slot already has an assigned substitution for that date';
  end if;

  if p_leave_request_id is not null then
    select * into v_leave from public.leave_requests where id = p_leave_request_id;
    if v_leave.id is null
      or v_leave.institution_id is distinct from v_slot.institution_id
      or v_leave.staff_id is distinct from v_slot.teacher_id
      or v_leave.status is distinct from 'approved'
      or not (daterange(v_leave.start_date, v_leave.end_date, '[]') @> p_date)
    then
      raise exception 'code:validation_failed' using detail = 'leave request does not belong to the slot teacher or does not cover the date as approved';
    end if;
  end if;

  insert into public.substitutions (
    institution_id, slot_id, date, period_id, original_teacher_id, substitute_teacher_id, leave_request_id, note, created_by
  )
  values (
    v_slot.institution_id, p_slot_id, p_date, v_slot.period_id, v_slot.teacher_id, p_substitute_id, p_leave_request_id, p_note, v_caller
  )
  returning * into v_row;

  perform app.audit(
    v_row.institution_id,
    v_caller,
    'substitution.assigned',
    'substitutions',
    v_row.id,
    null,
    jsonb_build_object('slot_id', v_row.slot_id, 'substitute_teacher_id', v_row.substitute_teacher_id),
    null
  );

  return v_row;
end;
$$;

revoke execute on function app.assign_substitution(uuid, date, uuid, uuid, text) from public, anon, authenticated;

create function public.assign_substitution(
  p_slot_id uuid,
  p_date date,
  p_substitute_id uuid,
  p_leave_request_id uuid default null,
  p_note text default null
)
returns public.substitutions
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.assign_substitution(p_slot_id, p_date, p_substitute_id, p_leave_request_id, p_note);
end;
$$;

revoke execute on function public.assign_substitution(uuid, date, uuid, uuid, text) from public, anon;
grant execute on function public.assign_substitution(uuid, date, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- public.cancel_substitution — app.* core (revoked from everyone) +
-- public.* thin wrapper. assigned -> cancelled only; approver roles only.
-- ---------------------------------------------------------------------------

create function app.cancel_substitution(p_substitution_id uuid)
returns public.substitutions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_sub public.substitutions;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_sub from public.substitutions where id = p_substitution_id for update;
  if v_sub.id is null then
    raise exception 'code:not_found' using detail = 'substitution not found';
  end if;

  if not app.has_role(v_sub.institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold timetable.manage for this institution';
  end if;

  if v_sub.status is distinct from 'assigned' then
    raise exception 'code:invalid_state' using detail = format('substitution must be assigned to cancel; current status is %s', v_sub.status);
  end if;

  update public.substitutions
  set status = 'cancelled', cancelled_at = now()
  where id = p_substitution_id
  returning * into v_sub;

  perform app.audit(
    v_sub.institution_id,
    v_caller,
    'substitution.cancelled',
    'substitutions',
    v_sub.id,
    jsonb_build_object('status', 'assigned'),
    jsonb_build_object('status', 'cancelled'),
    null
  );

  return v_sub;
end;
$$;

revoke execute on function app.cancel_substitution(uuid) from public, anon, authenticated;

create function public.cancel_substitution(p_substitution_id uuid)
returns public.substitutions
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.cancel_substitution(p_substitution_id);
end;
$$;

revoke execute on function public.cancel_substitution(uuid) from public, anon;
grant execute on function public.cancel_substitution(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- M08-T4 (part 3): attendance_sessions.period_id + mark_period_attendance.
-- Daily stays `period_id is null` (the default, unchanged behaviour); a
-- period register is a second, independent session for the same
-- (section, date) once a slot/period is known. `nulls not distinct` (PG 17)
-- keeps two daily sessions for the same (section, date) colliding exactly
-- as before (period_id null = period_id null).
-- ---------------------------------------------------------------------------

alter table public.attendance_sessions add column period_id uuid references public.periods (id);

alter table public.attendance_sessions drop constraint attendance_sessions_class_section_id_date_key;

alter table public.attendance_sessions
  add constraint attendance_sessions_section_date_period_key
  unique nulls not distinct (class_section_id, date, period_id);

-- app.guard_attendance_sessions_period — lesson 5 bypass. Only
-- mark_period_attendance may write a non-null period_id: it sets the
-- transaction-local GUC right before its own insert/update. A direct daily
-- write (period_id null on both sides) is untouched and keeps using the
-- pre-existing attendance_sessions_* policies.
create function app.guard_attendance_sessions_period()
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

  if tg_op = 'INSERT' then
    if new.period_id is not null and current_setting('app.allow_period_attendance', true) is distinct from 'on' then
      raise exception 'code:forbidden' using detail = 'period attendance may only be written via mark_period_attendance';
    end if;
    return new;
  end if;

  if (old.period_id is not null or new.period_id is not null) and current_setting('app.allow_period_attendance', true) is distinct from 'on' then
    raise exception 'code:forbidden' using detail = 'period attendance may only be written via mark_period_attendance';
  end if;

  return new;
end;
$$;

revoke execute on function app.guard_attendance_sessions_period() from public;

create trigger guard_attendance_sessions_period
before insert or update on public.attendance_sessions
for each row execute function app.guard_attendance_sessions_period();

-- ---------------------------------------------------------------------------
-- public.mark_period_attendance — app.* core (revoked from everyone) +
-- public.* thin wrapper, same split as every other RPC in this file. Mirrors
-- submit_attendance's write order (open session -> records -> submitted) so
-- the records trigger (app.validate_attendance_status) and the open-only
-- attendance_records RLS shape both still apply; no notify.attendance_
-- absence job (ruling: daily register stays the only notification source).
-- ---------------------------------------------------------------------------

create function app.mark_period_attendance(
  p_institution_id uuid,
  p_class_section_id uuid,
  p_period_id uuid,
  p_date date,
  p_records jsonb
)
returns public.attendance_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_staff_id uuid := app.staff_id(p_institution_id);
  v_is_admin boolean := app.has_role(p_institution_id, array['owner', 'principal', 'admin']);
  v_slot public.timetable_slots;
  v_sub public.substitutions;
  v_timezone text;
  v_today date;
  v_record_count int;
  v_rec jsonb;
  v_student_id uuid;
  v_seen_students uuid[] := array[]::uuid[];
  v_session public.attendance_sessions;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select ts.* into v_slot
  from public.timetable_slots ts
  join public.timetable_versions tv on tv.id = ts.version_id
  where tv.institution_id = p_institution_id
    and tv.status = 'published'
    and ts.class_section_id = p_class_section_id
    and ts.period_id = p_period_id
    and ts.weekday = extract(isodow from p_date)::int;
  if v_slot.id is null then
    raise exception 'code:not_found' using detail = 'no published timetable slot for this section/period/weekday';
  end if;

  select coalesce(settings -> 'locale' ->> 'timezone', 'Asia/Kolkata')
    into v_timezone
    from public.institutions
    where id = p_institution_id;
  v_today := (now() at time zone v_timezone)::date;

  if p_date > v_today then
    raise exception 'code:validation_failed' using detail = 'date cannot be in the future';
  end if;
  if not v_is_admin and p_date < v_today - 7 then
    raise exception 'code:forbidden' using detail = 'only owner/principal/admin may mark attendance more than 7 days back';
  end if;

  select * into v_sub
  from public.substitutions
  where slot_id = v_slot.id and date = p_date and status = 'assigned';

  if not v_is_admin then
    if v_sub.id is not null then
      if v_staff_id is null or v_staff_id is distinct from v_sub.substitute_teacher_id then
        raise exception 'code:forbidden' using detail = 'only the assigned substitute may mark this slot today';
      end if;
    elsif v_staff_id is null or v_staff_id is distinct from v_slot.teacher_id then
      raise exception 'code:forbidden' using detail = 'only the slot teacher, an assigned substitute, or owner/principal/admin may mark this slot';
    end if;
  end if;

  if jsonb_typeof(p_records) is distinct from 'array' then
    raise exception 'code:validation_failed' using detail = 'records must be a JSON array';
  end if;

  select count(*) into v_record_count from jsonb_array_elements(p_records);
  if v_record_count < 1 or v_record_count > 200 then
    raise exception 'code:validation_failed' using detail = 'records must contain between 1 and 200 entries';
  end if;

  for v_rec in select elem from jsonb_array_elements(p_records) as elem
  loop
    v_student_id := (v_rec ->> 'student_id')::uuid;
    if v_student_id is null then
      raise exception 'code:validation_failed' using detail = 'student_id is required for every record';
    end if;
    if v_student_id = any(v_seen_students) then
      raise exception 'code:validation_failed' using detail = format('duplicate student_id %s in records', v_student_id);
    end if;
    v_seen_students := v_seen_students || v_student_id;

    if not exists (
      select 1 from public.enrolments e
      where e.student_id = v_student_id and e.class_section_id = p_class_section_id
        and e.institution_id = p_institution_id and e.status = 'active'
    ) then
      raise exception 'code:validation_failed' using detail = format('student %s is not actively enrolled in this section', v_student_id);
    end if;
  end loop;

  if exists (
    select 1 from public.attendance_sessions s
    where s.institution_id = p_institution_id
      and s.class_section_id = p_class_section_id
      and s.date = p_date
      and s.period_id = p_period_id
  ) then
    raise exception 'code:invalid_state' using detail = 'already marked; use attendance.correct';
  end if;

  perform set_config('app.allow_period_attendance', 'on', true);

  insert into public.attendance_sessions (institution_id, class_section_id, date, period_id, status, marked_by)
  values (p_institution_id, p_class_section_id, p_date, p_period_id, 'open', v_staff_id)
  returning * into v_session;

  insert into public.attendance_records (institution_id, session_id, student_id, status, note)
  select p_institution_id, v_session.id, (elem ->> 'student_id')::uuid, elem ->> 'status', elem ->> 'note'
  from jsonb_array_elements(p_records) as elem;

  update public.attendance_sessions
  set status = 'submitted', submitted_at = now()
  where id = v_session.id
  returning * into v_session;

  perform app.audit(
    p_institution_id,
    v_caller,
    'attendance.period_marked',
    'attendance_session',
    v_session.id,
    null,
    jsonb_build_object('class_section_id', p_class_section_id, 'period_id', p_period_id, 'date', p_date),
    jsonb_build_object('record_count', v_record_count)
  );

  return v_session;
end;
$$;

revoke execute on function app.mark_period_attendance(uuid, uuid, uuid, date, jsonb) from public, anon, authenticated;

create function public.mark_period_attendance(
  p_institution_id uuid,
  p_class_section_id uuid,
  p_period_id uuid,
  p_date date,
  p_records jsonb
)
returns public.attendance_sessions
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.mark_period_attendance(p_institution_id, p_class_section_id, p_period_id, p_date, p_records);
end;
$$;

revoke execute on function public.mark_period_attendance(uuid, uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.mark_period_attendance(uuid, uuid, uuid, date, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- app.term_attendance_percentage (0009) — daily-reader compat (ruling): a
-- period register must never double-count toward the daily term %. Same
-- body as 0009, with one added filter on the join.
-- ---------------------------------------------------------------------------

create or replace function app.term_attendance_percentage(p_institution_id uuid, p_student_id uuid, p_term_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_term public.terms;
  v_section_id uuid;
  v_present numeric;
  v_denominator numeric;
begin
  select * into v_term from public.terms where id = p_term_id and institution_id = p_institution_id;
  if v_term.id is null then
    return 0;
  end if;

  select e.class_section_id into v_section_id
  from public.enrolments e
  where e.student_id = p_student_id and e.institution_id = p_institution_id
    and e.academic_year_id = v_term.academic_year_id and e.status = 'active'
  limit 1;

  if v_section_id is null then
    return 0;
  end if;

  select
    coalesce(sum(case when coalesce((codes.w ->> 'in_denominator')::boolean, false) then coalesce((codes.w ->> 'counts_present')::numeric, 0) else 0 end), 0),
    coalesce(sum(case when coalesce((codes.w ->> 'in_denominator')::boolean, false) then 1 else 0 end), 0)
  into v_present, v_denominator
  from public.attendance_records ar
  join public.attendance_sessions s on s.id = ar.session_id
  join public.institutions i on i.id = p_institution_id
  left join lateral (
    select elem as w from jsonb_array_elements(coalesce(i.settings -> 'attendance' -> 'statuses', '[]'::jsonb)) elem
    where elem ->> 'code' = ar.status
    limit 1
  ) codes on true
  where ar.student_id = p_student_id
    and ar.institution_id = p_institution_id
    and s.class_section_id = v_section_id
    and s.period_id is null
    and s.date between v_term.starts_on and v_term.ends_on;

  if v_denominator is null or v_denominator = 0 then
    return 0;
  end if;

  return round(v_present / v_denominator * 100, 2);
end;
$$;

revoke execute on function app.term_attendance_percentage(uuid, uuid, uuid) from public, anon, authenticated;
