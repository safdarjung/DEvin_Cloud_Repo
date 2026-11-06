-- X08-T2 (this part): PTM tables + RLS + definers + app.module_catalog
-- insert (X08-tasks.md header rulings). X08-T3 appends a surveys section
-- below, in the same unmerged file.
--
-- app.my_staff_ids() already exists (0070) and is reused as-is for the
-- ptm_slots/ptm_bookings RLS "own slots" scope; it is not redefined here.
--
-- Status machine for ptm_events is a direct UPDATE (no publish RPC): the
-- action sets status='published' via PostgREST and
-- `app.guard_ptm_events_update` validates the transition (draft->published
-- only, >=1 section, cutoff still in the future), stamps published_at/by,
-- and rejects every other column change or transition. ptm_slots has no
-- UPDATE at all (times are derived from seq, never stored);
-- `app.guard_ptm_slots_write` bounds an insert's seq to the event's slot
-- count and blocks deleting a slot that still has a booked booking.
-- ptm_bookings has no write RLS policy at all — the only paths in are
-- `book_ptm_slot`/`cancel_ptm_booking` (app.* core + public.* thin
-- wrapper, same split as 0068's publish_announcement). Neither guard needs
-- a service_role/postgres bypass (lesson 5): the seed inserts PTM rows in
-- their final, already-valid shape via service-role INSERT, which these
-- triggers (one UPDATE-only, one INSERT/DELETE-only) never reject for
-- well-formed rows.

insert into app.module_catalog (key, default_enabled) values
  ('ptm', false)
on conflict (key) do update set default_enabled = excluded.default_enabled;

-- ---------------------------------------------------------------------------
-- ptm_events
-- ---------------------------------------------------------------------------

create table public.ptm_events (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  title text not null check (length(title) between 1 and 120),
  event_date date not null,
  day_starts_at time not null,
  day_ends_at time not null,
  slot_minutes smallint not null check (slot_minutes in (5, 10, 15, 20, 30)),
  booking_closes_at timestamptz not null,
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  published_by uuid references public.profiles (id),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ptm_events_day_order_check check (day_ends_at > day_starts_at),
  constraint ptm_events_slot_count_check check (
    extract(epoch from (day_ends_at - day_starts_at)) / 60 / slot_minutes between 1 and 60
  )
);

create index ptm_events_institution_status_idx on public.ptm_events (institution_id, status);

create trigger set_updated_at
before update on public.ptm_events
for each row execute function app.set_updated_at();

create function app.guard_ptm_events_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_section_count int;
begin
  if old.status = 'draft' and new.status = 'published' then
    if new.title is distinct from old.title
      or new.event_date is distinct from old.event_date
      or new.day_starts_at is distinct from old.day_starts_at
      or new.day_ends_at is distinct from old.day_ends_at
      or new.slot_minutes is distinct from old.slot_minutes
      or new.booking_closes_at is distinct from old.booking_closes_at
      or new.institution_id is distinct from old.institution_id
      or new.created_by is distinct from old.created_by
    then
      raise exception 'code:invalid_state' using detail = 'publishing may only set status, published_at, and published_by';
    end if;

    select count(*) into v_section_count from public.ptm_event_sections where event_id = new.id;
    if v_section_count < 1 then
      raise exception 'code:invalid_state' using detail = 'event needs at least one section before it can be published';
    end if;

    if new.booking_closes_at <= now() then
      raise exception 'code:invalid_state' using detail = 'booking_closes_at must be in the future to publish';
    end if;

    new.published_at := now();
    new.published_by := app.current_user_id();
    return new;
  end if;

  raise exception 'code:invalid_state' using detail = 'ptm_events may only move from draft to published, with no other column changes';
end;
$$;

create trigger guard_ptm_events_update
before update on public.ptm_events
for each row execute function app.guard_ptm_events_update();

alter table public.ptm_events enable row level security;

create policy ptm_events_select on public.ptm_events
  for select to authenticated
  using (institution_id = any((select app.my_institution_ids(app.staff_roles()))));

create policy ptm_events_insert on public.ptm_events
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and status = 'draft'
    and published_at is null
    and published_by is null
    and created_by = app.current_user_id()
  );

create policy ptm_events_update on public.ptm_events
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy ptm_events_delete on public.ptm_events
  for delete to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']) and status = 'draft');

-- ---------------------------------------------------------------------------
-- ptm_event_sections
-- ---------------------------------------------------------------------------

create table public.ptm_event_sections (
  event_id uuid not null references public.ptm_events (id) on delete cascade,
  institution_id uuid not null references public.institutions (id),
  class_section_id uuid not null references public.class_sections (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, class_section_id)
);

create trigger set_updated_at
before update on public.ptm_event_sections
for each row execute function app.set_updated_at();

alter table public.ptm_event_sections enable row level security;

create policy ptm_event_sections_select on public.ptm_event_sections
  for select to authenticated
  using (institution_id = any((select app.my_institution_ids(app.staff_roles()))));

create policy ptm_event_sections_insert on public.ptm_event_sections
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and exists (
      select 1 from public.ptm_events ev
      where ev.id = ptm_event_sections.event_id
        and ev.institution_id = ptm_event_sections.institution_id
        and ev.status = 'draft'
    )
    and exists (
      select 1 from public.class_sections cs
      where cs.id = ptm_event_sections.class_section_id
        and cs.institution_id = ptm_event_sections.institution_id
    )
  );

-- ---------------------------------------------------------------------------
-- ptm_slots — no UPDATE; seq k's starts_at/ends_at are derived
-- (day_starts_at + k*slot_minutes), never stored.
-- ---------------------------------------------------------------------------

create table public.ptm_slots (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  event_id uuid not null references public.ptm_events (id) on delete cascade,
  staff_id uuid not null references public.staff (id),
  seq smallint not null check (seq >= 0),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ptm_slots_teacher_seq_key unique (event_id, staff_id, seq),
  constraint ptm_slots_id_event_staff_key unique (id, event_id, staff_id)
);

create index ptm_slots_event_idx on public.ptm_slots (event_id);

create trigger set_updated_at
before update on public.ptm_slots
for each row execute function app.set_updated_at();

create function app.guard_ptm_slots_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_event public.ptm_events;
  v_slot_count int;
  v_booked_count int;
begin
  if tg_op = 'INSERT' then
    select * into v_event from public.ptm_events where id = new.event_id;
    if v_event.id is null then
      raise exception 'code:validation_failed' using detail = 'ptm event not found';
    end if;

    v_slot_count := floor(extract(epoch from (v_event.day_ends_at - v_event.day_starts_at)) / 60 / v_event.slot_minutes)::int;
    if new.seq >= v_slot_count then
      raise exception 'code:validation_failed' using detail = format('seq must be less than the event''s slot count (%s)', v_slot_count);
    end if;

    return new;
  end if;

  select count(*) into v_booked_count
  from public.ptm_bookings
  where slot_id = old.id and status = 'booked';

  if v_booked_count > 0 then
    raise exception 'code:conflict' using detail = 'Slot has a booking.';
  end if;

  return old;
end;
$$;

create trigger guard_ptm_slots_write
before insert or delete on public.ptm_slots
for each row execute function app.guard_ptm_slots_write();

alter table public.ptm_slots enable row level security;

create policy ptm_slots_select on public.ptm_slots
  for select to authenticated
  using (institution_id = any((select app.my_institution_ids(app.staff_roles()))));

create policy ptm_slots_insert on public.ptm_slots
  for insert to authenticated
  with check (
    created_by = app.current_user_id()
    and exists (
      select 1 from public.ptm_events ev
      where ev.id = ptm_slots.event_id and ev.institution_id = ptm_slots.institution_id
    )
    and (
      (
        app.has_role(institution_id, array['owner', 'principal', 'admin'])
        and app.staff_in_institution(staff_id, institution_id)
      )
      or (
        staff_id = any((select app.my_staff_ids()))
        and exists (
          select 1 from public.ptm_event_sections pes
          where pes.event_id = ptm_slots.event_id
            and pes.class_section_id = any((select app.my_taught_section_ids()))
        )
      )
    )
  );

create policy ptm_slots_delete on public.ptm_slots
  for delete to authenticated
  using (
    (
      app.has_role(institution_id, array['owner', 'principal', 'admin'])
      and app.staff_in_institution(staff_id, institution_id)
    )
    or (
      staff_id = any((select app.my_staff_ids()))
      and exists (
        select 1 from public.ptm_event_sections pes
        where pes.event_id = ptm_slots.event_id
          and pes.class_section_id = any((select app.my_taught_section_ids()))
      )
    )
  );

-- ---------------------------------------------------------------------------
-- ptm_bookings — no INSERT/UPDATE/DELETE policy: writes only through
-- book_ptm_slot/cancel_ptm_booking below (and service-role seed inserts,
-- which bypass RLS entirely).
-- ---------------------------------------------------------------------------

create table public.ptm_bookings (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  event_id uuid not null references public.ptm_events (id),
  staff_id uuid not null references public.staff (id),
  slot_id uuid not null,
  student_id uuid not null references public.students (id),
  booked_by uuid not null references public.profiles (id),
  status text not null default 'booked' check (status in ('booked', 'cancelled')),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ptm_bookings_slot_fk foreign key (slot_id, event_id, staff_id) references public.ptm_slots (id, event_id, staff_id) on delete cascade,
  constraint ptm_bookings_cancel_check check ((status = 'cancelled') = (cancelled_at is not null))
);

create unique index ptm_bookings_slot_key on public.ptm_bookings (slot_id) where status = 'booked';
create unique index ptm_bookings_child_teacher_key on public.ptm_bookings (event_id, staff_id, student_id) where status = 'booked';
create index ptm_bookings_student_idx on public.ptm_bookings (student_id);
create index ptm_bookings_staff_event_idx on public.ptm_bookings (staff_id, event_id);

create trigger set_updated_at
before update on public.ptm_bookings
for each row execute function app.set_updated_at();

alter table public.ptm_bookings enable row level security;

create policy ptm_bookings_select on public.ptm_bookings
  for select to authenticated
  using (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    or staff_id = any((select app.my_staff_ids()))
    or student_id = any((select app.my_student_ids()))
  );

-- ---------------------------------------------------------------------------
-- app.section_teacher_ids — internal only (no authenticated grant): a
-- section's eligible PTM teachers (class teacher union subject_assignments
-- teachers), same definition as app.my_taught_section_ids but keyed by a
-- given section instead of the caller. Called only from inside the
-- SECURITY DEFINER functions below, so no PostgREST exposure is needed.
-- ---------------------------------------------------------------------------

create function app.section_teacher_ids(p_class_section_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select cs.class_teacher_id
  from public.class_sections cs
  where cs.id = p_class_section_id
    and cs.class_teacher_id is not null
  union
  select sa.teacher_id
  from public.subject_assignments sa
  where sa.class_section_id = p_class_section_id;
$$;

revoke all on function app.section_teacher_ids(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.ptm_slots_for_student / public.ptm_slots_for_student — a guardian's
-- read of their child's bookable PTM slots. Never exposes another child's
-- booking id (bk_other only flags "taken", it never returns that row's id).
-- ---------------------------------------------------------------------------

create function app.ptm_slots_for_student(p_student_id uuid, p_event_id uuid default null)
returns table (
  event_id uuid,
  event_title text,
  event_date date,
  booking_closes_at timestamptz,
  staff_id uuid,
  teacher_name text,
  subjects text[],
  is_class_teacher boolean,
  slot_id uuid,
  seq smallint,
  starts_at time,
  ends_at time,
  state text,
  booking_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_section_id uuid;
begin
  select s.institution_id into v_institution_id from public.students s where s.id = p_student_id;
  if v_institution_id is null or p_student_id <> any(array(select app.guardian_student_ids(v_institution_id))) then
    raise exception 'code:forbidden' using detail = 'caller is not a guardian of this student';
  end if;

  select e.class_section_id into v_section_id
  from public.enrolments e
  where e.student_id = p_student_id and e.status = 'active';

  if v_section_id is null then
    return;
  end if;

  return query
    select
      ev.id,
      ev.title,
      ev.event_date,
      ev.booking_closes_at,
      sl.staff_id,
      st.full_name,
      coalesce((
        select array_agg(distinct sub.name order by sub.name)
        from public.subject_assignments sa
        join public.subjects sub on sub.id = sa.subject_id
        where sa.class_section_id = v_section_id and sa.teacher_id = sl.staff_id
      ), array[]::text[]),
      (cs.class_teacher_id = sl.staff_id),
      sl.id,
      sl.seq,
      (ev.day_starts_at + (sl.seq * ev.slot_minutes) * interval '1 minute')::time,
      (ev.day_starts_at + ((sl.seq + 1) * ev.slot_minutes) * interval '1 minute')::time,
      case
        when bk_mine.id is not null then 'mine'
        when bk_other.id is not null then 'taken'
        else 'open'
      end,
      bk_mine.id
    from public.ptm_events ev
    join public.ptm_event_sections pes on pes.event_id = ev.id and pes.class_section_id = v_section_id
    join public.class_sections cs on cs.id = v_section_id
    join public.ptm_slots sl on sl.event_id = ev.id and sl.staff_id in (select app.section_teacher_ids(v_section_id))
    join public.staff st on st.id = sl.staff_id
    left join public.ptm_bookings bk_mine on bk_mine.slot_id = sl.id and bk_mine.status = 'booked' and bk_mine.student_id = p_student_id
    left join public.ptm_bookings bk_other on bk_other.slot_id = sl.id and bk_other.status = 'booked' and bk_other.student_id <> p_student_id
    where ev.institution_id = v_institution_id
      and ev.status = 'published'
      and ev.event_date >= (now() at time zone 'Asia/Kolkata')::date
      and (p_event_id is null or ev.id = p_event_id)
    order by ev.event_date, st.full_name, sl.seq;
end;
$$;

revoke all on function app.ptm_slots_for_student(uuid, uuid) from public, anon, authenticated;

create function public.ptm_slots_for_student(p_student_id uuid, p_event_id uuid default null)
returns table (
  event_id uuid,
  event_title text,
  event_date date,
  booking_closes_at timestamptz,
  staff_id uuid,
  teacher_name text,
  subjects text[],
  is_class_teacher boolean,
  slot_id uuid,
  seq smallint,
  starts_at time,
  ends_at time,
  state text,
  booking_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query select * from app.ptm_slots_for_student(p_student_id, p_event_id);
end;
$$;

revoke execute on function public.ptm_slots_for_student(uuid, uuid) from public, anon;
grant execute on function public.ptm_slots_for_student(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- app.book_ptm_slot / public.book_ptm_slot
-- ---------------------------------------------------------------------------

create function app.book_ptm_slot(p_slot_id uuid, p_student_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot public.ptm_slots;
  v_event public.ptm_events;
  v_section_id uuid;
  v_booking_id uuid;
  v_constraint text;
begin
  select * into v_slot from public.ptm_slots where id = p_slot_id;
  if v_slot.id is not null then
    select * into v_event from public.ptm_events where id = v_slot.event_id;
  end if;

  if v_slot.id is null or v_event.id is null or v_event.status <> 'published' then
    raise exception 'code:not_found' using detail = 'ptm slot not found';
  end if;

  if p_student_id <> any(array(select app.guardian_student_ids(v_event.institution_id))) then
    raise exception 'code:forbidden' using detail = 'caller is not a guardian of this student';
  end if;

  if now() >= v_event.booking_closes_at then
    raise exception 'code:invalid_state' using detail = 'Booking is closed.';
  end if;

  select e.class_section_id into v_section_id
  from public.enrolments e
  where e.student_id = p_student_id and e.status = 'active';

  if v_section_id is null
    or not exists (select 1 from public.ptm_event_sections pes where pes.event_id = v_event.id and pes.class_section_id = v_section_id)
    or v_slot.staff_id not in (select app.section_teacher_ids(v_section_id))
  then
    raise exception 'code:validation_failed' using detail = 'this slot is not available to this child';
  end if;

  begin
    insert into public.ptm_bookings (institution_id, event_id, staff_id, slot_id, student_id, booked_by)
    values (v_event.institution_id, v_event.id, v_slot.staff_id, p_slot_id, p_student_id, app.current_user_id())
    returning id into v_booking_id;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'ptm_bookings_slot_key' then
        raise exception 'code:conflict' using detail = 'This slot is already booked.';
      elsif v_constraint = 'ptm_bookings_child_teacher_key' then
        raise exception 'code:conflict' using detail = 'This child already has a slot with this teacher.';
      else
        raise;
      end if;
  end;

  perform app.audit(
    v_event.institution_id,
    app.current_user_id(),
    'ptm.booking.created',
    'ptm_bookings',
    v_booking_id,
    null,
    jsonb_build_object('eventId', v_event.id, 'slotId', p_slot_id, 'studentId', p_student_id),
    null
  );

  return v_booking_id;
end;
$$;

revoke all on function app.book_ptm_slot(uuid, uuid) from public, anon, authenticated;

create function public.book_ptm_slot(p_slot_id uuid, p_student_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.book_ptm_slot(p_slot_id, p_student_id);
end;
$$;

revoke execute on function public.book_ptm_slot(uuid, uuid) from public, anon;
grant execute on function public.book_ptm_slot(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- app.cancel_ptm_booking / public.cancel_ptm_booking
-- ---------------------------------------------------------------------------

create function app.cancel_ptm_booking(p_booking_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.ptm_bookings;
  v_event public.ptm_events;
begin
  select * into v_booking from public.ptm_bookings where id = p_booking_id;
  if v_booking.id is null or v_booking.student_id <> any(array(select app.guardian_student_ids(v_booking.institution_id))) then
    raise exception 'code:not_found' using detail = 'booking not found';
  end if;

  if v_booking.status <> 'booked' then
    raise exception 'code:invalid_state' using detail = 'booking is not active';
  end if;

  select * into v_event from public.ptm_events where id = v_booking.event_id;
  if now() >= v_event.booking_closes_at then
    raise exception 'code:invalid_state' using detail = 'Booking is closed.';
  end if;

  update public.ptm_bookings
  set status = 'cancelled', cancelled_at = now(), cancelled_by = app.current_user_id()
  where id = p_booking_id;

  perform app.audit(
    v_booking.institution_id,
    app.current_user_id(),
    'ptm.booking.cancelled',
    'ptm_bookings',
    p_booking_id,
    jsonb_build_object('status', 'booked'),
    jsonb_build_object('status', 'cancelled'),
    null
  );

  return p_booking_id;
end;
$$;

revoke all on function app.cancel_ptm_booking(uuid) from public, anon, authenticated;

create function public.cancel_ptm_booking(p_booking_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.cancel_ptm_booking(p_booking_id);
end;
$$;

revoke execute on function public.cancel_ptm_booking(uuid) from public, anon;
grant execute on function public.cancel_ptm_booking(uuid) to authenticated;

-- ===========================================================================
-- X08-T3 (this part): surveys, survey_audiences, survey_respondents,
-- survey_responses + RLS + definers (header rulings, Survey tables /
-- Recipients / RLS / Helpers and definers / Guards blocks).
--
-- Status machine for surveys is a direct UPDATE (no publish RPC, same shape
-- as ptm_events above): the action moves draft->open/open->closed via
-- PostgREST and `app.guard_surveys_write` validates the transition, stamps
-- opened_at/closed_at, and rejects every other column change or transition.
-- No service_role/postgres bypass (lesson 5): the seed inserts survey rows
-- in their final, already-valid shape via service-role INSERT, which this
-- UPDATE-only trigger never fires for.
--
-- survey_respondents/survey_responses have no write RLS policy at all — the
-- only path in is `submit_survey_response` (app.* core + public.* thin
-- wrapper, same split as book_ptm_slot above), which runs SECURITY DEFINER
-- and so bypasses RLS for its own inserts.
-- ---------------------------------------------------------------------------

create table public.surveys (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  title text not null check (length(title) between 1 and 120),
  description text check (description is null or length(description) <= 1000),
  is_anonymous boolean not null default true,
  questions jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  closes_at timestamptz not null,
  opened_at timestamptz,
  closed_at timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index surveys_institution_status_idx on public.surveys (institution_id, status);

create trigger set_updated_at
before update on public.surveys
for each row execute function app.set_updated_at();

-- Validates the `questions` jsonb shape (header rulings: array of 1-10
-- objects `{type, prompt, options?}`; options required for single/multi,
-- absent for text) and the draft<->open<->closed transitions. Table-level
-- CHECK constraints cannot report `code:validation_failed` for an
-- arbitrarily-shaped jsonb column, so the shape is validated here instead
-- (same approach as 0071's submit_assignment answers validation).
create function app.guard_surveys_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_question jsonb;
  v_type text;
  v_prompt text;
  v_options jsonb;
  v_opt_count int;
  v_audience_count int;
begin
  if tg_op = 'INSERT' then
    if jsonb_typeof(new.questions) is distinct from 'array' then
      raise exception 'code:validation_failed' using detail = 'questions must be an array';
    end if;
    if jsonb_array_length(new.questions) < 1 or jsonb_array_length(new.questions) > 10 then
      raise exception 'code:validation_failed' using detail = 'questions must have between 1 and 10 entries';
    end if;

    for v_question in select elem from jsonb_array_elements(new.questions) as elem loop
      if jsonb_typeof(v_question) is distinct from 'object' then
        raise exception 'code:validation_failed' using detail = 'each question must be an object';
      end if;

      v_type := v_question ->> 'type';
      if v_type is null or v_type not in ('single', 'multi', 'text') then
        raise exception 'code:validation_failed' using detail = 'question type must be single, multi, or text';
      end if;

      v_prompt := v_question ->> 'prompt';
      if v_prompt is null or length(v_prompt) < 1 or length(v_prompt) > 200 then
        raise exception 'code:validation_failed' using detail = 'question prompt must be 1-200 characters';
      end if;

      v_options := v_question -> 'options';
      if v_type = 'text' then
        if v_options is not null then
          raise exception 'code:validation_failed' using detail = 'text questions must not have options';
        end if;
      else
        if v_options is null or jsonb_typeof(v_options) is distinct from 'array' then
          raise exception 'code:validation_failed' using detail = 'single/multi questions must have an options array';
        end if;
        v_opt_count := jsonb_array_length(v_options);
        if v_opt_count < 2 or v_opt_count > 6 then
          raise exception 'code:validation_failed' using detail = 'options must have between 2 and 6 entries';
        end if;
        if exists (
          select 1 from jsonb_array_elements(v_options) opt
          where jsonb_typeof(opt) is distinct from 'string' or length(opt #>> '{}') < 1 or length(opt #>> '{}') > 80
        ) then
          raise exception 'code:validation_failed' using detail = 'each option must be a string of 1-80 characters';
        end if;
        if (select count(distinct opt) from jsonb_array_elements(v_options) opt) <> v_opt_count then
          raise exception 'code:validation_failed' using detail = 'options must be distinct';
        end if;
      end if;
    end loop;

    return new;
  end if;

  -- tg_op = 'UPDATE': only status (and the opened_at/closed_at it stamps)
  -- may ever change; every other column is frozen post-insert.
  if new.title is distinct from old.title
    or new.description is distinct from old.description
    or new.is_anonymous is distinct from old.is_anonymous
    or new.questions is distinct from old.questions
    or new.closes_at is distinct from old.closes_at
    or new.institution_id is distinct from old.institution_id
    or new.created_by is distinct from old.created_by
  then
    raise exception 'code:invalid_state' using detail = 'only status, opened_at, and closed_at may change after a survey is created';
  end if;

  if old.status = 'draft' and new.status = 'open' then
    select count(*) into v_audience_count from public.survey_audiences where survey_id = new.id;
    if v_audience_count < 1 then
      raise exception 'code:invalid_state' using detail = 'survey needs at least one audience before it can open';
    end if;
    if new.closes_at <= now() then
      raise exception 'code:invalid_state' using detail = 'closes_at must be in the future to open';
    end if;
    new.opened_at := now();
    return new;
  end if;

  if old.status = 'open' and new.status = 'closed' then
    new.closed_at := now();
    return new;
  end if;

  raise exception 'code:invalid_state' using detail = 'surveys may only move from draft to open, or open to closed';
end;
$$;

create trigger guard_surveys_write
before insert or update on public.surveys
for each row execute function app.guard_surveys_write();

alter table public.surveys enable row level security;

create policy surveys_select on public.surveys
  for select to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy surveys_insert on public.surveys
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and created_by = app.current_user_id()
    and status = 'draft'
    and opened_at is null
    and closed_at is null
  );

create policy surveys_update on public.surveys
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy surveys_delete on public.surveys
  for delete to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']) and status = 'draft');

-- ---------------------------------------------------------------------------
-- survey_audiences — mirrors announcement_audiences (0068) exactly, except
-- `role` excludes 'student' (23514; DPDP Act 2023, header rulings).
-- ---------------------------------------------------------------------------

create table public.survey_audiences (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys (id),
  institution_id uuid not null references public.institutions (id),
  audience_type text not null check (audience_type in ('school', 'role', 'grade', 'section')),
  role text check (role in (
    'owner', 'principal', 'admin', 'admissions', 'accountant',
    'exam_controller', 'teacher', 'guardian'
  )),
  grade_id uuid references public.grades (id),
  class_section_id uuid references public.class_sections (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (audience_type = 'school' and role is null and grade_id is null and class_section_id is null)
    or (audience_type = 'role' and role is not null and grade_id is null and class_section_id is null)
    or (audience_type = 'grade' and grade_id is not null and role is null and class_section_id is null)
    or (audience_type = 'section' and class_section_id is not null and role is null and grade_id is null)
  )
);

create index survey_audiences_survey_idx on public.survey_audiences (survey_id);

create trigger set_updated_at
before update on public.survey_audiences
for each row execute function app.set_updated_at();

alter table public.survey_audiences enable row level security;

create policy survey_audiences_select on public.survey_audiences
  for select to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy survey_audiences_insert on public.survey_audiences
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and exists (
      select 1 from public.surveys s
      where s.id = survey_audiences.survey_id
        and s.institution_id = survey_audiences.institution_id
        and s.status = 'draft'
    )
    and (
      grade_id is null
      or exists (select 1 from public.grades g where g.id = survey_audiences.grade_id and g.institution_id = survey_audiences.institution_id)
    )
    and (
      class_section_id is null
      or exists (select 1 from public.class_sections cs where cs.id = survey_audiences.class_section_id and cs.institution_id = survey_audiences.institution_id)
    )
  );

create policy survey_audiences_update on public.survey_audiences
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and exists (
      select 1 from public.surveys s
      where s.id = survey_audiences.survey_id
        and s.institution_id = survey_audiences.institution_id
        and s.status = 'draft'
    )
    and (
      grade_id is null
      or exists (select 1 from public.grades g where g.id = survey_audiences.grade_id and g.institution_id = survey_audiences.institution_id)
    )
    and (
      class_section_id is null
      or exists (select 1 from public.class_sections cs where cs.id = survey_audiences.class_section_id and cs.institution_id = survey_audiences.institution_id)
    )
  );

-- ---------------------------------------------------------------------------
-- survey_respondents — PK (survey_id, user_id) = respond once. No write
-- policy: only app.submit_survey_response (SECURITY DEFINER) inserts.
-- ---------------------------------------------------------------------------

create table public.survey_respondents (
  survey_id uuid not null references public.surveys (id),
  institution_id uuid not null references public.institutions (id),
  user_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (survey_id, user_id)
);

create trigger set_updated_at
before update on public.survey_respondents
for each row execute function app.set_updated_at();

alter table public.survey_respondents enable row level security;

create policy survey_respondents_select on public.survey_respondents
  for select to authenticated
  using (user_id = app.current_user_id());

-- ---------------------------------------------------------------------------
-- survey_responses — respondent_user_id is null unless the survey is not
-- anonymous (header rulings). No write policy: only
-- app.submit_survey_response (SECURITY DEFINER) inserts.
-- ---------------------------------------------------------------------------

create table public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  survey_id uuid not null references public.surveys (id),
  respondent_user_id uuid references public.profiles (id),
  answers jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index survey_responses_survey_idx on public.survey_responses (survey_id);

create trigger set_updated_at
before update on public.survey_responses
for each row execute function app.set_updated_at();

alter table public.survey_responses enable row level security;

-- Owner/principal/admin, and only non-anonymous rows (respondent_user_id is
-- not null) — an anonymous survey's responses are never selectable over
-- PostgREST at all, even by its own institution's admins; they read
-- aggregates via public.survey_results instead.
create policy survey_responses_select on public.survey_responses
  for select to authenticated
  using (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and respondent_user_id is not null
  );

-- ---------------------------------------------------------------------------
-- app.is_survey_recipient — internal only (no authenticated grant, same
-- shape as app.section_teacher_ids above). An active, non-student
-- membership in the survey's institution, matching any of its audiences:
-- `school` = every such member; `role` = that role; `grade`/`section` =
-- guardians (via guardian_students) of a student with an active enrolment
-- in that grade's sections / that section (header rulings: Recipients).
-- Mirrors notify.announcement.ts's recipient resolution, in SQL, minus the
-- student branch (parent surveys only).
-- ---------------------------------------------------------------------------

create function app.is_survey_recipient(p_survey_id uuid, p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_role text;
  v_guardian_id uuid;
begin
  select s.institution_id into v_institution_id from public.surveys s where s.id = p_survey_id;
  if v_institution_id is null then
    return false;
  end if;

  select m.role, m.guardian_id into v_role, v_guardian_id
  from public.memberships m
  where m.institution_id = v_institution_id and m.user_id = p_user_id and m.status = 'active'
  limit 1;

  if v_role is null or v_role = 'student' then
    return false;
  end if;

  return exists (
    select 1 from public.survey_audiences sa
    where sa.survey_id = p_survey_id
      and (
        sa.audience_type = 'school'
        or (sa.audience_type = 'role' and sa.role = v_role)
        or (
          sa.audience_type in ('grade', 'section')
          and v_guardian_id is not null
          and exists (
            select 1
            from public.guardian_students gs
            join public.enrolments e on e.student_id = gs.student_id and e.status = 'active'
            join public.class_sections cs on cs.id = e.class_section_id
            where gs.guardian_id = v_guardian_id
              and gs.institution_id = v_institution_id
              and (
                (sa.audience_type = 'grade' and cs.grade_id = sa.grade_id)
                or (sa.audience_type = 'section' and cs.id = sa.class_section_id)
              )
          )
        )
      )
  );
end;
$$;

revoke all on function app.is_survey_recipient(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.my_open_surveys / public.my_open_surveys
-- ---------------------------------------------------------------------------

create function app.my_open_surveys(p_institution_id uuid)
returns table (
  id uuid,
  title text,
  description text,
  is_anonymous boolean,
  closes_at timestamptz,
  questions jsonb,
  responded boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := app.current_user_id();
begin
  if v_user_id is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  return query
    select
      s.id,
      s.title,
      s.description,
      s.is_anonymous,
      s.closes_at,
      s.questions,
      exists (select 1 from public.survey_respondents r where r.survey_id = s.id and r.user_id = v_user_id)
    from public.surveys s
    where s.institution_id = p_institution_id
      and s.status = 'open'
      and s.closes_at > now()
      and app.is_survey_recipient(s.id, v_user_id)
    order by s.closes_at;
end;
$$;

revoke all on function app.my_open_surveys(uuid) from public, anon, authenticated;

create function public.my_open_surveys(p_institution_id uuid)
returns table (
  id uuid,
  title text,
  description text,
  is_anonymous boolean,
  closes_at timestamptz,
  questions jsonb,
  responded boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query select * from app.my_open_surveys(p_institution_id);
end;
$$;

revoke execute on function public.my_open_surveys(uuid) from public, anon;
grant execute on function public.my_open_surveys(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- app.submit_survey_response / public.submit_survey_response
-- ---------------------------------------------------------------------------

create function app.submit_survey_response(p_survey_id uuid, p_answers jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_survey public.surveys;
  v_user_id uuid := app.current_user_id();
  v_idx int;
  v_question jsonb;
  v_answer jsonb;
  v_type text;
  v_opt_count int;
  v_respondent_user_id uuid;
  v_stamp timestamptz;
begin
  if v_user_id is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_survey from public.surveys where id = p_survey_id;
  -- Not a recipient (including "survey does not exist") -> not_found, with
  -- no distinction between the two, so existence is never leaked.
  if v_survey.id is null or not app.is_survey_recipient(p_survey_id, v_user_id) then
    raise exception 'code:not_found' using detail = 'survey not found';
  end if;

  if v_survey.status <> 'open' or v_survey.closes_at <= now() then
    raise exception 'code:invalid_state' using detail = 'survey is not open for responses';
  end if;

  if jsonb_typeof(p_answers) is distinct from 'array' or jsonb_array_length(p_answers) <> jsonb_array_length(v_survey.questions) then
    raise exception 'code:validation_failed' using detail = 'answers must align one-for-one with the survey questions';
  end if;

  for v_idx in 0 .. jsonb_array_length(v_survey.questions) - 1 loop
    v_question := v_survey.questions -> v_idx;
    v_answer := p_answers -> v_idx;
    v_type := v_question ->> 'type';

    if v_type = 'text' then
      if jsonb_typeof(v_answer) is distinct from 'string' or length(v_answer #>> '{}') > 500 then
        raise exception 'code:validation_failed' using detail = format('question %s expects a string of at most 500 characters', v_idx);
      end if;
    elsif v_type = 'single' then
      v_opt_count := jsonb_array_length(v_question -> 'options');
      if jsonb_typeof(v_answer) is distinct from 'number'
        or (v_answer #>> '{}')::int < 0
        or (v_answer #>> '{}')::int >= v_opt_count
      then
        raise exception 'code:validation_failed' using detail = format('question %s expects a valid option index', v_idx);
      end if;
    else -- multi
      v_opt_count := jsonb_array_length(v_question -> 'options');
      if jsonb_typeof(v_answer) is distinct from 'array' or jsonb_array_length(v_answer) < 1 then
        raise exception 'code:validation_failed' using detail = format('question %s expects at least one option index', v_idx);
      end if;
      if exists (
        select 1 from jsonb_array_elements(v_answer) e
        where jsonb_typeof(e) is distinct from 'number' or (e #>> '{}')::int < 0 or (e #>> '{}')::int >= v_opt_count
      ) then
        raise exception 'code:validation_failed' using detail = format('question %s has an out-of-range option index', v_idx);
      end if;
      if (select count(distinct e) from jsonb_array_elements(v_answer) e) <> jsonb_array_length(v_answer) then
        raise exception 'code:validation_failed' using detail = format('question %s has duplicate option indexes', v_idx);
      end if;
    end if;
  end loop;

  begin
    insert into public.survey_respondents (survey_id, institution_id, user_id)
    values (p_survey_id, v_survey.institution_id, v_user_id);
  exception
    when unique_violation then
      raise exception 'code:conflict' using detail = 'You have already responded.';
  end;

  if v_survey.is_anonymous then
    v_respondent_user_id := null;
    -- No per-second timing to correlate with who was active when (header
    -- rulings: Recipients/India specifics) — anonymous rows stamp midnight.
    v_stamp := date_trunc('day', now());
  else
    v_respondent_user_id := v_user_id;
    v_stamp := now();
  end if;

  insert into public.survey_responses (institution_id, survey_id, respondent_user_id, answers, created_at, updated_at)
  values (v_survey.institution_id, p_survey_id, v_respondent_user_id, p_answers, v_stamp, v_stamp);

  -- No audit row here (header rulings): an audit entry would itself record
  -- who responded, defeating anonymity.
end;
$$;

revoke all on function app.submit_survey_response(uuid, jsonb) from public, anon, authenticated;

create function public.submit_survey_response(p_survey_id uuid, p_answers jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.submit_survey_response(p_survey_id, p_answers);
end;
$$;

revoke execute on function public.submit_survey_response(uuid, jsonb) from public, anon;
grant execute on function public.submit_survey_response(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- app.survey_results / public.survey_results
-- ---------------------------------------------------------------------------

create function app.survey_results(p_survey_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_survey public.surveys;
  v_response_count int;
  v_suppressed boolean;
  v_questions jsonb := '[]'::jsonb;
  v_responses jsonb;
  v_idx int;
  v_question jsonb;
  v_type text;
  v_options jsonb;
  v_opt_count int;
  v_opt_idx int;
  v_opt_results jsonb;
  v_texts jsonb;
  v_count int;
  v_result jsonb;
begin
  select * into v_survey from public.surveys where id = p_survey_id;
  if v_survey.id is null then
    raise exception 'code:not_found' using detail = 'survey not found';
  end if;

  if not app.has_role(v_survey.institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold survey.manage for this institution';
  end if;

  select count(*) into v_response_count from public.survey_responses where survey_id = p_survey_id;
  v_suppressed := v_survey.is_anonymous and v_response_count < 3;

  if not v_suppressed then
    for v_idx in 0 .. jsonb_array_length(v_survey.questions) - 1 loop
      v_question := v_survey.questions -> v_idx;
      v_type := v_question ->> 'type';

      if v_type = 'text' then
        select coalesce(jsonb_agg(t order by t), '[]'::jsonb) into v_texts
        from (
          select (r.answers -> v_idx) #>> '{}' as t
          from public.survey_responses r
          where r.survey_id = p_survey_id
            and (r.answers -> v_idx) #>> '{}' is not null
            and (r.answers -> v_idx) #>> '{}' <> ''
          order by (r.answers -> v_idx) #>> '{}'
          limit 200
        ) texts;

        v_result := jsonb_build_object('index', v_idx, 'type', v_type, 'prompt', v_question ->> 'prompt', 'texts', v_texts);
      else
        v_options := v_question -> 'options';
        v_opt_count := jsonb_array_length(v_options);
        v_opt_results := '[]'::jsonb;

        for v_opt_idx in 0 .. v_opt_count - 1 loop
          if v_type = 'single' then
            select count(*) into v_count
            from public.survey_responses r
            where r.survey_id = p_survey_id and ((r.answers -> v_idx) #>> '{}')::int = v_opt_idx;
          else
            select count(*) into v_count
            from public.survey_responses r
            where r.survey_id = p_survey_id
              and exists (
                select 1 from jsonb_array_elements(r.answers -> v_idx) e
                where (e #>> '{}')::int = v_opt_idx
              );
          end if;
          v_opt_results := v_opt_results || jsonb_build_array(
            jsonb_build_object('label', (v_options -> v_opt_idx) #>> '{}', 'count', v_count)
          );
        end loop;

        v_result := jsonb_build_object('index', v_idx, 'type', v_type, 'prompt', v_question ->> 'prompt', 'options', v_opt_results);
      end if;

      v_questions := v_questions || jsonb_build_array(v_result);
    end loop;
  end if;

  v_result := jsonb_build_object(
    'surveyId', p_survey_id,
    'isAnonymous', v_survey.is_anonymous,
    'responseCount', v_response_count,
    'suppressed', v_suppressed,
    'questions', v_questions
  );

  if not v_survey.is_anonymous then
    select coalesce(jsonb_agg(jsonb_build_object('respondentName', p.full_name, 'answers', r.answers) order by p.full_name), '[]'::jsonb)
    into v_responses
    from public.survey_responses r
    join public.profiles p on p.id = r.respondent_user_id
    where r.survey_id = p_survey_id;

    v_result := v_result || jsonb_build_object('responses', v_responses);
  end if;

  return v_result;
end;
$$;

revoke all on function app.survey_results(uuid) from public, anon, authenticated;

create function public.survey_results(p_survey_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.survey_results(p_survey_id);
end;
$$;

revoke execute on function public.survey_results(uuid) from public, anon;
grant execute on function public.survey_results(uuid) to authenticated;
