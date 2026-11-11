-- Features-18 #7 (SPEC §A): hostel module — rooms, allocations, roll calls.
-- Mirrors 0090 (visitors) for RLS/grants shape and 0086 (library) for the
-- definer caller check (non-member -> not_found, member without role ->
-- forbidden).
--
-- Tables
--   hostel_rooms              block + room_no, capacity, is_active
--   hostel_allocations        one active (vacated_on is null) per student —
--                             partial unique hostel_allocations_one_active_key
--   hostel_roll_calls         one per (institution, taken_on, session)
--   hostel_roll_call_entries  unique per (roll_call_id, student_id)
--
-- Functions
--   public.allocate_hostel_room(p_room_id uuid, p_student_id uuid) -> jsonb
--     definer; locks the room row, enforces capacity + active room +
--     active student; one-active-per-student backstopped by the partial
--     unique index (23505 -> conflict).
--   public.vacate_hostel_allocation(p_allocation_id uuid) -> jsonb
--     definer; ends an active allocation once.
--   app.guard_hostel_rooms() trigger (invoker): capacity may not drop below
--     current occupancy; an occupied room may not be deactivated.
--
-- RLS matrix (hostel.read = hostel.manage = owner, principal, admin — same
-- shape as library.read/manage):
--   table                     select  insert  update        delete
--   hostel_rooms              M       M       M (columns)   none
--   hostel_allocations        M       RPC     RPC           none
--   hostel_roll_calls         M       M       none          none
--   hostel_roll_call_entries  M       M       M (status,note) none
--   M = owner/principal/admin of the row's institution. Teachers, guardians,
--   students: no access. service_role: seed/demo-reset only.

insert into app.module_catalog (key, default_enabled) values ('hostel', true)
on conflict (key) do update set default_enabled = excluded.default_enabled;

-- ---------------------------------------------------------------------------
-- hostel_rooms
-- ---------------------------------------------------------------------------

create table public.hostel_rooms (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  block text not null check (char_length(block) between 1 and 60),
  room_no text not null check (char_length(room_no) between 1 and 20),
  capacity smallint not null check (capacity between 1 and 50),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hostel_rooms_id_institution_key unique (id, institution_id),
  constraint hostel_rooms_block_room_key unique (institution_id, block, room_no)
);

create trigger set_updated_at
before update on public.hostel_rooms
for each row execute function app.set_updated_at();

-- Invoker: RLS lets only M update a room, and M reads every allocation of
-- that institution, so the count is complete. The room row lock taken by
-- this UPDATE serialises against allocate_hostel_room's `for update`.
create function app.guard_hostel_rooms()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_occupied int;
begin
  select count(*) into v_occupied
  from public.hostel_allocations a
  where a.room_id = new.id and a.vacated_on is null;

  if new.capacity < v_occupied then
    raise exception 'code:conflict' using detail = 'capacity is below current occupancy';
  end if;

  if not new.is_active and v_occupied > 0 then
    raise exception 'code:conflict' using detail = 'room still has occupants';
  end if;

  return new;
end;
$$;

revoke execute on function app.guard_hostel_rooms() from public;

create trigger guard_hostel_rooms
before update of capacity, is_active on public.hostel_rooms
for each row execute function app.guard_hostel_rooms();

alter table public.hostel_rooms enable row level security;

create policy hostel_rooms_select on public.hostel_rooms
  for select to authenticated
  using (hostel_rooms.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

create policy hostel_rooms_insert on public.hostel_rooms
  for insert to authenticated
  with check (hostel_rooms.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

create policy hostel_rooms_update on public.hostel_rooms
  for update to authenticated
  using (hostel_rooms.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))))
  with check (hostel_rooms.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

revoke all on public.hostel_rooms from anon, authenticated;
grant select, insert on public.hostel_rooms to authenticated;
grant update (block, room_no, capacity, is_active) on public.hostel_rooms to authenticated;
grant select, insert, update, delete on public.hostel_rooms to service_role;

-- ---------------------------------------------------------------------------
-- hostel_allocations — written only by the RPCs below (lesson 3).
-- ---------------------------------------------------------------------------

create table public.hostel_allocations (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  room_id uuid not null,
  student_id uuid not null references public.students (id),
  allocated_on date not null,
  vacated_on date check (vacated_on >= allocated_on),
  allocated_by uuid references public.profiles (id),
  vacated_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hostel_allocations_room_fk foreign key (room_id, institution_id) references public.hostel_rooms (id, institution_id)
);

create unique index hostel_allocations_one_active_key on public.hostel_allocations (student_id) where vacated_on is null;
create index hostel_allocations_room_active_idx on public.hostel_allocations (room_id) where vacated_on is null;
create index hostel_allocations_institution_idx on public.hostel_allocations (institution_id, allocated_on desc);

create trigger set_updated_at
before update on public.hostel_allocations
for each row execute function app.set_updated_at();

alter table public.hostel_allocations enable row level security;

create policy hostel_allocations_select on public.hostel_allocations
  for select to authenticated
  using (hostel_allocations.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

revoke all on public.hostel_allocations from anon, authenticated;
grant select on public.hostel_allocations to authenticated;
grant select, insert, update, delete on public.hostel_allocations to service_role;

-- ---------------------------------------------------------------------------
-- hostel_roll_calls / hostel_roll_call_entries
-- ---------------------------------------------------------------------------

create table public.hostel_roll_calls (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  taken_on date not null,
  session text not null check (session in ('morning', 'evening', 'night')),
  taken_by uuid not null references public.profiles (id) default app.current_user_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hostel_roll_calls_id_institution_key unique (id, institution_id),
  constraint hostel_roll_calls_day_session_key unique (institution_id, taken_on, session)
);

create trigger set_updated_at
before update on public.hostel_roll_calls
for each row execute function app.set_updated_at();

alter table public.hostel_roll_calls enable row level security;

create policy hostel_roll_calls_select on public.hostel_roll_calls
  for select to authenticated
  using (hostel_roll_calls.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

create policy hostel_roll_calls_insert on public.hostel_roll_calls
  for insert to authenticated
  with check (
    hostel_roll_calls.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    and hostel_roll_calls.taken_by = (select app.current_user_id())
  );

revoke all on public.hostel_roll_calls from anon, authenticated;
grant select, insert on public.hostel_roll_calls to authenticated;
grant select, insert, update, delete on public.hostel_roll_calls to service_role;

create table public.hostel_roll_call_entries (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  roll_call_id uuid not null,
  student_id uuid not null references public.students (id),
  status text not null check (status in ('present', 'absent', 'on_leave')),
  note text check (char_length(note) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hostel_roll_call_entries_roll_call_fk foreign key (roll_call_id, institution_id) references public.hostel_roll_calls (id, institution_id),
  constraint hostel_roll_call_entries_student_key unique (roll_call_id, student_id)
);

create index hostel_roll_call_entries_institution_idx on public.hostel_roll_call_entries (institution_id);
create index hostel_roll_call_entries_student_idx on public.hostel_roll_call_entries (student_id);

create trigger set_updated_at
before update on public.hostel_roll_call_entries
for each row execute function app.set_updated_at();

alter table public.hostel_roll_call_entries enable row level security;

create policy hostel_roll_call_entries_select on public.hostel_roll_call_entries
  for select to authenticated
  using (hostel_roll_call_entries.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

-- roll_call_id is bound to the same institution by the composite FK.
create policy hostel_roll_call_entries_insert on public.hostel_roll_call_entries
  for insert to authenticated
  with check (
    hostel_roll_call_entries.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    and exists (
      select 1 from public.students s
      where s.id = hostel_roll_call_entries.student_id and s.institution_id = hostel_roll_call_entries.institution_id
    )
  );

-- Column grant below limits UPDATE to status/note.
create policy hostel_roll_call_entries_update on public.hostel_roll_call_entries
  for update to authenticated
  using (hostel_roll_call_entries.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))))
  with check (hostel_roll_call_entries.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

revoke all on public.hostel_roll_call_entries from anon, authenticated;
grant select, insert on public.hostel_roll_call_entries to authenticated;
grant update (status, note) on public.hostel_roll_call_entries to authenticated;
grant select, insert, update, delete on public.hostel_roll_call_entries to service_role;

-- ---------------------------------------------------------------------------
-- public.allocate_hostel_room — single public definer (0074
-- enqueue_fee_reminders shape: no trusted internal caller needs an app.*
-- twin). "Today" = institution locale timezone (default Asia/Kolkata).
-- ---------------------------------------------------------------------------

create function public.allocate_hostel_room(p_room_id uuid, p_student_id uuid)
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

  insert into public.hostel_allocations (institution_id, room_id, student_id, allocated_on, allocated_by)
  values (v_room.institution_id, p_room_id, p_student_id, v_today, app.current_user_id())
  returning id into v_allocation_id;

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

revoke execute on function public.allocate_hostel_room(uuid, uuid) from public, anon;
grant execute on function public.allocate_hostel_room(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.vacate_hostel_allocation — ends an active allocation, once.
-- ---------------------------------------------------------------------------

create function public.vacate_hostel_allocation(p_allocation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allocation public.hostel_allocations;
  v_today date;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_allocation from public.hostel_allocations where id = p_allocation_id for update;

  if v_allocation.id is null or not app.is_member(v_allocation.institution_id) then
    raise exception 'code:not_found' using detail = 'allocation not found';
  end if;

  if not app.has_role(v_allocation.institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold hostel.manage for this institution';
  end if;

  if v_allocation.vacated_on is not null then
    raise exception 'code:invalid_state' using detail = 'allocation already vacated';
  end if;

  select (now() at time zone coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata'))::date into v_today
  from public.institutions i where i.id = v_allocation.institution_id;

  -- A same-day allocate + vacate still satisfies vacated_on >= allocated_on;
  -- greatest() covers a seeded allocation dated after "today".
  v_today := greatest(v_today, v_allocation.allocated_on);

  update public.hostel_allocations
  set vacated_on = v_today, vacated_by = app.current_user_id()
  where id = p_allocation_id;

  perform app.audit(
    v_allocation.institution_id,
    app.current_user_id(),
    'hostel.allocation.vacated',
    'hostel_allocation',
    p_allocation_id,
    null,
    jsonb_build_object('room_id', v_allocation.room_id, 'student_id', v_allocation.student_id, 'vacated_on', v_today),
    null
  );

  return jsonb_build_object('allocation_id', p_allocation_id, 'vacated_on', v_today);
end;
$$;

revoke execute on function public.vacate_hostel_allocation(uuid) from public, anon;
grant execute on function public.vacate_hostel_allocation(uuid) to authenticated;
