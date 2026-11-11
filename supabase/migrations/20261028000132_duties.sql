-- Features-18 #24 (SPEC §A3): staff duty roster (module key `duties`,
-- default enabled). Definer shape from 0126 (row lock, non-member ->
-- not_found, member without role -> forbidden, unique_violation ->
-- code:conflict); staff/leave rules from 0070; holidays from 0075.
--
-- Tables
--   duty_types          name (gate, bus, lunch, assembly, invigilation ...),
--                       slots_per_day 1-20, is_active. No delete (deactivate).
--   duty_assignments    duty_type_id, staff_id, date, status
--                       assigned/swapped/cancelled. Written only by the
--                       definers below. One staff one duty per date+type:
--                       partial unique duty_assignments_one_active_key on
--                       (staff_id, duty_type_id, date) where status <> 'cancelled'.
--   duty_swap_requests  assignment_id, from_staff_id, to_staff_id, status
--                       pending/accepted/rejected/cancelled, requested_by,
--                       decided_at. Written only by the definers below. One
--                       pending request per assignment (partial unique
--                       duty_swap_requests_one_pending_key).
--
-- Functions (public, PostgREST-callable; all security definer)
--   generate_duty_roster(p_institution_id uuid, p_from date, p_to date)
--     -> jsonb {created, school_days, skipped_sundays, skipped_holidays,
--               skipped_already_rostered, unfilled_slots}
--     duty.manage (owner/principal/admin). p_from >= institution today,
--     p_to >= p_from, at most 62 days. Locks the institution's active duty
--     types (serialises concurrent runs). Per day (skip Sundays and
--     academic_calendar_events kind 'holiday') and per active type (name,
--     id order): a (type, date) with any assignment row, cancelled
--     included, is already rostered and skipped (idempotent; a manager's
--     cancellation is never undone). Otherwise picks slots_per_day staff:
--     staff.status 'active' and is_teaching, no approved leave covering the
--     day, ordered by count of non-cancelled assignments dated
--     [day - 60, day] (rows created earlier in this call included), then
--     staff id. Fewer eligible staff than slots -> counted in unfilled_slots.
--   set_duty_assignment(p_assignment_id uuid, p_staff_id uuid default null,
--     p_cancel boolean default false) -> jsonb {assignment_id, staff_id, status}
--     duty.manage. Exactly one of p_staff_id (reassign; active staff of the
--     institution, not on approved leave -> else code:conflict) or
--     p_cancel = true. Assignment not cancelled and dated today or later.
--     Reassign sets status 'assigned'. Pending swap requests on the
--     assignment are cancelled.
--   request_duty_swap(p_assignment_id uuid, p_to_staff_id uuid)
--     -> jsonb {request_id, assignment_id, status}
--     duty.swap (teacher), caller is the assignment's staff, assignment
--     active and dated after today. Target: another active staff member
--     with an active teacher membership of the institution, not already
--     holding this duty that day (leave is checked on accept, so a
--     colleague's leave is never revealed to the requester).
--   respond_duty_swap(p_request_id uuid, p_accept boolean)
--     -> jsonb {request_id, assignment_id, status}
--     teacher who is the request's to_staff. Pending only. Accept: the
--     assignment must still be held by from_staff, active, dated after
--     today, target not on leave; staff_id moves to the target and status
--     becomes 'swapped' in the same transaction (unique rule ->
--     code:conflict).
--   cancel_duty_swap(p_request_id uuid) -> jsonb {request_id, status}
--     teacher who is the request's from_staff. Pending only.
--   duty_staff_options(p_institution_id uuid)
--     -> setof (staff_id uuid, display_name text), stable, read-only
--     duty.read (all 7 staff roles); students and guardians code:forbidden,
--     non-member code:not_found. Active staff of the institution eligible
--     under generate_duty_roster's rule (status 'active' and is_teaching;
--     leave is not applied, so no colleague's leave is revealed), ordered by
--     name, at most 500. Only id and name, nothing else from staff.
--     Exists because staff_select (0004) hides colleagues from teachers, so
--     roster names and the swap picker need this narrow read.
--   Lock order everywhere: assignment row, then request row.
--
-- RLS matrix (M = owner, principal, admin; ST = all 7 staff roles =
-- duty.read; T = teacher)
--   table               select                  insert  update        delete
--   duty_types          ST                      M       M (columns)   none
--   duty_assignments    ST (roster is public    RPC     RPC           none
--                       to staff)
--   duty_swap_requests  M; T where from/to      RPC     RPC           none
--                       staff is their own
--   Guardians and students: no access.
--
-- Seed notes (service role bypasses RLS and the definers' rules)
--   - duty_assignments.staff_id must be same-institution staff (bound only by
--     the definers); keep (staff_id, duty_type_id, date) unique among
--     non-cancelled rows; past dates are fine for seed.
--   - duty_swap_requests.requested_by: not null, no default — seed must set
--     it. decided_at must be set exactly when status <> 'pending'.
--
-- Reuses (never redefines): app.set_updated_at, app.current_user_id,
-- app.is_member, app.has_role (0001), app.audit (0003),
-- app.my_institution_ids (0020), app.my_staff_ids (0070),
-- app.module_catalog (0084).

insert into app.module_catalog (key, default_enabled) values ('duties', true)
on conflict (key) do update set default_enabled = excluded.default_enabled;

-- ---------------------------------------------------------------------------
-- duty_types
-- ---------------------------------------------------------------------------

create table public.duty_types (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  name text not null check (char_length(name) between 1 and 60),
  slots_per_day smallint not null default 1 check (slots_per_day between 1 and 20),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint duty_types_id_institution_key unique (id, institution_id),
  constraint duty_types_name_key unique (institution_id, name)
);

create trigger set_updated_at
before update on public.duty_types
for each row execute function app.set_updated_at();

alter table public.duty_types enable row level security;

create policy duty_types_select on public.duty_types
  for select to authenticated
  using (duty_types.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'admissions', 'accountant', 'exam_controller', 'teacher']))));

create policy duty_types_insert on public.duty_types
  for insert to authenticated
  with check (duty_types.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

create policy duty_types_update on public.duty_types
  for update to authenticated
  using (duty_types.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))))
  with check (duty_types.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

revoke all on public.duty_types from anon, authenticated;
grant select, insert on public.duty_types to authenticated;
grant update (name, slots_per_day, is_active) on public.duty_types to authenticated;
grant select, insert, update, delete on public.duty_types to service_role;

-- ---------------------------------------------------------------------------
-- duty_assignments — written only by the definers below (lesson 3).
-- ---------------------------------------------------------------------------

create table public.duty_assignments (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  duty_type_id uuid not null,
  staff_id uuid not null references public.staff (id),
  date date not null,
  status text not null default 'assigned' check (status in ('assigned', 'swapped', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint duty_assignments_type_fk foreign key (duty_type_id, institution_id) references public.duty_types (id, institution_id),
  -- Composite-FK target for duty_swap_requests.
  constraint duty_assignments_id_institution_key unique (id, institution_id)
);

create unique index duty_assignments_one_active_key on public.duty_assignments (staff_id, duty_type_id, date) where status <> 'cancelled';
create index duty_assignments_institution_date_idx on public.duty_assignments (institution_id, date);
create index duty_assignments_type_date_idx on public.duty_assignments (duty_type_id, date);
create index duty_assignments_staff_date_idx on public.duty_assignments (staff_id, date);

create trigger set_updated_at
before update on public.duty_assignments
for each row execute function app.set_updated_at();

alter table public.duty_assignments enable row level security;

create policy duty_assignments_select on public.duty_assignments
  for select to authenticated
  using (duty_assignments.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'admissions', 'accountant', 'exam_controller', 'teacher']))));

revoke all on public.duty_assignments from anon, authenticated;
grant select on public.duty_assignments to authenticated;
grant select, insert, update, delete on public.duty_assignments to service_role;

-- ---------------------------------------------------------------------------
-- duty_swap_requests — written only by the definers below.
-- ---------------------------------------------------------------------------

create table public.duty_swap_requests (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  assignment_id uuid not null,
  from_staff_id uuid not null references public.staff (id),
  to_staff_id uuid not null references public.staff (id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  requested_by uuid not null references public.profiles (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint duty_swap_requests_assignment_fk foreign key (assignment_id, institution_id) references public.duty_assignments (id, institution_id),
  constraint duty_swap_requests_distinct_staff check (from_staff_id <> to_staff_id),
  constraint duty_swap_requests_decided_pair check ((status = 'pending') = (decided_at is null))
);

create unique index duty_swap_requests_one_pending_key on public.duty_swap_requests (assignment_id) where status = 'pending';
create index duty_swap_requests_institution_status_idx on public.duty_swap_requests (institution_id, status);
create index duty_swap_requests_from_staff_idx on public.duty_swap_requests (from_staff_id);
create index duty_swap_requests_to_staff_idx on public.duty_swap_requests (to_staff_id);

create trigger set_updated_at
before update on public.duty_swap_requests
for each row execute function app.set_updated_at();

alter table public.duty_swap_requests enable row level security;

create policy duty_swap_requests_select on public.duty_swap_requests
  for select to authenticated
  using (
    duty_swap_requests.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or (
      duty_swap_requests.institution_id = any((select app.my_institution_ids(array['teacher'])))
      and (
        duty_swap_requests.from_staff_id = any((select app.my_staff_ids()))
        or duty_swap_requests.to_staff_id = any((select app.my_staff_ids()))
      )
    )
  );

revoke all on public.duty_swap_requests from anon, authenticated;
grant select on public.duty_swap_requests to authenticated;
grant select, insert, update, delete on public.duty_swap_requests to service_role;

-- ---------------------------------------------------------------------------
-- public.generate_duty_roster — fair rotation (header for the rules).
-- ---------------------------------------------------------------------------

create function public.generate_duty_roster(p_institution_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_today date;
  v_day date;
  v_type record;
  v_inserted int;
  v_created int := 0;
  v_unfilled int := 0;
  v_school_days int := 0;
  v_sundays int := 0;
  v_holidays int := 0;
  v_already int := 0;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if p_institution_id is null or not app.is_member(p_institution_id) then
    raise exception 'code:not_found' using detail = 'institution not found';
  end if;

  if not app.has_role(p_institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold duty.manage for this institution';
  end if;

  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'code:validation_failed' using detail = 'p_to must be on or after p_from';
  end if;

  if p_to - p_from > 61 then
    raise exception 'code:validation_failed' using detail = 'the range must be at most 62 days';
  end if;

  select (now() at time zone coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata'))::date into v_today
  from public.institutions i where i.id = p_institution_id;

  if p_from < v_today then
    raise exception 'code:validation_failed' using detail = 'roster dates cannot be in the past';
  end if;

  -- Concurrent runs for one institution queue here; the second then sees the
  -- first's rows and skips those days as already rostered.
  perform 1
  from public.duty_types dt
  where dt.institution_id = p_institution_id and dt.is_active
  order by dt.id
  for update;

  for v_day in
    select g::date from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as g
  loop
    if extract(isodow from v_day) = 7 then
      v_sundays := v_sundays + 1;
      continue;
    end if;

    if exists (
      select 1 from public.academic_calendar_events e
      where e.institution_id = p_institution_id
        and e.kind = 'holiday'
        and v_day between e.starts_on and e.ends_on
    ) then
      v_holidays := v_holidays + 1;
      continue;
    end if;

    v_school_days := v_school_days + 1;

    for v_type in
      select dt.id, dt.slots_per_day
      from public.duty_types dt
      where dt.institution_id = p_institution_id and dt.is_active
      order by dt.name, dt.id
    loop
      if exists (
        select 1 from public.duty_assignments a
        where a.duty_type_id = v_type.id and a.date = v_day
      ) then
        v_already := v_already + 1;
        continue;
      end if;

      insert into public.duty_assignments (institution_id, duty_type_id, staff_id, date)
      select p_institution_id, v_type.id, pick.id, v_day
      from (
        select s.id
        from public.staff s
        where s.institution_id = p_institution_id
          and s.status = 'active'
          and s.is_teaching
          and not exists (
            select 1 from public.leave_requests lr
            where lr.staff_id = s.id
              and lr.institution_id = p_institution_id
              and lr.status = 'approved'
              and v_day between lr.start_date and lr.end_date
          )
        order by (
          select count(*) from public.duty_assignments a
          where a.staff_id = s.id
            and a.status <> 'cancelled'
            and a.date between v_day - 60 and v_day
        ), s.id
        limit v_type.slots_per_day
      ) as pick;

      get diagnostics v_inserted = row_count;
      v_created := v_created + v_inserted;
      v_unfilled := v_unfilled + (v_type.slots_per_day - v_inserted);
    end loop;
  end loop;

  perform app.audit(
    p_institution_id,
    v_caller,
    'duty.roster.generated',
    'duty_roster',
    null,
    null,
    jsonb_build_object('from', p_from, 'to', p_to, 'created', v_created, 'unfilled_slots', v_unfilled),
    null
  );

  return jsonb_build_object(
    'created', v_created,
    'school_days', v_school_days,
    'skipped_sundays', v_sundays,
    'skipped_holidays', v_holidays,
    'skipped_already_rostered', v_already,
    'unfilled_slots', v_unfilled
  );
end;
$$;

revoke execute on function public.generate_duty_roster(uuid, date, date) from public, anon;
grant execute on function public.generate_duty_roster(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- public.set_duty_assignment — manager reassign or cancel.
-- ---------------------------------------------------------------------------

create function public.set_duty_assignment(
  p_assignment_id uuid,
  p_staff_id uuid default null,
  p_cancel boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_a public.duty_assignments;
  v_today date;
  v_cancel boolean := coalesce(p_cancel, false);
  v_status text;
  v_staff_id uuid;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_a from public.duty_assignments where id = p_assignment_id for update;

  if v_a.id is null or not app.is_member(v_a.institution_id) then
    raise exception 'code:not_found' using detail = 'duty assignment not found';
  end if;

  if not app.has_role(v_a.institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold duty.manage for this institution';
  end if;

  if (p_staff_id is not null) = v_cancel then
    raise exception 'code:validation_failed' using detail = 'pass either p_staff_id or p_cancel = true';
  end if;

  if v_a.status = 'cancelled' then
    raise exception 'code:invalid_state' using detail = 'duty assignment is cancelled';
  end if;

  select (now() at time zone coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata'))::date into v_today
  from public.institutions i where i.id = v_a.institution_id;

  if v_a.date < v_today then
    raise exception 'code:invalid_state' using detail = 'past duty assignments cannot be changed';
  end if;

  if v_cancel then
    v_status := 'cancelled';
    v_staff_id := v_a.staff_id;
    update public.duty_assignments set status = v_status where id = p_assignment_id;
  else
    if p_staff_id = v_a.staff_id then
      raise exception 'code:validation_failed' using detail = 'duty is already assigned to that staff member';
    end if;

    if not exists (
      select 1 from public.staff s
      where s.id = p_staff_id and s.institution_id = v_a.institution_id and s.status = 'active'
    ) then
      raise exception 'code:not_found' using detail = 'staff member not found';
    end if;

    if exists (
      select 1 from public.leave_requests lr
      where lr.staff_id = p_staff_id
        and lr.institution_id = v_a.institution_id
        and lr.status = 'approved'
        and v_a.date between lr.start_date and lr.end_date
    ) then
      raise exception 'code:conflict' using detail = 'staff member is on approved leave that day';
    end if;

    v_status := 'assigned';
    v_staff_id := p_staff_id;

    begin
      update public.duty_assignments set staff_id = v_staff_id, status = v_status where id = p_assignment_id;
    exception when unique_violation then
      raise exception 'code:conflict' using detail = 'staff member already holds this duty that day';
    end;
  end if;

  update public.duty_swap_requests
  set status = 'cancelled', decided_at = now()
  where assignment_id = p_assignment_id and status = 'pending';

  perform app.audit(
    v_a.institution_id,
    v_caller,
    case when v_cancel then 'duty.assignment.cancelled' else 'duty.assignment.reassigned' end,
    'duty_assignment',
    p_assignment_id,
    jsonb_build_object('staff_id', v_a.staff_id, 'status', v_a.status),
    jsonb_build_object('staff_id', v_staff_id, 'status', v_status),
    null
  );

  return jsonb_build_object('assignment_id', p_assignment_id, 'staff_id', v_staff_id, 'status', v_status);
end;
$$;

revoke execute on function public.set_duty_assignment(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_duty_assignment(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- public.request_duty_swap — by the assignment's own staff (teacher).
-- ---------------------------------------------------------------------------

create function public.request_duty_swap(p_assignment_id uuid, p_to_staff_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_a public.duty_assignments;
  v_today date;
  v_request_id uuid;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_a from public.duty_assignments where id = p_assignment_id for update;

  if v_a.id is null or not app.is_member(v_a.institution_id) then
    raise exception 'code:not_found' using detail = 'duty assignment not found';
  end if;

  if not app.has_role(v_a.institution_id, array['teacher']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold duty.swap for this institution';
  end if;

  if not (v_a.staff_id = any(array(select app.my_staff_ids()))) then
    raise exception 'code:forbidden' using detail = 'only the assigned staff member can request a swap';
  end if;

  if v_a.status = 'cancelled' then
    raise exception 'code:invalid_state' using detail = 'duty assignment is cancelled';
  end if;

  select (now() at time zone coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata'))::date into v_today
  from public.institutions i where i.id = v_a.institution_id;

  if v_a.date <= v_today then
    raise exception 'code:invalid_state' using detail = 'swaps are only for future duties';
  end if;

  if p_to_staff_id is null or p_to_staff_id = v_a.staff_id then
    raise exception 'code:validation_failed' using detail = 'choose another staff member';
  end if;

  -- The target must be able to respond: an active teacher membership here.
  if not exists (
    select 1
    from public.staff s
    join public.memberships m
      on m.staff_id = s.id
     and m.institution_id = s.institution_id
     and m.status = 'active'
     and m.role = 'teacher'
    where s.id = p_to_staff_id and s.institution_id = v_a.institution_id and s.status = 'active'
  ) then
    raise exception 'code:not_found' using detail = 'teacher not found';
  end if;

  -- No leave check here: a colleague's leave is not the requester's to see.
  -- respond_duty_swap checks the target's own leave on accept.
  if exists (
    select 1 from public.duty_assignments a
    where a.staff_id = p_to_staff_id
      and a.duty_type_id = v_a.duty_type_id
      and a.date = v_a.date
      and a.status <> 'cancelled'
  ) then
    raise exception 'code:conflict' using detail = 'that teacher already holds this duty that day';
  end if;

  begin
    insert into public.duty_swap_requests (institution_id, assignment_id, from_staff_id, to_staff_id, requested_by)
    values (v_a.institution_id, p_assignment_id, v_a.staff_id, p_to_staff_id, v_caller)
    returning id into v_request_id;
  exception when unique_violation then
    raise exception 'code:conflict' using detail = 'a swap request is already pending for this duty';
  end;

  perform app.audit(
    v_a.institution_id,
    v_caller,
    'duty.swap.requested',
    'duty_swap_request',
    v_request_id,
    null,
    jsonb_build_object('assignment_id', p_assignment_id, 'from_staff_id', v_a.staff_id, 'to_staff_id', p_to_staff_id),
    null
  );

  return jsonb_build_object('request_id', v_request_id, 'assignment_id', p_assignment_id, 'status', 'pending');
end;
$$;

revoke execute on function public.request_duty_swap(uuid, uuid) from public, anon;
grant execute on function public.request_duty_swap(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.respond_duty_swap — by the target staff (teacher). Accept moves the
-- assignment in the same transaction; no manager approval.
-- ---------------------------------------------------------------------------

create function public.respond_duty_swap(p_request_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_assignment_id uuid;
  v_a public.duty_assignments;
  v_r public.duty_swap_requests;
  v_today date;
  v_status text;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if p_accept is null then
    raise exception 'code:validation_failed' using detail = 'p_accept is required';
  end if;

  select r.assignment_id into v_assignment_id from public.duty_swap_requests r where r.id = p_request_id;

  -- Lock order: assignment, then request (same as the other definers).
  select * into v_a from public.duty_assignments where id = v_assignment_id for update;
  select * into v_r from public.duty_swap_requests where id = p_request_id for update;

  if v_r.id is null or not app.is_member(v_r.institution_id) then
    raise exception 'code:not_found' using detail = 'swap request not found';
  end if;

  if not app.has_role(v_r.institution_id, array['teacher']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold duty.swap for this institution';
  end if;

  if not (v_r.to_staff_id = any(array(select app.my_staff_ids()))) then
    raise exception 'code:forbidden' using detail = 'only the requested teacher can respond';
  end if;

  if v_r.status <> 'pending' then
    raise exception 'code:invalid_state' using detail = 'swap request is no longer pending';
  end if;

  if p_accept then
    if v_a.status = 'cancelled' or v_a.staff_id <> v_r.from_staff_id then
      raise exception 'code:invalid_state' using detail = 'the duty has changed since the request';
    end if;

    select (now() at time zone coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata'))::date into v_today
    from public.institutions i where i.id = v_r.institution_id;

    if v_a.date <= v_today then
      raise exception 'code:invalid_state' using detail = 'swaps are only for future duties';
    end if;

    if exists (
      select 1 from public.leave_requests lr
      where lr.staff_id = v_r.to_staff_id
        and lr.institution_id = v_r.institution_id
        and lr.status = 'approved'
        and v_a.date between lr.start_date and lr.end_date
    ) then
      raise exception 'code:conflict' using detail = 'you are on approved leave that day';
    end if;

    begin
      update public.duty_assignments set staff_id = v_r.to_staff_id, status = 'swapped' where id = v_a.id;
    exception when unique_violation then
      raise exception 'code:conflict' using detail = 'you already hold this duty that day';
    end;

    v_status := 'accepted';
  else
    v_status := 'rejected';
  end if;

  update public.duty_swap_requests set status = v_status, decided_at = now() where id = p_request_id;

  perform app.audit(
    v_r.institution_id,
    v_caller,
    'duty.swap.' || v_status,
    'duty_swap_request',
    p_request_id,
    null,
    jsonb_build_object('assignment_id', v_r.assignment_id, 'from_staff_id', v_r.from_staff_id, 'to_staff_id', v_r.to_staff_id),
    null
  );

  return jsonb_build_object('request_id', p_request_id, 'assignment_id', v_r.assignment_id, 'status', v_status);
end;
$$;

revoke execute on function public.respond_duty_swap(uuid, boolean) from public, anon;
grant execute on function public.respond_duty_swap(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- public.cancel_duty_swap — by the requester (from staff, teacher).
-- ---------------------------------------------------------------------------

create function public.cancel_duty_swap(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_r public.duty_swap_requests;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_r from public.duty_swap_requests where id = p_request_id for update;

  if v_r.id is null or not app.is_member(v_r.institution_id) then
    raise exception 'code:not_found' using detail = 'swap request not found';
  end if;

  if not app.has_role(v_r.institution_id, array['teacher']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold duty.swap for this institution';
  end if;

  if not (v_r.from_staff_id = any(array(select app.my_staff_ids()))) then
    raise exception 'code:forbidden' using detail = 'only the requesting teacher can cancel';
  end if;

  if v_r.status <> 'pending' then
    raise exception 'code:invalid_state' using detail = 'swap request is no longer pending';
  end if;

  update public.duty_swap_requests set status = 'cancelled', decided_at = now() where id = p_request_id;

  perform app.audit(
    v_r.institution_id,
    v_caller,
    'duty.swap.cancelled',
    'duty_swap_request',
    p_request_id,
    null,
    jsonb_build_object('assignment_id', v_r.assignment_id),
    null
  );

  return jsonb_build_object('request_id', p_request_id, 'status', 'cancelled');
end;
$$;

revoke execute on function public.cancel_duty_swap(uuid) from public, anon;
grant execute on function public.cancel_duty_swap(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.duty_staff_options — names of duty-eligible colleagues for any staff
-- role (staff_select stays narrow; this returns only id and name).
-- ---------------------------------------------------------------------------

create function public.duty_staff_options(p_institution_id uuid)
returns table (staff_id uuid, display_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if p_institution_id is null or not app.is_member(p_institution_id) then
    raise exception 'code:not_found' using detail = 'institution not found';
  end if;

  if not app.has_role(p_institution_id, array['owner', 'principal', 'admin', 'admissions', 'accountant', 'exam_controller', 'teacher']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold duty.read for this institution';
  end if;

  return query
  select s.id, s.full_name
  from public.staff s
  where s.institution_id = p_institution_id
    and s.status = 'active'
    and s.is_teaching
  order by s.full_name, s.id
  limit 500;
end;
$$;

revoke execute on function public.duty_staff_options(uuid) from public, anon;
grant execute on function public.duty_staff_options(uuid) to authenticated;
