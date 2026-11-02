-- M13-T2: assets, maintenance_requests, transport_vehicles, transport_routes,
-- transport_stops, transport_assignments, academic_calendar_events, and the
-- holiday block on attendance_sessions (M13-tasks.md rulings).
--
-- Lane B ruling: MOD has not merged in this worktree, so no `module` column
-- or app.module_enabled() helper here. The one place this milestone still
-- needs a module check (the holiday block) uses the inline predicate the
-- controller specified: coalesce((i.settings->'modules'->>'calendar')::
-- boolean, true) against institutions.settings.
--
-- Guard/RLS shapes mirror 0069 (timetable) and 0020 (RLS perf initPlan
-- helpers): row-independent `app.my_*` setof-uuid helpers wrapped in
-- `(select ...)` inside policies, named unique constraints so 23505 maps to
-- a field by name, SECURITY DEFINER guard triggers with the standard
-- service_role/postgres bypass.

-- ---------------------------------------------------------------------------
-- assets
-- ---------------------------------------------------------------------------

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  name text not null check (length(name) between 1 and 80),
  category text not null check (category in ('furniture', 'electrical', 'it', 'lab', 'sports', 'plumbing', 'vehicle', 'other')),
  asset_tag text check (length(asset_tag) between 1 and 40),
  room_id uuid references public.rooms (id),
  location text check (length(location) between 1 and 80),
  status text not null default 'in_use' check (status in ('in_use', 'under_repair', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assets_tag_key unique (institution_id, asset_tag)
);

create trigger set_updated_at
before update on public.assets
for each row execute function app.set_updated_at();

alter table public.assets enable row level security;

-- No delete policy: assets are retired (status), never deleted.
create policy assets_select on public.assets
  for select to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'admissions', 'accountant', 'exam_controller', 'teacher']))));

create policy assets_insert on public.assets
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and (
      room_id is null
      or exists (select 1 from public.rooms r where r.id = assets.room_id and r.institution_id = assets.institution_id)
    )
  );

create policy assets_update on public.assets
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and (
      room_id is null
      or exists (select 1 from public.rooms r where r.id = assets.room_id and r.institution_id = assets.institution_id)
    )
  );

-- ---------------------------------------------------------------------------
-- maintenance_requests
-- ---------------------------------------------------------------------------

create table public.maintenance_requests (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  asset_id uuid references public.assets (id),
  location text check (length(location) between 1 and 80),
  issue text not null check (length(issue) between 1 and 500),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'done')),
  raised_by uuid not null references public.profiles (id) default app.current_user_id(),
  raised_at timestamptz not null default now(),
  assignee_staff_id uuid references public.staff (id),
  assigned_at timestamptz,
  closed_at timestamptz,
  closed_by uuid references public.profiles (id),
  resolution_note text check (length(resolution_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (asset_id is not null or location is not null)
);

create index maintenance_requests_institution_status_idx on public.maintenance_requests (institution_id, status);

create trigger set_updated_at
before update on public.maintenance_requests
for each row execute function app.set_updated_at();

-- Status machine (rulings "Guards and state machines"): done is terminal;
-- open<->in_progress moves both ways except in_progress->open; assignee
-- required to enter in_progress; institution_id/raised_by/raised_at/issue/
-- asset_id/location are immutable; assigned_at/closed_at/closed_by are
-- stamped here, never trusted from the client. No service-role/postgres
-- bypass (same as app.block_mutation()): seed/reset only ever INSERTs
-- fresh request rows, never UPDATEs one into or out of a terminal state, so
-- there is no legitimate direct write this guard needs to let through.
create function app.guard_maintenance_requests_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'done' then
    raise exception 'code:invalid_state' using detail = 'a closed maintenance request cannot be edited';
  end if;

  if new.institution_id is distinct from old.institution_id
    or new.raised_by is distinct from old.raised_by
    or new.raised_at is distinct from old.raised_at
    or new.issue is distinct from old.issue
    or new.asset_id is distinct from old.asset_id
    or new.location is distinct from old.location
  then
    raise exception 'code:invalid_state' using detail = 'institution_id, raised_by, raised_at, issue, asset_id and location are immutable';
  end if;

  if new.status = 'open' and old.status = 'in_progress' then
    raise exception 'code:invalid_state' using detail = 'a request already in progress cannot move back to open';
  end if;

  if new.status = 'in_progress' and new.assignee_staff_id is null then
    raise exception 'code:invalid_state' using detail = 'moving to in_progress requires an assignee';
  end if;

  if new.assignee_staff_id is distinct from old.assignee_staff_id then
    new.assigned_at := now();
  else
    new.assigned_at := old.assigned_at;
  end if;

  if new.status = 'done' then
    new.closed_at := now();
    new.closed_by := app.current_user_id();
  else
    new.closed_at := old.closed_at;
    new.closed_by := old.closed_by;
  end if;

  return new;
end;
$$;

create trigger guard_maintenance_requests_update
before update on public.maintenance_requests
for each row execute function app.guard_maintenance_requests_update();

alter table public.maintenance_requests enable row level security;

-- No delete policy. SELECT: owner/principal/admin see every request in
-- their institution; every other staff role (maintenance.request holder)
-- sees only requests they raised — row-owner scoped, same shape as
-- documents' ["S","O"] class, no extra institution check needed because
-- raised_by can only be set to the caller's own id (insert with check
-- below) and only while they hold staff membership in that institution.
create policy maintenance_requests_select on public.maintenance_requests
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or raised_by = (select app.current_user_id())
  );

create policy maintenance_requests_insert on public.maintenance_requests
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions', 'accountant', 'exam_controller', 'teacher'])
    and raised_by = (select app.current_user_id())
    and status = 'open'
    and assignee_staff_id is null
    and assigned_at is null
    and closed_at is null
    and closed_by is null
    and (
      asset_id is null
      or exists (select 1 from public.assets a where a.id = maintenance_requests.asset_id and a.institution_id = maintenance_requests.institution_id)
    )
  );

create policy maintenance_requests_update on public.maintenance_requests
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and (
      assignee_staff_id is null
      or app.staff_in_institution(maintenance_requests.assignee_staff_id, maintenance_requests.institution_id)
    )
  );

-- ---------------------------------------------------------------------------
-- transport_vehicles
-- ---------------------------------------------------------------------------

create table public.transport_vehicles (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  registration_no text not null check (length(registration_no) between 1 and 20),
  capacity int not null check (capacity between 1 and 100),
  driver_name text not null check (length(driver_name) between 1 and 80),
  status text not null default 'active' check (status in ('active', 'off_road')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transport_vehicles_registration_key unique (institution_id, registration_no)
);

create trigger set_updated_at
before update on public.transport_vehicles
for each row execute function app.set_updated_at();

-- RLS is enabled with the rest of the transport_* policies below, once
-- transport_routes/transport_assignments and the app.my_transport_*_ids()
-- helpers all exist (transport_vehicles_select reads both forward).

-- ---------------------------------------------------------------------------
-- transport_routes
-- ---------------------------------------------------------------------------

create table public.transport_routes (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  name text not null check (length(name) between 1 and 60),
  vehicle_id uuid references public.transport_vehicles (id),
  status text not null default 'on_time' check (status in ('on_time', 'delayed', 'off_road')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transport_routes_name_key unique (institution_id, name)
);

create trigger set_updated_at
before update on public.transport_routes
for each row execute function app.set_updated_at();

-- RLS below, with the rest of the transport_* policies.

-- ---------------------------------------------------------------------------
-- transport_stops
-- ---------------------------------------------------------------------------

create table public.transport_stops (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  route_id uuid not null references public.transport_routes (id),
  seq int not null check (seq between 1 and 50),
  name text not null check (length(name) between 1 and 80),
  pickup_time time not null,
  map_x smallint not null check (map_x between 0 and 100),
  map_y smallint not null check (map_y between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transport_stops_seq_key unique (route_id, seq),
  -- Composite-FK target for transport_assignments (stop_id, route_id): a
  -- stop can never be assigned under the wrong route.
  constraint transport_stops_id_route_key unique (id, route_id)
);

create index transport_stops_route_id_idx on public.transport_stops (route_id);

create trigger set_updated_at
before update on public.transport_stops
for each row execute function app.set_updated_at();

-- RLS below, with the rest of the transport_* policies.

-- ---------------------------------------------------------------------------
-- transport_assignments — one row per student (the current assignment).
-- ---------------------------------------------------------------------------

create table public.transport_assignments (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  student_id uuid not null references public.students (id),
  route_id uuid not null references public.transport_routes (id),
  stop_id uuid not null references public.transport_stops (id),
  assigned_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transport_assignments_student_key unique (student_id),
  -- Stop must belong to the same route as the assignment (rulings): a stop
  -- can never belong to another route.
  constraint transport_assignments_stop_route_fk foreign key (stop_id, route_id) references public.transport_stops (id, route_id)
);

create index transport_assignments_route_id_idx on public.transport_assignments (route_id);
create index transport_assignments_stop_id_idx on public.transport_assignments (stop_id);

create trigger set_updated_at
before update on public.transport_assignments
for each row execute function app.set_updated_at();

-- Capacity guard (rulings "Guards and state machines"): locks the route row
-- and counts the other assignments on it; a route with no vehicle has no
-- cap. BEFORE INSERT OR UPDATE OF route_id only — moving a student between
-- stops on the SAME route (no route_id change) never re-checks capacity.
create function app.guard_transport_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capacity int;
  v_count int;
begin
  perform 1 from public.transport_routes where id = new.route_id for update;

  select v.capacity into v_capacity
  from public.transport_routes r
  join public.transport_vehicles v on v.id = r.vehicle_id
  where r.id = new.route_id;

  if v_capacity is null then
    return new;
  end if;

  select count(*) into v_count
  from public.transport_assignments
  where route_id = new.route_id and student_id is distinct from new.student_id;

  if v_count >= v_capacity then
    raise exception 'code:conflict' using detail = 'route is full';
  end if;

  return new;
end;
$$;

create trigger guard_transport_capacity
before insert or update of route_id on public.transport_assignments
for each row execute function app.guard_transport_capacity();

-- ---------------------------------------------------------------------------
-- RLS perf helpers (P-01 shape, 0020): row-independent, wrapped in
-- `(select ...)` inside the transport_* policies below. Defined here (after
-- transport_assignments exists) rather than near 0020's other helpers,
-- since they depend on this migration's own table.
-- ---------------------------------------------------------------------------

create function app.my_transport_route_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct a.route_id
  from public.transport_assignments a
  where a.student_id = any((select app.my_student_ids()));
$$;

revoke execute on function app.my_transport_route_ids() from public;
grant execute on function app.my_transport_route_ids() to authenticated;
comment on function app.my_transport_route_ids() is
  'RLS perf helper (M13): route ids the caller''s linked/own student(s) are assigned to. Called as (select app.my_transport_route_ids()) inside policies.';

create function app.my_transport_stop_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct a.stop_id
  from public.transport_assignments a
  where a.student_id = any((select app.my_student_ids()));
$$;

revoke execute on function app.my_transport_stop_ids() from public;
grant execute on function app.my_transport_stop_ids() to authenticated;
comment on function app.my_transport_stop_ids() is
  'RLS perf helper (M13): stop ids the caller''s linked/own student(s) are assigned to (own stop only, never the route''s other stops). Called as (select app.my_transport_stop_ids()) inside policies.';

-- transport_vehicles_select must not query transport_routes directly: that,
-- combined with transport_routes_insert/update querying transport_vehicles
-- directly, is a mutual table reference across two RLS policies, which
-- Postgres's RLS recursion guard rejects as 42P17 "infinite recursion
-- detected" even though the chain would actually terminate. Routing through
-- this security-definer helper (bypasses RLS, same shape as the two above)
-- breaks the cycle.
create function app.my_transport_vehicle_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct r.vehicle_id
  from public.transport_assignments a
  join public.transport_routes r on r.id = a.route_id
  where a.student_id = any((select app.my_student_ids()))
    and r.vehicle_id is not null;
$$;

revoke execute on function app.my_transport_vehicle_ids() from public;
grant execute on function app.my_transport_vehicle_ids() to authenticated;
comment on function app.my_transport_vehicle_ids() is
  'RLS perf helper (M13): vehicle ids reachable via the caller''s linked/own student(s) assigned route(s). Called as (select app.my_transport_vehicle_ids()) inside policies — never query transport_routes directly from a transport_vehicles policy (42P17 cycle with transport_routes_insert/update).';

-- ---------------------------------------------------------------------------
-- transport_* RLS — all four tables together now that transport_routes,
-- transport_vehicles, transport_stops, transport_assignments and the three
-- helpers above all exist. Each policy reaches other tables only through a
-- security-definer helper, never a direct table reference, to avoid 42P17
-- (see app.my_transport_vehicle_ids() comment above).
-- ---------------------------------------------------------------------------

alter table public.transport_vehicles enable row level security;

create policy transport_vehicles_select on public.transport_vehicles
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'admissions', 'accountant', 'exam_controller', 'teacher'])))
    or id = any((select app.my_transport_vehicle_ids()))
  );

create policy transport_vehicles_insert on public.transport_vehicles
  for insert to authenticated
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy transport_vehicles_update on public.transport_vehicles
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

alter table public.transport_routes enable row level security;

create policy transport_routes_select on public.transport_routes
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'admissions', 'accountant', 'exam_controller', 'teacher'])))
    or id = any((select app.my_transport_route_ids()))
  );

create policy transport_routes_insert on public.transport_routes
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and (
      vehicle_id is null
      or exists (select 1 from public.transport_vehicles v where v.id = transport_routes.vehicle_id and v.institution_id = transport_routes.institution_id)
    )
  );

create policy transport_routes_update on public.transport_routes
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and (
      vehicle_id is null
      or exists (select 1 from public.transport_vehicles v where v.id = transport_routes.vehicle_id and v.institution_id = transport_routes.institution_id)
    )
  );

alter table public.transport_stops enable row level security;

-- Guardian/student: own stop only, never the route's other stops (rulings)
-- — app.my_transport_stop_ids() returns the caller's own assigned stop ids.
create policy transport_stops_select on public.transport_stops
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'admissions', 'accountant', 'exam_controller', 'teacher'])))
    or id = any((select app.my_transport_stop_ids()))
  );

create policy transport_stops_insert on public.transport_stops
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and exists (select 1 from public.transport_routes r where r.id = transport_stops.route_id and r.institution_id = transport_stops.institution_id)
  );

create policy transport_stops_update on public.transport_stops
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and exists (select 1 from public.transport_routes r where r.id = transport_stops.route_id and r.institution_id = transport_stops.institution_id)
  );

alter table public.transport_assignments enable row level security;

create policy transport_assignments_select on public.transport_assignments
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'admissions', 'accountant', 'exam_controller'])))
    or student_id = any((select app.my_taught_student_ids()))
    or student_id = any((select app.my_student_ids()))
  );

create policy transport_assignments_insert on public.transport_assignments
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and exists (select 1 from public.students s where s.id = transport_assignments.student_id and s.institution_id = transport_assignments.institution_id)
    and exists (select 1 from public.transport_routes r where r.id = transport_assignments.route_id and r.institution_id = transport_assignments.institution_id)
    and assigned_by = (select app.current_user_id())
  );

create policy transport_assignments_update on public.transport_assignments
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and exists (select 1 from public.students s where s.id = transport_assignments.student_id and s.institution_id = transport_assignments.institution_id)
    and exists (select 1 from public.transport_routes r where r.id = transport_assignments.route_id and r.institution_id = transport_assignments.institution_id)
  );

create policy transport_assignments_delete on public.transport_assignments
  for delete to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']));

-- ---------------------------------------------------------------------------
-- academic_calendar_events
-- ---------------------------------------------------------------------------

create table public.academic_calendar_events (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  academic_year_id uuid not null references public.academic_years (id),
  kind text not null check (kind in ('holiday', 'exam_week', 'ptm', 'event')),
  title text not null check (length(title) between 1 and 120),
  description text check (length(description) <= 1000),
  starts_on date not null,
  ends_on date not null,
  audience text not null default 'all' check (audience in ('all', 'staff')),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (ends_on - starts_on <= 92),
  check (kind <> 'holiday' or audience = 'all')
);

create index academic_calendar_events_institution_kind_dates_idx
  on public.academic_calendar_events (institution_id, kind, starts_on, ends_on);

create trigger set_updated_at
before update on public.academic_calendar_events
for each row execute function app.set_updated_at();

-- Mirrors app.validate_term_dates (0002): event dates must fall within
-- their academic year.
create function app.validate_calendar_event_dates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year public.academic_years;
begin
  select * into v_year from public.academic_years where id = new.academic_year_id;

  if new.starts_on < v_year.starts_on or new.ends_on > v_year.ends_on then
    raise exception 'code:validation_failed' using detail = 'event dates must fall within the academic year';
  end if;

  return new;
end;
$$;

create trigger validate_calendar_event_dates
before insert or update on public.academic_calendar_events
for each row execute function app.validate_calendar_event_dates();

alter table public.academic_calendar_events enable row level security;

-- Delete allowed for managers (rulings). Guardian/student: audience 'all'
-- events in their own institution only.
create policy academic_calendar_events_select on public.academic_calendar_events
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'admissions', 'accountant', 'exam_controller', 'teacher'])))
    or (audience = 'all' and institution_id = any((select app.member_institutions())))
  );

create policy academic_calendar_events_insert on public.academic_calendar_events
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and exists (select 1 from public.academic_years y where y.id = academic_calendar_events.academic_year_id and y.institution_id = academic_calendar_events.institution_id)
    and created_by = (select app.current_user_id())
  );

create policy academic_calendar_events_update on public.academic_calendar_events
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and exists (select 1 from public.academic_years y where y.id = academic_calendar_events.academic_year_id and y.institution_id = academic_calendar_events.institution_id)
  );

create policy academic_calendar_events_delete on public.academic_calendar_events
  for delete to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']));

-- ---------------------------------------------------------------------------
-- Holiday block on attendance_sessions (rulings "Guards and state machines").
-- Covers upserts and M08's period sessions alike (BEFORE INSERT). Lane B
-- predicate: coalesce((i.settings->'modules'->>'calendar')::boolean, true)
-- in place of MOD's app.module_enabled() (not merged in this worktree).
-- Do not edit src/modules/attendance/* — M08 owns it.
-- ---------------------------------------------------------------------------

create function app.block_attendance_on_holiday()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blocked boolean;
begin
  select exists (
    select 1
    from public.academic_calendar_events e
    join public.institutions i on i.id = e.institution_id
    where e.institution_id = new.institution_id
      and e.kind = 'holiday'
      and new.date between e.starts_on and e.ends_on
      and coalesce((i.settings -> 'modules' ->> 'calendar')::boolean, true)
  ) into v_blocked;

  if v_blocked then
    raise exception 'code:invalid_state' using detail = 'attendance cannot be taken on a school holiday';
  end if;

  return new;
end;
$$;

create trigger block_attendance_on_holiday
before insert on public.attendance_sessions
for each row execute function app.block_attendance_on_holiday();
