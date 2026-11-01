-- M07-T2: rooms, periods, timetable_versions, timetable_slots,
-- publish_timetable RPC (M07-tasks.md header rulings).
--
-- Conflicts are DB constraints, not application logic: timetable_slots has
-- three unique constraints (section/teacher/room x weekday x period) so a
-- double-booking is rejected by Postgres (23505) before any row is written.
-- A partial unique index on timetable_versions enforces at most one
-- published version per (institution, academic_year).
--
-- Status machine mirrors 0068's announcements: a draft version is freely
-- edited by owner/principal/admin; `app.guard_timetable_versions_update`
-- blocks any direct status change outside the transaction-local GUC
-- `app.allow_timetable_publish`, which only `public.publish_timetable` sets.
-- `app.guard_timetable_slots_write` additionally blocks any insert/update/
-- delete on timetable_slots whose version is not `draft` (so a published
-- version's slots are immutable without needing per-column checks).
-- `app.guard_timetable_slots_period` rejects any slot pointed at a break
-- period.
--
-- publish_timetable (app.* core + public.* thin wrapper, same split as
-- 0068's publish_announcement): role check (owner/principal/admin for the
-- version's institution), draft-only, archives the previous published
-- version of the same (institution, academic_year) before flipping this
-- one to published (order matters: the partial unique index would reject
-- the reverse order), audits.

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  name text not null check (length(name) between 1 and 40),
  capacity int not null check (capacity between 1 and 500),
  kind text not null default 'classroom' check (length(kind) between 1 and 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, name)
);

create trigger set_updated_at
before update on public.rooms
for each row execute function app.set_updated_at();

alter table public.rooms enable row level security;

create policy rooms_select on public.rooms
  for select to authenticated
  using (institution_id = any((select app.member_institutions())));

create policy rooms_insert on public.rooms
  for insert to authenticated
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy rooms_update on public.rooms
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy rooms_delete on public.rooms
  for delete to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']));

-- ---------------------------------------------------------------------------
-- periods — the school's bell schedule.
-- ---------------------------------------------------------------------------

create table public.periods (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  seq int not null check (seq between 1 and 12),
  name text not null check (length(name) between 1 and 30),
  starts_at time not null,
  ends_at time not null,
  is_break boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, seq),
  check (starts_at < ends_at)
);

create trigger set_updated_at
before update on public.periods
for each row execute function app.set_updated_at();

alter table public.periods enable row level security;

create policy periods_select on public.periods
  for select to authenticated
  using (institution_id = any((select app.member_institutions())));

create policy periods_insert on public.periods
  for insert to authenticated
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy periods_update on public.periods
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy periods_delete on public.periods
  for delete to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']));

-- ---------------------------------------------------------------------------
-- timetable_versions
-- ---------------------------------------------------------------------------

create table public.timetable_versions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  academic_year_id uuid not null references public.academic_years (id),
  name text not null check (length(name) between 1 and 60),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  published_by uuid references public.profiles (id),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index timetable_versions_one_published_idx
  on public.timetable_versions (institution_id, academic_year_id)
  where status = 'published';

create trigger set_updated_at
before update on public.timetable_versions
for each row execute function app.set_updated_at();

-- Same shape as 0068's app.guard_announcements_update: blocks any direct
-- status change outside the GUC publish_timetable sets; every other column
-- stays governed by the ordinary update policy below.
create function app.guard_timetable_versions_update()
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

  if current_setting('app.allow_timetable_publish', true) = 'on' then
    return new;
  end if;

  if new.status is distinct from old.status then
    raise exception 'code:forbidden' using detail = 'timetable version status only changes via publish_timetable';
  end if;

  return new;
end;
$$;

create trigger guard_timetable_versions_update
before update on public.timetable_versions
for each row execute function app.guard_timetable_versions_update();

alter table public.timetable_versions enable row level security;

create policy timetable_versions_select on public.timetable_versions
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or (status = 'published' and institution_id = any((select app.member_institutions())))
  );

create policy timetable_versions_insert on public.timetable_versions
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and exists (
      select 1 from public.academic_years y
      where y.id = timetable_versions.academic_year_id and y.institution_id = timetable_versions.institution_id
    )
    and created_by = app.current_user_id()
    and status = 'draft'
    and published_at is null
    and published_by is null
  );

create policy timetable_versions_update on public.timetable_versions
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and exists (
      select 1 from public.academic_years y
      where y.id = timetable_versions.academic_year_id and y.institution_id = timetable_versions.institution_id
    )
  );

-- ---------------------------------------------------------------------------
-- timetable_slots
-- ---------------------------------------------------------------------------

create table public.timetable_slots (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  version_id uuid not null references public.timetable_versions (id),
  class_section_id uuid not null references public.class_sections (id),
  subject_id uuid not null references public.subjects (id),
  teacher_id uuid not null references public.staff (id),
  room_id uuid references public.rooms (id),
  weekday int not null check (weekday between 1 and 6),
  period_id uuid not null references public.periods (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Named explicitly: the default "<table>_<cols>_key" name for the first
  -- constraint is 65 bytes, past Postgres's 63-byte identifier limit, so
  -- both are named here to keep them distinct and predictable (actions map
  -- 23505 -> conflict by constraint name, M07-tasks.md rulings).
  constraint timetable_slots_section_slot_key unique (version_id, class_section_id, weekday, period_id),
  constraint timetable_slots_teacher_slot_key unique (version_id, teacher_id, weekday, period_id)
);

create unique index timetable_slots_room_unique_idx
  on public.timetable_slots (version_id, room_id, weekday, period_id)
  where room_id is not null;

create trigger set_updated_at
before update on public.timetable_slots
for each row execute function app.set_updated_at();

-- Role-blind data validation (no institution/role check needed: period_id
-- is already bound to the row's own institution by the insert/update
-- policy below, and is_break is a property of that period, not of who is
-- writing). security definer only so the check does not depend on the
-- caller's own select visibility of public.periods.
create function app.guard_timetable_slots_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_break boolean;
begin
  select is_break into v_is_break from public.periods where id = new.period_id;

  if v_is_break then
    raise exception 'code:validation_failed' using detail = 'timetable slots cannot be scheduled on a break period';
  end if;

  return new;
end;
$$;

create trigger guard_timetable_slots_period
before insert or update on public.timetable_slots
for each row execute function app.guard_timetable_slots_period();

-- security definer: must see the parent version's status regardless of the
-- caller's own select visibility of public.timetable_versions, so a write
-- this trigger should block can never slip through because the caller
-- happens not to see that row.
create function app.guard_timetable_slots_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version_id uuid := coalesce(new.version_id, old.version_id);
  v_status text;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  then
    return coalesce(new, old);
  end if;

  select status into v_status from public.timetable_versions where id = v_version_id;

  if v_status is distinct from 'draft' then
    raise exception 'code:invalid_state' using detail = 'timetable slots can only be written while their version is draft';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger guard_timetable_slots_write
before insert or update or delete on public.timetable_slots
for each row execute function app.guard_timetable_slots_write();

alter table public.timetable_slots enable row level security;

-- owner/principal/admin: all slots of every version (draft, published,
-- archived). Other staff roles (admissions/accountant/exam_controller/
-- teacher): published slots only. guardian/student: published slots of
-- their own child's/own current section only (lesson 7: initPlan helpers,
-- no per-row security definer calls).
create policy timetable_slots_select on public.timetable_slots
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or (
      exists (
        select 1 from public.timetable_versions v
        where v.id = timetable_slots.version_id and v.status = 'published'
      )
      and (
        institution_id = any((select app.my_institution_ids(array['admissions', 'accountant', 'exam_controller', 'teacher'])))
        or class_section_id = any((select app.my_student_section_ids()))
      )
    )
  );

create policy timetable_slots_insert on public.timetable_slots
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and exists (
      select 1 from public.timetable_versions v
      where v.id = timetable_slots.version_id and v.institution_id = timetable_slots.institution_id
    )
    and exists (
      select 1 from public.class_sections cs
      where cs.id = timetable_slots.class_section_id and cs.institution_id = timetable_slots.institution_id
    )
    and exists (
      select 1 from public.subjects sub
      where sub.id = timetable_slots.subject_id and sub.institution_id = timetable_slots.institution_id
    )
    and app.staff_in_institution(timetable_slots.teacher_id, timetable_slots.institution_id)
    and (
      timetable_slots.room_id is null
      or exists (
        select 1 from public.rooms r
        where r.id = timetable_slots.room_id and r.institution_id = timetable_slots.institution_id
      )
    )
    and exists (
      select 1 from public.periods p
      where p.id = timetable_slots.period_id and p.institution_id = timetable_slots.institution_id
    )
  );

create policy timetable_slots_update on public.timetable_slots
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and exists (
      select 1 from public.timetable_versions v
      where v.id = timetable_slots.version_id and v.institution_id = timetable_slots.institution_id
    )
    and exists (
      select 1 from public.class_sections cs
      where cs.id = timetable_slots.class_section_id and cs.institution_id = timetable_slots.institution_id
    )
    and exists (
      select 1 from public.subjects sub
      where sub.id = timetable_slots.subject_id and sub.institution_id = timetable_slots.institution_id
    )
    and app.staff_in_institution(timetable_slots.teacher_id, timetable_slots.institution_id)
    and (
      timetable_slots.room_id is null
      or exists (
        select 1 from public.rooms r
        where r.id = timetable_slots.room_id and r.institution_id = timetable_slots.institution_id
      )
    )
    and exists (
      select 1 from public.periods p
      where p.id = timetable_slots.period_id and p.institution_id = timetable_slots.institution_id
    )
  );

create policy timetable_slots_delete on public.timetable_slots
  for delete to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']));

-- ---------------------------------------------------------------------------
-- app.publish_timetable / public.publish_timetable (M07 rulings, same split
-- as 0068's publish_announcement).
-- ---------------------------------------------------------------------------

create function app.publish_timetable(p_version_id uuid)
returns public.timetable_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.timetable_versions;
  v_previous_id uuid;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_version from public.timetable_versions where id = p_version_id for update;
  if v_version.id is null then
    raise exception 'code:not_found' using detail = 'timetable version not found';
  end if;

  if not app.has_role(v_version.institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold timetable.manage for this institution';
  end if;

  if v_version.status <> 'draft' then
    raise exception 'code:invalid_state' using detail = format('timetable version must be draft to publish; current status is %s', v_version.status);
  end if;

  perform set_config('app.allow_timetable_publish', 'on', true);

  select id into v_previous_id
  from public.timetable_versions
  where institution_id = v_version.institution_id
    and academic_year_id = v_version.academic_year_id
    and status = 'published'
    and id <> v_version.id
  for update;

  if v_previous_id is not null then
    update public.timetable_versions set status = 'archived' where id = v_previous_id;
  end if;

  update public.timetable_versions
  set status = 'published', published_at = now(), published_by = app.current_user_id()
  where id = p_version_id
  returning * into v_version;

  perform app.audit(
    v_version.institution_id,
    app.current_user_id(),
    'timetable.published',
    'timetable_versions',
    v_version.id,
    jsonb_build_object('status', 'draft'),
    jsonb_build_object('status', 'published'),
    null
  );

  return v_version;
end;
$$;

revoke execute on function app.publish_timetable(uuid) from public, anon, authenticated;

create function public.publish_timetable(p_version_id uuid)
returns public.timetable_versions
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.publish_timetable(p_version_id);
end;
$$;

revoke execute on function public.publish_timetable(uuid) from public, anon;
grant execute on function public.publish_timetable(uuid) to authenticated;
