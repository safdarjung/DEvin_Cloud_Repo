-- 0105 — fix the guardian guard in 0099's PTM definers (X08).
-- `p_student_id <> any(array(...))` is true when the student differs from ANY
-- of the caller's children: a guardian with two children was refused for each
-- of them, and a guardian with no linked child (empty array → false) passed
-- the guard for any student of the institution. The intended test is
-- "not one of my children": `not (x = any(...))`. Bodies are otherwise
-- unchanged; create or replace keeps 0099's grants.

create or replace function app.ptm_slots_for_student(p_student_id uuid, p_event_id uuid default null)
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
  if v_institution_id is null or not (p_student_id = any(array(select app.guardian_student_ids(v_institution_id)))) then
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

create or replace function app.book_ptm_slot(p_slot_id uuid, p_student_id uuid)
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

  if not (p_student_id = any(array(select app.guardian_student_ids(v_event.institution_id)))) then
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

create or replace function app.cancel_ptm_booking(p_booking_id uuid)
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
  if v_booking.id is null or not (v_booking.student_id = any(array(select app.guardian_student_ids(v_booking.institution_id)))) then
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
