-- RLS audit fixes (2026-11-11). Patches 0114/0115/0116/0117/0118/0124/0126/
-- 0130 without editing them.
--
--   1 payroll   salary_structures: caller may not insert/update their own
--               row (app.guard_salary_structures_self_edit; seed/service
--               role/reset exempt, same trust test as app.guard_payslips_write);
--               every insert/update audited as payroll.salary_structure.changed
--               (ids + gross_paise only).
--   2 clubs     house_points_select: staff all rows; student/guardian only
--               house-wide rows (student_id null) and their own children's.
--               House totals for every member via public.house_standings.
--               house_points gets the missing set_updated_at trigger.
--   3 health    health_profiles / health_visits / vaccinations: updated_by
--               stamped on update; update audited as health.record.updated
--               with ids and changed column names only (no clinical text).
--   4 scholarships  one live award per (student, year, rule).
--   5 hostel    allocate_hostel_room maps unique_violation -> code:conflict;
--               public.save_hostel_roll_call replaces the multi-request
--               client write in saveRollCall (one transaction, audited).
--   6 school_labs   one booked lab slot per (class section, date, period).
--   7 expenses  expenses_insert requires an active category of the same
--               institution.
--   8 FK indexes: concession_awards.rule_id, compliance_events.document_id,
--               payroll_runs.finalized_by.

-- ---------------------------------------------------------------------------
-- 1. payroll — no self-edit of salary, audit every change
-- ---------------------------------------------------------------------------

create function app.guard_salary_structures_self_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.allow_reset', true), '') = 'on'
    or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  then
    return new;
  end if;

  -- "Own" by membership link or by the staff row's own login: either one alone would leave a way around.
  if new.staff_id = any(array(select app.my_staff_ids()))
    or exists (select 1 from public.staff s where s.id = new.staff_id and s.user_id = app.current_user_id())
  then
    raise exception 'code:forbidden' using detail = 'you cannot change your own salary structure';
  end if;

  return new;
end;
$$;

revoke execute on function app.guard_salary_structures_self_edit() from public;

create trigger guard_salary_structures_self_edit
before insert or update on public.salary_structures
for each row execute function app.guard_salary_structures_self_edit();

-- Definer: app.audit is revoked from client roles.
create function app.audit_salary_structures_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('app.allow_reset', true) = 'on' then
    return null;
  end if;

  perform app.audit(
    new.institution_id,
    app.current_user_id(),
    'payroll.salary_structure.changed',
    'salary_structures',
    new.id,
    case when tg_op = 'UPDATE' then jsonb_build_object('gross_paise', old.gross_paise) end,
    jsonb_build_object('gross_paise', new.gross_paise),
    jsonb_build_object('staff_id', new.staff_id)
  );
  return null;
end;
$$;

revoke execute on function app.audit_salary_structures_change() from public;

create trigger audit_salary_structures_change
after insert or update on public.salary_structures
for each row execute function app.audit_salary_structures_change();

create index payroll_runs_finalized_by_idx on public.payroll_runs (finalized_by) where finalized_by is not null;

-- ---------------------------------------------------------------------------
-- 2. clubs — house_points scoped like house_members; standings via definer
-- ---------------------------------------------------------------------------

create trigger set_updated_at
before update on public.house_points
for each row execute function app.set_updated_at();

drop policy house_points_select on public.house_points;

create policy house_points_select on public.house_points
  for select to authenticated
  using (
    house_points.institution_id = any((select app.my_institution_ids(app.staff_roles())))
    or (
      house_points.institution_id = any((select app.member_institutions()))
      and (house_points.student_id is null or house_points.student_id = any((select app.my_student_ids())))
    )
  );

-- Per-house point totals for any active member (portal standings). Totals
-- only: no student, reason or awarder leaves the definer. Non-member: no rows.
create function public.house_standings(p_institution_id uuid)
returns table (house_id uuid, points bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select h.id, coalesce(sum(hp.points), 0)::bigint
  from public.houses h
  left join public.house_points hp
    on hp.house_id = h.id
   and hp.institution_id = h.institution_id
  where h.institution_id = p_institution_id
    and app.is_member(p_institution_id)
  group by h.id;
$$;

revoke execute on function public.house_standings(uuid) from public, anon;
grant execute on function public.house_standings(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. health — updated_by + change audit (column names only)
-- ---------------------------------------------------------------------------

alter table public.health_profiles add column updated_by uuid references public.profiles (id);
alter table public.health_visits add column updated_by uuid references public.profiles (id);
alter table public.vaccinations add column updated_by uuid references public.profiles (id);

create function app.stamp_health_updated_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Never client-supplied: empty on insert (recorded_by names the author), the caller on update.
  new.updated_by := case when tg_op = 'INSERT' then null else app.current_user_id() end;
  return new;
end;
$$;

revoke execute on function app.stamp_health_updated_by() from public;

-- Definer: app.audit is revoked from client roles. Records which columns
-- changed, never their values (medical record).
create function app.audit_health_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed jsonb;
begin
  if current_setting('app.allow_reset', true) = 'on' then
    return null;
  end if;

  select coalesce(jsonb_agg(n.key order by n.key), '[]'::jsonb) into v_changed
  from jsonb_each(to_jsonb(new)) n
  join jsonb_each(to_jsonb(old)) o on o.key = n.key
  where n.value is distinct from o.value
    and n.key not in ('updated_at', 'updated_by');

  if jsonb_array_length(v_changed) = 0 then
    return null;
  end if;

  perform app.audit(
    new.institution_id,
    app.current_user_id(),
    'health.record.updated',
    tg_table_name::text,
    new.id,
    null,
    null,
    jsonb_build_object('student_id', new.student_id, 'changed', v_changed)
  );
  return null;
end;
$$;

revoke execute on function app.audit_health_update() from public;

create trigger stamp_updated_by
before insert or update on public.health_profiles
for each row execute function app.stamp_health_updated_by();

create trigger audit_health_update
after update on public.health_profiles
for each row execute function app.audit_health_update();

create trigger stamp_updated_by
before insert or update on public.health_visits
for each row execute function app.stamp_health_updated_by();

create trigger audit_health_update
after update on public.health_visits
for each row execute function app.audit_health_update();

create trigger stamp_updated_by
before insert or update on public.vaccinations
for each row execute function app.stamp_health_updated_by();

create trigger audit_health_update
after update on public.vaccinations
for each row execute function app.audit_health_update();

-- ---------------------------------------------------------------------------
-- 4. scholarships — one live award per (student, year, rule)
-- ---------------------------------------------------------------------------

create unique index concession_awards_one_live_per_rule_key on public.concession_awards (student_id, academic_year_id, rule_id)
  where rule_id is not null and status <> 'rejected';

create index concession_awards_rule_idx on public.concession_awards (rule_id) where rule_id is not null;

-- ---------------------------------------------------------------------------
-- 5. hostel — allocate maps the unique-index race to conflict; roll call
-- saved by one definer
-- ---------------------------------------------------------------------------

create or replace function public.allocate_hostel_room(p_room_id uuid, p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.hostel_rooms;
  v_student_status text;
  v_occupied int;
  v_today date;
  v_allocation_id uuid;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  -- Row lock serialises concurrent allocations to the same room (capacity).
  select * into v_room from public.hostel_rooms where id = p_room_id for update;

  if v_room.id is null or not app.is_member(v_room.institution_id) then
    raise exception 'code:not_found' using detail = 'room not found';
  end if;

  if not app.has_role(v_room.institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold hostel.manage for this institution';
  end if;

  if not v_room.is_active then
    raise exception 'code:invalid_state' using detail = 'room is inactive';
  end if;

  select s.status into v_student_status
  from public.students s
  where s.id = p_student_id and s.institution_id = v_room.institution_id;

  if v_student_status is null then
    raise exception 'code:not_found' using detail = 'student not found';
  end if;

  if v_student_status <> 'active' then
    raise exception 'code:invalid_state' using detail = 'student is not active';
  end if;

  if exists (
    select 1 from public.hostel_allocations a
    where a.student_id = p_student_id and a.vacated_on is null
  ) then
    raise exception 'code:conflict' using detail = 'student already has an active hostel allocation';
  end if;

  select count(*) into v_occupied
  from public.hostel_allocations a
  where a.room_id = p_room_id and a.vacated_on is null;

  if v_occupied >= v_room.capacity then
    raise exception 'code:conflict' using detail = 'room is full';
  end if;

  select (now() at time zone coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata'))::date into v_today
  from public.institutions i where i.id = v_room.institution_id;

  -- The exists() check above races a concurrent allocation of the same
  -- student into another room; hostel_allocations_one_active_key decides.
  begin
    insert into public.hostel_allocations (institution_id, room_id, student_id, allocated_on, allocated_by)
    values (v_room.institution_id, p_room_id, p_student_id, v_today, app.current_user_id())
    returning id into v_allocation_id;
  exception when unique_violation then
    raise exception 'code:conflict' using detail = 'student already has an active hostel allocation';
  end;

  perform app.audit(
    v_room.institution_id,
    app.current_user_id(),
    'hostel.allocation.created',
    'hostel_allocation',
    v_allocation_id,
    null,
    jsonb_build_object('room_id', p_room_id, 'student_id', p_student_id, 'allocated_on', v_today),
    null
  );

  return jsonb_build_object('allocation_id', v_allocation_id, 'room_id', p_room_id, 'allocated_on', v_today);
end;
$$;

-- p_entries: [{student_id uuid, status present|absent|on_leave, note? 1-200}],
-- 1-500 entries, each student once and holding an active allocation in the
-- institution. Creates the (date, session) roll call on first save; later
-- saves upsert its entries. Returns the roll call id.
create function public.save_hostel_roll_call(p_institution_id uuid, p_taken_on date, p_session text, p_entries jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.current_user_id();
  v_roll_call_id uuid;
  v_absent int;
begin
  if v_uid is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if p_institution_id is null or not app.is_member(p_institution_id) then
    raise exception 'code:not_found' using detail = 'institution not found';
  end if;

  if not app.has_role(p_institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold hostel.manage for this institution';
  end if;

  if p_taken_on is null or p_session is null or p_session not in ('morning', 'evening', 'night') then
    raise exception 'code:validation_failed' using detail = 'date and a valid session are required';
  end if;

  if jsonb_typeof(p_entries) is distinct from 'array'
    or jsonb_array_length(p_entries) < 1
    or jsonb_array_length(p_entries) > 500
    or exists (select 1 from jsonb_array_elements(p_entries) x where jsonb_typeof(x) is distinct from 'object')
  then
    raise exception 'code:validation_failed' using detail = 'entries must be an array of 1-500 objects';
  end if;

  begin
    if exists (
      select 1 from jsonb_to_recordset(p_entries) as e(student_id uuid, status text, note text)
      where e.student_id is null
        or e.status is null
        or e.status not in ('present', 'absent', 'on_leave')
        or (e.note is not null and char_length(e.note) not between 1 and 200)
    ) then
      raise exception 'code:validation_failed' using detail = 'each entry needs student_id, a valid status and an optional 1-200 character note';
    end if;
  exception when invalid_text_representation then
    raise exception 'code:validation_failed' using detail = 'student_id must be a uuid';
  end;

  if (select count(distinct e.student_id) from jsonb_to_recordset(p_entries) as e(student_id uuid)) <> jsonb_array_length(p_entries) then
    raise exception 'code:validation_failed' using detail = 'each student may appear once';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_entries) as e(student_id uuid)
    where not exists (
      select 1 from public.hostel_allocations a
      where a.student_id = e.student_id
        and a.institution_id = p_institution_id
        and a.vacated_on is null
    )
  ) then
    raise exception 'code:validation_failed' using detail = 'every student must have an active hostel allocation';
  end if;

  insert into public.hostel_roll_calls (institution_id, taken_on, session, taken_by)
  values (p_institution_id, p_taken_on, p_session, v_uid)
  on conflict on constraint hostel_roll_calls_day_session_key do nothing;

  select r.id into v_roll_call_id
  from public.hostel_roll_calls r
  where r.institution_id = p_institution_id and r.taken_on = p_taken_on and r.session = p_session
  for update;

  insert into public.hostel_roll_call_entries (institution_id, roll_call_id, student_id, status, note)
  select p_institution_id, v_roll_call_id, e.student_id, e.status, e.note
  from jsonb_to_recordset(p_entries) as e(student_id uuid, status text, note text)
  on conflict on constraint hostel_roll_call_entries_student_key
  do update set status = excluded.status, note = excluded.note;

  select count(*) filter (where e.status = 'absent') into v_absent
  from jsonb_to_recordset(p_entries) as e(status text);

  perform app.audit(
    p_institution_id,
    v_uid,
    'hostel.rollcall.save',
    'hostel_roll_calls',
    v_roll_call_id,
    null,
    jsonb_build_object('taken_on', p_taken_on, 'session', p_session, 'entries', jsonb_array_length(p_entries), 'absent', v_absent),
    null
  );

  return v_roll_call_id;
end;
$$;

revoke execute on function public.save_hostel_roll_call(uuid, date, text, jsonb) from public, anon;
grant execute on function public.save_hostel_roll_call(uuid, date, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. school_labs — a class section is in one lab per period
-- (book_school_lab already maps any unique_violation to code:conflict)
-- ---------------------------------------------------------------------------

create unique index school_lab_bookings_section_one_booked_key on public.school_lab_bookings (class_section_id, date, period_id)
  where status = 'booked';

-- ---------------------------------------------------------------------------
-- 7. expenses — insert only against an active category of the same school
-- ---------------------------------------------------------------------------

drop policy expenses_insert on public.expenses;

create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (
    expenses.institution_id = any((select app.my_institution_ids(app.finance_roles())))
    and expenses.recorded_by = (select app.current_user_id())
    and expenses.amount_paise > 0
    and expenses.reverses_expense_id is null
    and exists (
      select 1 from public.expense_categories c
      where c.id = expenses.category_id
        and c.institution_id = expenses.institution_id
        and c.is_active
    )
  );

-- ---------------------------------------------------------------------------
-- 8. compliance — FK index
-- ---------------------------------------------------------------------------

create index compliance_events_document_idx on public.compliance_events (document_id) where document_id is not null;
