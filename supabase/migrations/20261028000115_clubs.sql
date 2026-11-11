-- Features-18 #6: clubs & houses module (`clubs`, default on).
--
-- Tables:    public.clubs, public.club_members, public.club_events,
--            public.club_event_signups, public.houses, public.house_members,
--            public.house_points (append-only)
-- Functions (security definer, search_path = '', granted to authenticated):
--   public.join_club(p_club_id uuid, p_student_id uuid) -> public.club_members
--   public.leave_club(p_club_id uuid, p_student_id uuid) -> void
--   public.sign_up_club_event(p_event_id uuid, p_student_id uuid) -> public.club_event_signups
--   public.cancel_club_event_signup(p_event_id uuid, p_student_id uuid) -> void
--   public.award_house_points(p_house_id uuid, p_points int, p_reason text, p_student_id uuid default null)
--     -> public.house_points
-- Internal: app.club_may_act_for_student(uuid, uuid) (revoked from everyone;
--   called only from the definers above).
--
-- Who may act for a student (join/leave/sign up/cancel): M for any student
-- of the institution; guardian for own children / student for self
-- (app.my_student_ids); teacher for students they teach
-- (app.my_taught_student_ids). House points: M only (club.manage).
--
-- RLS matrix (M = owner/principal/admin; S = any staff role, app.staff_roles()):
--   table                select                          write
--   clubs, houses,       every active member of the      M (insert/update via RLS)
--   club_events          institution
--   house_members        S; guardian/student own rows    M (insert/update/delete via RLS)
--   club_members,        S; guardian/student own rows    definers only (no write grant)
--   club_event_signups
--   house_points         every active member of the      award_house_points only; no update/delete ever
--                        institution (house standings)
--
-- Same-institution binding: composite FKs on (parent_id, institution_id)
-- for club/event/house parents; students/staff (no composite key on their
-- tables) are bound by `exists` in with check and inside every definer.
--
-- Reuses (never redefines): app.set_updated_at, app.block_mutation,
-- app.current_user_id, app.is_member, app.has_role, app.member_institutions,
-- app.my_institution_ids, app.staff_roles, app.my_student_ids (0020),
-- app.my_taught_student_ids (0035), app.audit, app.module_catalog (0084).

insert into app.module_catalog (key, default_enabled) values ('clubs', true)
on conflict (key) do update set default_enabled = excluded.default_enabled;

-- ---------------------------------------------------------------------------
-- clubs
-- ---------------------------------------------------------------------------

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  name text not null check (char_length(name) between 1 and 80),
  description text check (char_length(description) <= 500),
  patron_staff_id uuid references public.staff (id),
  capacity int check (capacity between 1 and 1000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clubs_institution_name_key unique (institution_id, name),
  constraint clubs_id_institution_key unique (id, institution_id)
);

create index clubs_patron_staff_idx on public.clubs (patron_staff_id) where patron_staff_id is not null;

create trigger set_updated_at
before update on public.clubs
for each row execute function app.set_updated_at();

alter table public.clubs enable row level security;

create policy clubs_select on public.clubs
  for select to authenticated
  using (clubs.institution_id = any((select app.member_institutions())));

create policy clubs_insert on public.clubs
  for insert to authenticated
  with check (
    clubs.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    and (
      clubs.patron_staff_id is null
      or exists (select 1 from public.staff st where st.id = clubs.patron_staff_id and st.institution_id = clubs.institution_id)
    )
  );

create policy clubs_update on public.clubs
  for update to authenticated
  using (clubs.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))))
  with check (
    clubs.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    and (
      clubs.patron_staff_id is null
      or exists (select 1 from public.staff st where st.id = clubs.patron_staff_id and st.institution_id = clubs.institution_id)
    )
  );

-- No DELETE: archive with is_active = false.
revoke all on public.clubs from anon, authenticated;
grant select, insert on public.clubs to authenticated;
grant update (name, description, patron_staff_id, capacity, is_active) on public.clubs to authenticated;

-- ---------------------------------------------------------------------------
-- club_members — written only by join_club / leave_club.
-- ---------------------------------------------------------------------------

create table public.club_members (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  club_id uuid not null,
  student_id uuid not null references public.students (id),
  joined_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint club_members_club_fk foreign key (club_id, institution_id) references public.clubs (id, institution_id),
  constraint club_members_club_student_key unique (club_id, student_id)
);

create index club_members_institution_idx on public.club_members (institution_id);
create index club_members_student_idx on public.club_members (student_id);

create trigger set_updated_at
before update on public.club_members
for each row execute function app.set_updated_at();

alter table public.club_members enable row level security;

create policy club_members_select on public.club_members
  for select to authenticated
  using (
    club_members.institution_id = any((select app.my_institution_ids(app.staff_roles())))
    or club_members.student_id = any((select app.my_student_ids()))
  );

revoke all on public.club_members from anon, authenticated;
grant select on public.club_members to authenticated;

-- ---------------------------------------------------------------------------
-- club_events
-- ---------------------------------------------------------------------------

create table public.club_events (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  club_id uuid not null,
  title text not null check (char_length(title) between 1 and 120),
  description text check (char_length(description) <= 500),
  venue text check (char_length(venue) between 1 and 120),
  starts_at timestamptz not null,
  ends_at timestamptz,
  signup_closes_at timestamptz,
  capacity int check (capacity between 1 and 1000),
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint club_events_club_fk foreign key (club_id, institution_id) references public.clubs (id, institution_id),
  constraint club_events_id_institution_key unique (id, institution_id),
  constraint club_events_ends_after_starts check (ends_at is null or ends_at > starts_at),
  constraint club_events_signup_before_start check (signup_closes_at is null or signup_closes_at <= starts_at)
);

create index club_events_institution_starts_idx on public.club_events (institution_id, starts_at);
create index club_events_club_starts_idx on public.club_events (club_id, starts_at);

create trigger set_updated_at
before update on public.club_events
for each row execute function app.set_updated_at();

alter table public.club_events enable row level security;

create policy club_events_select on public.club_events
  for select to authenticated
  using (club_events.institution_id = any((select app.member_institutions())));

create policy club_events_insert on public.club_events
  for insert to authenticated
  with check (club_events.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

create policy club_events_update on public.club_events
  for update to authenticated
  using (club_events.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))))
  with check (club_events.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

-- No DELETE: cancel with status = 'cancelled'. club_id/institution_id fixed after insert.
revoke all on public.club_events from anon, authenticated;
grant select, insert on public.club_events to authenticated;
grant update (title, description, venue, starts_at, ends_at, signup_closes_at, capacity, status) on public.club_events to authenticated;

-- ---------------------------------------------------------------------------
-- club_event_signups — written only by sign_up_club_event / cancel_club_event_signup.
-- ---------------------------------------------------------------------------

create table public.club_event_signups (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  event_id uuid not null,
  student_id uuid not null references public.students (id),
  signed_up_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint club_event_signups_event_fk foreign key (event_id, institution_id) references public.club_events (id, institution_id),
  constraint club_event_signups_event_student_key unique (event_id, student_id)
);

create index club_event_signups_institution_idx on public.club_event_signups (institution_id);
create index club_event_signups_student_idx on public.club_event_signups (student_id);

create trigger set_updated_at
before update on public.club_event_signups
for each row execute function app.set_updated_at();

alter table public.club_event_signups enable row level security;

create policy club_event_signups_select on public.club_event_signups
  for select to authenticated
  using (
    club_event_signups.institution_id = any((select app.my_institution_ids(app.staff_roles())))
    or club_event_signups.student_id = any((select app.my_student_ids()))
  );

revoke all on public.club_event_signups from anon, authenticated;
grant select on public.club_event_signups to authenticated;

-- ---------------------------------------------------------------------------
-- houses / house_members
-- ---------------------------------------------------------------------------

create table public.houses (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  name text not null check (char_length(name) between 1 and 40),
  colour text check (colour ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint houses_institution_name_key unique (institution_id, name),
  constraint houses_id_institution_key unique (id, institution_id)
);

create trigger set_updated_at
before update on public.houses
for each row execute function app.set_updated_at();

alter table public.houses enable row level security;

create policy houses_select on public.houses
  for select to authenticated
  using (houses.institution_id = any((select app.member_institutions())));

create policy houses_insert on public.houses
  for insert to authenticated
  with check (houses.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

create policy houses_update on public.houses
  for update to authenticated
  using (houses.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))))
  with check (houses.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

revoke all on public.houses from anon, authenticated;
grant select, insert on public.houses to authenticated;
grant update (name, colour) on public.houses to authenticated;

-- One house per student. M assigns / moves / removes directly under RLS.
create table public.house_members (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  house_id uuid not null,
  student_id uuid not null references public.students (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint house_members_house_fk foreign key (house_id, institution_id) references public.houses (id, institution_id),
  constraint house_members_student_key unique (student_id)
);

create index house_members_institution_idx on public.house_members (institution_id);
create index house_members_house_idx on public.house_members (house_id);

create trigger set_updated_at
before update on public.house_members
for each row execute function app.set_updated_at();

alter table public.house_members enable row level security;

create policy house_members_select on public.house_members
  for select to authenticated
  using (
    house_members.institution_id = any((select app.my_institution_ids(app.staff_roles())))
    or house_members.student_id = any((select app.my_student_ids()))
  );

create policy house_members_insert on public.house_members
  for insert to authenticated
  with check (
    house_members.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    and exists (
      select 1 from public.students s
      where s.id = house_members.student_id and s.institution_id = house_members.institution_id
    )
  );

create policy house_members_update on public.house_members
  for update to authenticated
  using (house_members.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))))
  with check (house_members.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

create policy house_members_delete on public.house_members
  for delete to authenticated
  using (house_members.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

-- UPDATE moves a student between houses only (composite FK keeps the house
-- in the same institution; student/institution fixed after insert).
revoke all on public.house_members from anon, authenticated;
grant select, insert, delete on public.house_members to authenticated;
grant update (house_id) on public.house_members to authenticated;

-- ---------------------------------------------------------------------------
-- house_points — append-only ledger; a house total is always summed, never
-- stored. Corrections are a new negative award. Insert only through
-- award_house_points (no write grant); seed/demo-reset use service role.
-- ---------------------------------------------------------------------------

create table public.house_points (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  house_id uuid not null,
  student_id uuid references public.students (id),
  points int not null check (points <> 0 and points between -100 and 100),
  reason text not null check (char_length(reason) between 1 and 200),
  awarded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint house_points_house_fk foreign key (house_id, institution_id) references public.houses (id, institution_id)
);

create index house_points_institution_created_idx on public.house_points (institution_id, created_at desc);
create index house_points_house_idx on public.house_points (house_id);
create index house_points_student_idx on public.house_points (student_id) where student_id is not null;

create trigger block_house_points_mutation
before update or delete on public.house_points
for each row execute function app.block_mutation();

alter table public.house_points enable row level security;

-- Every member reads the whole ledger: portal house standings sum all rows.
create policy house_points_select on public.house_points
  for select to authenticated
  using (house_points.institution_id = any((select app.member_institutions())));

revoke all on public.house_points from anon, authenticated;
grant select on public.house_points to authenticated;

-- ---------------------------------------------------------------------------
-- app.club_may_act_for_student — shared caller rule for the four
-- join/sign-up definers. Invoker; revoked from every client role (only the
-- postgres-owned definers below call it).
-- ---------------------------------------------------------------------------

create function app.club_may_act_for_student(p_institution_id uuid, p_student_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.has_role(p_institution_id, array['owner', 'principal', 'admin'])
    or p_student_id = any(array(select app.my_student_ids()))
    or (
      app.has_role(p_institution_id, array['teacher'])
      and p_student_id = any(array(select app.my_taught_student_ids()))
    );
$$;

revoke all on function app.club_may_act_for_student(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- public.join_club / public.leave_club. The club row is locked so the
-- capacity count cannot race. Non-member of the club's institution:
-- not_found; member who may not act for the student: forbidden.
-- ---------------------------------------------------------------------------

create function public.join_club(p_club_id uuid, p_student_id uuid)
returns public.club_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.current_user_id();
  v_club public.clubs;
  v_student_status text;
  v_row public.club_members;
begin
  if v_uid is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_club from public.clubs where id = p_club_id for update;
  if v_club.id is null or not app.is_member(v_club.institution_id) then
    raise exception 'code:not_found' using detail = 'club not found';
  end if;

  if not app.club_may_act_for_student(v_club.institution_id, p_student_id) then
    raise exception 'code:forbidden' using detail = 'caller may not act for this student';
  end if;

  select st.status into v_student_status
  from public.students st
  where st.id = p_student_id and st.institution_id = v_club.institution_id;
  if v_student_status is null then
    raise exception 'code:not_found' using detail = 'student not found';
  end if;
  if v_student_status <> 'active' then
    raise exception 'code:invalid_state' using detail = 'student is not active';
  end if;

  if not v_club.is_active then
    raise exception 'code:invalid_state' using detail = 'club is not accepting members';
  end if;

  if v_club.capacity is not null
    and (select count(*) from public.club_members cm where cm.club_id = p_club_id) >= v_club.capacity
  then
    raise exception 'code:conflict' using detail = 'club is full';
  end if;

  begin
    insert into public.club_members (institution_id, club_id, student_id, joined_by)
    values (v_club.institution_id, p_club_id, p_student_id, v_uid)
    returning * into v_row;
  exception
    when unique_violation then
      raise exception 'code:conflict' using detail = 'student is already a member of this club';
  end;

  perform app.audit(
    v_club.institution_id, v_uid, 'club.member.joined', 'club_members', v_row.id,
    null, jsonb_build_object('clubId', p_club_id, 'studentId', p_student_id), null
  );

  return v_row;
end;
$$;

revoke execute on function public.join_club(uuid, uuid) from public, anon;
grant execute on function public.join_club(uuid, uuid) to authenticated;

create function public.leave_club(p_club_id uuid, p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.current_user_id();
  v_institution uuid;
  v_member_id uuid;
begin
  if v_uid is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select c.institution_id into v_institution from public.clubs c where c.id = p_club_id;
  if v_institution is null or not app.is_member(v_institution) then
    raise exception 'code:not_found' using detail = 'club not found';
  end if;

  if not app.club_may_act_for_student(v_institution, p_student_id) then
    raise exception 'code:forbidden' using detail = 'caller may not act for this student';
  end if;

  delete from public.club_members cm
  where cm.club_id = p_club_id and cm.student_id = p_student_id
  returning cm.id into v_member_id;

  if v_member_id is null then
    raise exception 'code:not_found' using detail = 'membership not found';
  end if;

  perform app.audit(
    v_institution, v_uid, 'club.member.left', 'club_members', v_member_id,
    null, jsonb_build_object('clubId', p_club_id, 'studentId', p_student_id), null
  );
end;
$$;

revoke execute on function public.leave_club(uuid, uuid) from public, anon;
grant execute on function public.leave_club(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.sign_up_club_event / public.cancel_club_event_signup. Sign-up open
-- while the event is scheduled, its club active, and now() is before
-- coalesce(signup_closes_at, starts_at); cancel allowed until starts_at.
-- The event row is locked so the capacity count cannot race.
-- ---------------------------------------------------------------------------

create function public.sign_up_club_event(p_event_id uuid, p_student_id uuid)
returns public.club_event_signups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.current_user_id();
  v_event public.club_events;
  v_club_active boolean;
  v_student_status text;
  v_row public.club_event_signups;
begin
  if v_uid is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_event from public.club_events where id = p_event_id for update;
  if v_event.id is null or not app.is_member(v_event.institution_id) then
    raise exception 'code:not_found' using detail = 'event not found';
  end if;

  if not app.club_may_act_for_student(v_event.institution_id, p_student_id) then
    raise exception 'code:forbidden' using detail = 'caller may not act for this student';
  end if;

  select st.status into v_student_status
  from public.students st
  where st.id = p_student_id and st.institution_id = v_event.institution_id;
  if v_student_status is null then
    raise exception 'code:not_found' using detail = 'student not found';
  end if;
  if v_student_status <> 'active' then
    raise exception 'code:invalid_state' using detail = 'student is not active';
  end if;

  select c.is_active into v_club_active from public.clubs c where c.id = v_event.club_id;

  if v_event.status <> 'scheduled' or v_club_active is not true then
    raise exception 'code:invalid_state' using detail = 'event is not open for sign-up';
  end if;

  if now() >= coalesce(v_event.signup_closes_at, v_event.starts_at) then
    raise exception 'code:invalid_state' using detail = 'sign-up is closed';
  end if;

  if v_event.capacity is not null
    and (select count(*) from public.club_event_signups s where s.event_id = p_event_id) >= v_event.capacity
  then
    raise exception 'code:conflict' using detail = 'event is full';
  end if;

  begin
    insert into public.club_event_signups (institution_id, event_id, student_id, signed_up_by)
    values (v_event.institution_id, p_event_id, p_student_id, v_uid)
    returning * into v_row;
  exception
    when unique_violation then
      raise exception 'code:conflict' using detail = 'student is already signed up';
  end;

  perform app.audit(
    v_event.institution_id, v_uid, 'club.event.signed_up', 'club_event_signups', v_row.id,
    null, jsonb_build_object('eventId', p_event_id, 'studentId', p_student_id), null
  );

  return v_row;
end;
$$;

revoke execute on function public.sign_up_club_event(uuid, uuid) from public, anon;
grant execute on function public.sign_up_club_event(uuid, uuid) to authenticated;

create function public.cancel_club_event_signup(p_event_id uuid, p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.current_user_id();
  v_event public.club_events;
  v_signup_id uuid;
begin
  if v_uid is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_event from public.club_events where id = p_event_id;
  if v_event.id is null or not app.is_member(v_event.institution_id) then
    raise exception 'code:not_found' using detail = 'event not found';
  end if;

  if not app.club_may_act_for_student(v_event.institution_id, p_student_id) then
    raise exception 'code:forbidden' using detail = 'caller may not act for this student';
  end if;

  if now() >= v_event.starts_at then
    raise exception 'code:invalid_state' using detail = 'event has already started';
  end if;

  delete from public.club_event_signups s
  where s.event_id = p_event_id and s.student_id = p_student_id
  returning s.id into v_signup_id;

  if v_signup_id is null then
    raise exception 'code:not_found' using detail = 'sign-up not found';
  end if;

  perform app.audit(
    v_event.institution_id, v_uid, 'club.event.signup_cancelled', 'club_event_signups', v_signup_id,
    null, jsonb_build_object('eventId', p_event_id, 'studentId', p_student_id), null
  );
end;
$$;

revoke execute on function public.cancel_club_event_signup(uuid, uuid) from public, anon;
grant execute on function public.cancel_club_event_signup(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.award_house_points — club.manage (M) only. Optional student credit
-- must be a current member of that house. Audit carries ids and points only.
-- ---------------------------------------------------------------------------

create function public.award_house_points(p_house_id uuid, p_points int, p_reason text, p_student_id uuid default null)
returns public.house_points
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.current_user_id();
  v_house public.houses;
  v_row public.house_points;
begin
  if v_uid is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_house from public.houses where id = p_house_id;
  if v_house.id is null or not app.is_member(v_house.institution_id) then
    raise exception 'code:not_found' using detail = 'house not found';
  end if;

  if not app.has_role(v_house.institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold club.manage for this institution';
  end if;

  if p_points is null or p_points = 0 or p_points not between -100 and 100 then
    raise exception 'code:validation_failed' using detail = 'points must be non-zero, between -100 and 100';
  end if;

  if p_reason is null or char_length(p_reason) not between 1 and 200 then
    raise exception 'code:validation_failed' using detail = 'reason must be 1-200 characters';
  end if;

  if p_student_id is not null and not exists (
    select 1 from public.house_members hm
    where hm.house_id = p_house_id
      and hm.student_id = p_student_id
      and hm.institution_id = v_house.institution_id
  ) then
    raise exception 'code:validation_failed' using detail = 'student is not in this house';
  end if;

  insert into public.house_points (institution_id, house_id, student_id, points, reason, awarded_by)
  values (v_house.institution_id, p_house_id, p_student_id, p_points, p_reason, v_uid)
  returning * into v_row;

  perform app.audit(
    v_house.institution_id, v_uid, 'house.points.awarded', 'house_points', v_row.id,
    null, jsonb_build_object('houseId', p_house_id, 'studentId', p_student_id, 'points', p_points), null
  );

  return v_row;
end;
$$;

revoke execute on function public.award_house_points(uuid, int, text, uuid) from public, anon;
grant execute on function public.award_house_points(uuid, int, text, uuid) to authenticated;
