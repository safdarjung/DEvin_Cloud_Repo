-- Features-18 #19 (SPEC §A2): school labs module (key `school_labs`, default
-- enabled). Mirrors 0116 (hostel) for definer shape (row lock, non-member ->
-- not_found, member without role -> forbidden) and 0090/0113 for RLS shape.
--
-- Tables (all institution-scoped; children bound by composite FK to the
-- parent's (id, institution_id) where the parent is in this module)
--   school_labs              name, kind science/computer/language/other,
--                            room_id -> rooms (nullable), capacity, is_active.
--                            No delete (deactivate).
--   school_lab_bookings      lab, class_section_id, subject_id, staff_id
--                            (the teacher), date, period_id, purpose,
--                            status booked/cancelled, booked_by,
--                            cancelled_at/cancelled_by. Written only by the
--                            two definers below. Partial unique
--                            school_lab_bookings_one_booked_key on
--                            (lab_id, date, period_id) where status = 'booked'.
--   school_lab_equipment     lab, name, kind equipment/chemical/consumable,
--                            quantity numeric(12,3) >= 0, unit, hazard_class
--                            (nullable; flammable/corrosive/toxic/oxidising/
--                            explosive/irritant/compressed_gas/health_hazard/
--                            environmental), expiry_on (nullable), condition
--                            good/fair/needs_repair/out_of_service.
--   school_lab_experiments   booking_id, title, curriculum_unit_id (nullable),
--                            notes, completed, recorded_by.
--   school_lab_incidents     lab, booking_id (nullable; must be a booking of
--                            the same lab — composite FK), kind
--                            breakage/safety, severity low/medium/high,
--                            description, cost_paise bigint (nullable, >= 0),
--                            reported_by. Append-only (app.block_mutation;
--                            demo_reset bypass via app.allow_reset).
--
-- Functions (public, PostgREST-callable)
--   book_school_lab(p_lab_id uuid, p_class_section_id uuid, p_subject_id uuid,
--     p_date date, p_period_id uuid, p_purpose text default null,
--     p_staff_id uuid default null) -> jsonb {booking_id, lab_id, date,
--     period_id, staff_id}
--     definer; lab.book roles. Locks the lab row; enforces lab active, date
--     >= institution "today" (locale timezone, default Asia/Kolkata), period
--     not a break, section/subject/period/staff in the lab's institution, no
--     booked row for (lab, date, period) -> code:conflict (the partial unique
--     index backstops, also mapped to code:conflict). Teachers: staff_id is
--     the caller's own active staff row (app.my_staff_ids); a p_staff_id
--     naming anyone else -> code:forbidden. Managers (owner/principal/admin):
--     p_staff_id = any active staff of the institution, default own.
--   cancel_school_lab_booking(p_booking_id uuid) -> jsonb {booking_id, status}
--     definer; managers cancel any booked row; teachers only their own
--     (staff_id in app.my_staff_ids) with date >= today. Already cancelled ->
--     code:invalid_state.
--   school_lab_utilisation(p_institution_id uuid, p_from date, p_to date)
--     -> table(lab_id uuid, bookings bigint, periods_used bigint)
--     invoker, name-free aggregate; every lab of the institution (zero rows
--     included); bookings = booked rows in range, periods_used = distinct
--     period_id among them. Range at most 366 days else
--     code:validation_failed. Base-table RLS applies (non-lab.read -> empty).
--
-- RLS matrix (M = owner, principal, admin; T = teacher; R = M + T = lab.read)
--   table                    select  insert       update              delete
--   school_labs              R       M            M (columns)         none
--   school_lab_bookings      R       RPC          RPC                 none
--   school_lab_equipment     R       M            M (columns)         M
--   school_lab_experiments   R       M, T own*    M, T own* (columns) M, T own*
--   school_lab_incidents     R       M, T own*    none (append-only)  none
--   * own = the booking's staff_id is one of the caller's staff ids; insert
--     also needs the booking to be status 'booked' (experiments: always;
--     incidents: T only — a teacher's incident must name such a booking,
--     a manager's booking_id is optional).
--   Students, guardians, accountant and other roles: no access.
--   room_id / curriculum_unit_id are bound to the row's institution in
--   `with check`; class section, subject, period, staff in the definer.
--
-- Seed notes (service role bypasses RLS and the definers' rules)
--   - school_lab_bookings.booked_by: not null, no default — seed must set it.
--     Cancelled rows: set cancelled_at + cancelled_by. Seed may insert past
--     dates directly; keep (lab_id, date, period_id) unique among booked
--     rows, use non-break periods and same-institution section/subject/staff.
--   - school_lab_experiments.recorded_by and school_lab_incidents.reported_by
--     default to app.current_user_id(), which is null under service role —
--     seed must set both.
--   - school_lab_incidents.booking_id must belong to the incident's lab_id.
--
-- Reuses (never redefines): app.set_updated_at, app.block_mutation,
-- app.current_user_id, app.is_member, app.has_role (0001), app.audit (0003),
-- app.my_institution_ids (0020), app.my_staff_ids (0070),
-- app.module_catalog (0084).

insert into app.module_catalog (key, default_enabled) values ('school_labs', true)
on conflict (key) do update set default_enabled = excluded.default_enabled;

-- ---------------------------------------------------------------------------
-- school_labs
-- ---------------------------------------------------------------------------

create table public.school_labs (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  name text not null check (char_length(name) between 1 and 80),
  kind text not null check (kind in ('science', 'computer', 'language', 'other')),
  room_id uuid references public.rooms (id),
  capacity int not null check (capacity between 1 and 500),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint school_labs_id_institution_key unique (id, institution_id),
  constraint school_labs_name_key unique (institution_id, name)
);

create index school_labs_room_idx on public.school_labs (room_id) where room_id is not null;

create trigger set_updated_at
before update on public.school_labs
for each row execute function app.set_updated_at();

alter table public.school_labs enable row level security;

create policy school_labs_select on public.school_labs
  for select to authenticated
  using (school_labs.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'teacher']))));

create policy school_labs_insert on public.school_labs
  for insert to authenticated
  with check (
    school_labs.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    and (
      school_labs.room_id is null
      or exists (select 1 from public.rooms r where r.id = school_labs.room_id and r.institution_id = school_labs.institution_id)
    )
  );

create policy school_labs_update on public.school_labs
  for update to authenticated
  using (school_labs.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))))
  with check (
    school_labs.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    and (
      school_labs.room_id is null
      or exists (select 1 from public.rooms r where r.id = school_labs.room_id and r.institution_id = school_labs.institution_id)
    )
  );

revoke all on public.school_labs from anon, authenticated;
grant select, insert on public.school_labs to authenticated;
grant update (name, kind, room_id, capacity, is_active) on public.school_labs to authenticated;
grant select, insert, update, delete on public.school_labs to service_role;

-- ---------------------------------------------------------------------------
-- school_lab_bookings — written only by the definers below (lesson 3).
-- ---------------------------------------------------------------------------

create table public.school_lab_bookings (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  lab_id uuid not null,
  class_section_id uuid not null references public.class_sections (id),
  subject_id uuid not null references public.subjects (id),
  staff_id uuid not null references public.staff (id),
  date date not null,
  period_id uuid not null references public.periods (id),
  purpose text check (char_length(purpose) between 1 and 200),
  status text not null default 'booked' check (status in ('booked', 'cancelled')),
  booked_by uuid not null references public.profiles (id),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint school_lab_bookings_lab_fk foreign key (lab_id, institution_id) references public.school_labs (id, institution_id),
  constraint school_lab_bookings_id_institution_key unique (id, institution_id),
  constraint school_lab_bookings_id_lab_institution_key unique (id, lab_id, institution_id),
  constraint school_lab_bookings_cancel_pair check ((status = 'cancelled') = (cancelled_at is not null))
);

create unique index school_lab_bookings_one_booked_key on public.school_lab_bookings (lab_id, date, period_id) where status = 'booked';
-- A teacher cannot be in two labs in the same period (book_school_lab maps the violation to code:conflict).
create unique index school_lab_bookings_staff_one_booked_key on public.school_lab_bookings (staff_id, date, period_id) where status = 'booked';
create index school_lab_bookings_lab_date_idx on public.school_lab_bookings (lab_id, date);
create index school_lab_bookings_institution_date_idx on public.school_lab_bookings (institution_id, date);
create index school_lab_bookings_staff_idx on public.school_lab_bookings (staff_id);
create index school_lab_bookings_class_section_idx on public.school_lab_bookings (class_section_id);
create index school_lab_bookings_subject_idx on public.school_lab_bookings (subject_id);
create index school_lab_bookings_period_idx on public.school_lab_bookings (period_id);

create trigger set_updated_at
before update on public.school_lab_bookings
for each row execute function app.set_updated_at();

alter table public.school_lab_bookings enable row level security;

create policy school_lab_bookings_select on public.school_lab_bookings
  for select to authenticated
  using (school_lab_bookings.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'teacher']))));

revoke all on public.school_lab_bookings from anon, authenticated;
grant select on public.school_lab_bookings to authenticated;
grant select, insert, update, delete on public.school_lab_bookings to service_role;

-- ---------------------------------------------------------------------------
-- school_lab_equipment
-- ---------------------------------------------------------------------------

create table public.school_lab_equipment (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  lab_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  kind text not null check (kind in ('equipment', 'chemical', 'consumable')),
  quantity numeric(12, 3) not null default 0 check (quantity >= 0),
  unit text not null check (char_length(unit) between 1 and 20),
  hazard_class text check (hazard_class in (
    'flammable', 'corrosive', 'toxic', 'oxidising', 'explosive',
    'irritant', 'compressed_gas', 'health_hazard', 'environmental'
  )),
  expiry_on date,
  condition text not null default 'good' check (condition in ('good', 'fair', 'needs_repair', 'out_of_service')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint school_lab_equipment_lab_fk foreign key (lab_id, institution_id) references public.school_labs (id, institution_id)
);

create index school_lab_equipment_lab_idx on public.school_lab_equipment (lab_id);
create index school_lab_equipment_institution_expiry_idx on public.school_lab_equipment (institution_id, expiry_on);

create trigger set_updated_at
before update on public.school_lab_equipment
for each row execute function app.set_updated_at();

alter table public.school_lab_equipment enable row level security;

create policy school_lab_equipment_select on public.school_lab_equipment
  for select to authenticated
  using (school_lab_equipment.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'teacher']))));

-- lab_id is bound to the same institution by the composite FK.
create policy school_lab_equipment_insert on public.school_lab_equipment
  for insert to authenticated
  with check (school_lab_equipment.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

create policy school_lab_equipment_update on public.school_lab_equipment
  for update to authenticated
  using (school_lab_equipment.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))))
  with check (school_lab_equipment.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

create policy school_lab_equipment_delete on public.school_lab_equipment
  for delete to authenticated
  using (school_lab_equipment.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

revoke all on public.school_lab_equipment from anon, authenticated;
grant select, insert, delete on public.school_lab_equipment to authenticated;
grant update (lab_id, name, kind, quantity, unit, hazard_class, expiry_on, condition) on public.school_lab_equipment to authenticated;
grant select, insert, update, delete on public.school_lab_equipment to service_role;

-- ---------------------------------------------------------------------------
-- school_lab_experiments — experiment log per booking.
-- ---------------------------------------------------------------------------

create table public.school_lab_experiments (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  booking_id uuid not null,
  title text not null check (char_length(title) between 1 and 160),
  curriculum_unit_id uuid references public.curriculum_units (id),
  notes text check (char_length(notes) between 1 and 2000),
  completed boolean not null default false,
  recorded_by uuid not null references public.profiles (id) default app.current_user_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint school_lab_experiments_booking_fk foreign key (booking_id, institution_id) references public.school_lab_bookings (id, institution_id)
);

create index school_lab_experiments_booking_idx on public.school_lab_experiments (booking_id);
create index school_lab_experiments_institution_idx on public.school_lab_experiments (institution_id, created_at desc);
create index school_lab_experiments_curriculum_unit_idx on public.school_lab_experiments (curriculum_unit_id) where curriculum_unit_id is not null;

create trigger set_updated_at
before update on public.school_lab_experiments
for each row execute function app.set_updated_at();

alter table public.school_lab_experiments enable row level security;

create policy school_lab_experiments_select on public.school_lab_experiments
  for select to authenticated
  using (school_lab_experiments.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'teacher']))));

-- Manager, or teacher on own booking; booking must still be booked.
create policy school_lab_experiments_insert on public.school_lab_experiments
  for insert to authenticated
  with check (
    school_lab_experiments.recorded_by = (select app.current_user_id())
    and exists (
      select 1 from public.school_lab_bookings b
      where b.id = school_lab_experiments.booking_id
        and b.institution_id = school_lab_experiments.institution_id
        and b.status = 'booked'
        and (
          b.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
          or (
            b.institution_id = any((select app.my_institution_ids(array['teacher'])))
            and b.staff_id = any((select app.my_staff_ids()))
          )
        )
    )
    and (
      school_lab_experiments.curriculum_unit_id is null
      or exists (
        select 1 from public.curriculum_units cu
        where cu.id = school_lab_experiments.curriculum_unit_id and cu.institution_id = school_lab_experiments.institution_id
      )
    )
  );

-- Column grant below limits UPDATE to title, curriculum_unit_id, notes, completed.
create policy school_lab_experiments_update on public.school_lab_experiments
  for update to authenticated
  using (
    school_lab_experiments.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or exists (
      select 1 from public.school_lab_bookings b
      where b.id = school_lab_experiments.booking_id
        and b.institution_id = school_lab_experiments.institution_id
        and b.institution_id = any((select app.my_institution_ids(array['teacher'])))
        and b.staff_id = any((select app.my_staff_ids()))
    )
  )
  with check (
    (
      school_lab_experiments.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
      or exists (
        select 1 from public.school_lab_bookings b
        where b.id = school_lab_experiments.booking_id
          and b.institution_id = school_lab_experiments.institution_id
          and b.institution_id = any((select app.my_institution_ids(array['teacher'])))
          and b.staff_id = any((select app.my_staff_ids()))
      )
    )
    and (
      school_lab_experiments.curriculum_unit_id is null
      or exists (
        select 1 from public.curriculum_units cu
        where cu.id = school_lab_experiments.curriculum_unit_id and cu.institution_id = school_lab_experiments.institution_id
      )
    )
  );

create policy school_lab_experiments_delete on public.school_lab_experiments
  for delete to authenticated
  using (
    school_lab_experiments.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or exists (
      select 1 from public.school_lab_bookings b
      where b.id = school_lab_experiments.booking_id
        and b.institution_id = school_lab_experiments.institution_id
        and b.institution_id = any((select app.my_institution_ids(array['teacher'])))
        and b.staff_id = any((select app.my_staff_ids()))
    )
  );

revoke all on public.school_lab_experiments from anon, authenticated;
grant select, insert, delete on public.school_lab_experiments to authenticated;
grant update (title, curriculum_unit_id, notes, completed) on public.school_lab_experiments to authenticated;
grant select, insert, update, delete on public.school_lab_experiments to service_role;

-- ---------------------------------------------------------------------------
-- school_lab_incidents — append-only breakage/safety log.
-- ---------------------------------------------------------------------------

create table public.school_lab_incidents (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  lab_id uuid not null,
  booking_id uuid,
  kind text not null check (kind in ('breakage', 'safety')),
  severity text not null check (severity in ('low', 'medium', 'high')),
  description text not null check (char_length(description) between 1 and 1000),
  cost_paise bigint check (cost_paise >= 0),
  reported_by uuid not null references public.profiles (id) default app.current_user_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint school_lab_incidents_lab_fk foreign key (lab_id, institution_id) references public.school_labs (id, institution_id),
  -- MATCH SIMPLE: skipped when booking_id is null; otherwise the booking must be of this lab.
  constraint school_lab_incidents_booking_fk foreign key (booking_id, lab_id, institution_id)
    references public.school_lab_bookings (id, lab_id, institution_id)
);

create index school_lab_incidents_institution_idx on public.school_lab_incidents (institution_id, created_at desc);
create index school_lab_incidents_lab_idx on public.school_lab_incidents (lab_id);
create index school_lab_incidents_booking_idx on public.school_lab_incidents (booking_id) where booking_id is not null;

create trigger set_updated_at
before update on public.school_lab_incidents
for each row execute function app.set_updated_at();

create trigger block_mutation
before update or delete on public.school_lab_incidents
for each row execute function app.block_mutation();

alter table public.school_lab_incidents enable row level security;

create policy school_lab_incidents_select on public.school_lab_incidents
  for select to authenticated
  using (school_lab_incidents.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'teacher']))));

-- Teacher: booking_id required, own and still booked. Manager: booking optional.
create policy school_lab_incidents_insert on public.school_lab_incidents
  for insert to authenticated
  with check (
    school_lab_incidents.reported_by = (select app.current_user_id())
    and (
      school_lab_incidents.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
      or (
        school_lab_incidents.institution_id = any((select app.my_institution_ids(array['teacher'])))
        and exists (
          select 1 from public.school_lab_bookings b
          where b.id = school_lab_incidents.booking_id
            and b.institution_id = school_lab_incidents.institution_id
            and b.status = 'booked'
            and b.staff_id = any((select app.my_staff_ids()))
        )
      )
    )
  );

revoke all on public.school_lab_incidents from anon, authenticated;
grant select, insert on public.school_lab_incidents to authenticated;
grant select, insert, update, delete on public.school_lab_incidents to service_role;

-- ---------------------------------------------------------------------------
-- public.book_school_lab — single public definer (0116 shape).
-- ---------------------------------------------------------------------------

create function public.book_school_lab(
  p_lab_id uuid,
  p_class_section_id uuid,
  p_subject_id uuid,
  p_date date,
  p_period_id uuid,
  p_purpose text default null,
  p_staff_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lab public.school_labs;
  v_is_manager boolean;
  v_staff_id uuid;
  v_is_break boolean;
  v_today date;
  v_purpose text := nullif(btrim(p_purpose), '');
  v_booking_id uuid;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  -- Row lock serialises concurrent bookings of one lab, so the
  -- double-booking check below is race-free.
  select * into v_lab from public.school_labs where id = p_lab_id for update;

  if v_lab.id is null or not app.is_member(v_lab.institution_id) then
    raise exception 'code:not_found' using detail = 'lab not found';
  end if;

  v_is_manager := app.has_role(v_lab.institution_id, array['owner', 'principal', 'admin']);

  if not v_is_manager and not app.has_role(v_lab.institution_id, array['teacher']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold lab.book for this institution';
  end if;

  if not v_lab.is_active then
    raise exception 'code:invalid_state' using detail = 'lab is inactive';
  end if;

  -- Teachers book only for themselves: staff id comes from the caller's
  -- memberships; only a manager may name another staff member.
  if v_is_manager and p_staff_id is not null then
    select s.id into v_staff_id
    from public.staff s
    where s.id = p_staff_id and s.institution_id = v_lab.institution_id and s.status = 'active';

    if v_staff_id is null then
      raise exception 'code:not_found' using detail = 'staff member not found';
    end if;
  else
    select s.id into v_staff_id
    from public.staff s
    where s.institution_id = v_lab.institution_id
      and s.status = 'active'
      and s.id = any(array(select app.my_staff_ids()))
      and (p_staff_id is null or s.id = p_staff_id)
    order by s.id
    limit 1;

    if v_staff_id is null and v_is_manager then
      raise exception 'code:validation_failed' using detail = 'p_staff_id is required: caller has no active staff record';
    elsif v_staff_id is null then
      raise exception 'code:forbidden' using detail = 'teachers book labs only for themselves';
    end if;
  end if;

  if not exists (
    select 1 from public.class_sections cs
    where cs.id = p_class_section_id and cs.institution_id = v_lab.institution_id
  ) then
    raise exception 'code:not_found' using detail = 'class section not found';
  end if;

  if not exists (
    select 1 from public.subjects su
    where su.id = p_subject_id and su.institution_id = v_lab.institution_id
  ) then
    raise exception 'code:not_found' using detail = 'subject not found';
  end if;

  select p.is_break into v_is_break
  from public.periods p
  where p.id = p_period_id and p.institution_id = v_lab.institution_id;

  if v_is_break is null then
    raise exception 'code:not_found' using detail = 'period not found';
  end if;

  if v_is_break then
    raise exception 'code:validation_failed' using detail = 'a break period cannot be booked';
  end if;

  select (now() at time zone coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata'))::date into v_today
  from public.institutions i where i.id = v_lab.institution_id;

  if p_date is null or p_date < v_today then
    raise exception 'code:validation_failed' using detail = 'booking date must be today or later';
  end if;

  if char_length(v_purpose) > 200 then
    raise exception 'code:validation_failed' using detail = 'purpose must be at most 200 characters';
  end if;

  if exists (
    select 1 from public.school_lab_bookings b
    where b.lab_id = p_lab_id and b.date = p_date and b.period_id = p_period_id and b.status = 'booked'
  ) then
    raise exception 'code:conflict' using detail = 'lab is already booked for that date and period';
  end if;

  begin
    insert into public.school_lab_bookings (
      institution_id, lab_id, class_section_id, subject_id, staff_id, date, period_id, purpose, booked_by
    )
    values (
      v_lab.institution_id, p_lab_id, p_class_section_id, p_subject_id, v_staff_id, p_date, p_period_id, v_purpose, app.current_user_id()
    )
    returning id into v_booking_id;
  exception when unique_violation then
    raise exception 'code:conflict' using detail = 'the lab or the teacher is already booked for that date and period';
  end;

  perform app.audit(
    v_lab.institution_id,
    app.current_user_id(),
    'school_lab.booking.created',
    'school_lab_booking',
    v_booking_id,
    null,
    jsonb_build_object(
      'lab_id', p_lab_id, 'date', p_date, 'period_id', p_period_id,
      'staff_id', v_staff_id, 'class_section_id', p_class_section_id, 'subject_id', p_subject_id
    ),
    null
  );

  return jsonb_build_object(
    'booking_id', v_booking_id, 'lab_id', p_lab_id, 'date', p_date,
    'period_id', p_period_id, 'staff_id', v_staff_id
  );
end;
$$;

revoke execute on function public.book_school_lab(uuid, uuid, uuid, date, uuid, text, uuid) from public, anon;
grant execute on function public.book_school_lab(uuid, uuid, uuid, date, uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.cancel_school_lab_booking — managers any booked row; teachers only
-- their own, today or later.
-- ---------------------------------------------------------------------------

create function public.cancel_school_lab_booking(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.school_lab_bookings;
  v_today date;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_booking from public.school_lab_bookings where id = p_booking_id for update;

  if v_booking.id is null or not app.is_member(v_booking.institution_id) then
    raise exception 'code:not_found' using detail = 'booking not found';
  end if;

  if not app.has_role(v_booking.institution_id, array['owner', 'principal', 'admin']) then
    if not app.has_role(v_booking.institution_id, array['teacher']) then
      raise exception 'code:forbidden' using detail = 'caller does not hold lab.book for this institution';
    end if;

    if not (v_booking.staff_id = any(array(select app.my_staff_ids()))) then
      raise exception 'code:forbidden' using detail = 'teachers cancel only their own bookings';
    end if;

    select (now() at time zone coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata'))::date into v_today
    from public.institutions i where i.id = v_booking.institution_id;

    if v_booking.date < v_today then
      raise exception 'code:invalid_state' using detail = 'past bookings cannot be cancelled';
    end if;
  end if;

  if v_booking.status <> 'booked' then
    raise exception 'code:invalid_state' using detail = 'booking already cancelled';
  end if;

  update public.school_lab_bookings
  set status = 'cancelled', cancelled_at = now(), cancelled_by = app.current_user_id()
  where id = p_booking_id;

  perform app.audit(
    v_booking.institution_id,
    app.current_user_id(),
    'school_lab.booking.cancelled',
    'school_lab_booking',
    p_booking_id,
    null,
    jsonb_build_object('lab_id', v_booking.lab_id, 'date', v_booking.date, 'period_id', v_booking.period_id),
    null
  );

  return jsonb_build_object('booking_id', p_booking_id, 'status', 'cancelled');
end;
$$;

revoke execute on function public.cancel_school_lab_booking(uuid) from public, anon;
grant execute on function public.cancel_school_lab_booking(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.school_lab_utilisation — name-free per-lab aggregate. Invoker
-- function, not a view (0120: app.demo_reset deletes from every relation
-- with an institution_id column).
-- ---------------------------------------------------------------------------

create function public.school_lab_utilisation(p_institution_id uuid, p_from date, p_to date)
returns table (lab_id uuid, bookings bigint, periods_used bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'code:validation_failed' using detail = 'p_to must be on or after p_from, and the range must be at most 366 days';
  end if;

  return query
    select l.id, count(b.id), count(distinct b.period_id)
    from public.school_labs l
    left join public.school_lab_bookings b
      on b.lab_id = l.id
     and b.institution_id = l.institution_id
     and b.status = 'booked'
     and b.date between p_from and p_to
    where l.institution_id = p_institution_id
    group by l.id
    order by l.id;
end;
$$;

revoke execute on function public.school_lab_utilisation(uuid, date, date) from public, anon;
grant execute on function public.school_lab_utilisation(uuid, date, date) to authenticated;
