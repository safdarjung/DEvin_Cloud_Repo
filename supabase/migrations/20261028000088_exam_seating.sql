-- X06-T2/T3: exam seating plans + admit cards (X06-tasks.md rulings).
-- Part A (T2): tables, RLS, grants, app.module_catalog insert. Part B (T3,
-- appended later in this same not-yet-merged file): app.generate_seating_plan.
--
-- Writes only through the T3 definer: no INSERT/UPDATE/DELETE policy on
-- either table (history immutable by grant, no guard trigger needed).
-- Grants follow the 0045 explicit-API-grants pattern: select to
-- authenticated, full CRUD to service_role, nothing to anon.

create table public.exam_seating_plans (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  exam_id uuid not null references public.exams (id),
  slot_start timestamptz not null,
  version_no int not null check (version_no >= 1),
  exam_name text not null check (length(exam_name) between 1 and 200),
  rooms jsonb not null check (jsonb_typeof(rooms) = 'array'),
  section_ids uuid[] not null,
  seat_count int not null check (seat_count >= 0),
  -- deferrable initially deferred: T3's app.generate_seating_plan sets the
  -- old row's superseded_by and inserts the new current row in one
  -- transaction (0009 marks/results superseded_by pattern).
  superseded_by uuid references public.exam_seating_plans (id) deferrable initially deferred,
  generated_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exam_id, slot_start, version_no)
);

create unique index exam_seating_plans_current_idx
  on public.exam_seating_plans (exam_id, slot_start)
  where superseded_by is null;

create trigger set_updated_at
before update on public.exam_seating_plans
for each row execute function app.set_updated_at();

alter table public.exam_seating_plans enable row level security;

-- owner/principal/admin/exam_controller: every version. guardian/student:
-- current headers only — a header holds no student data, so no further
-- per-student scoping is needed here (that lives on exam_seats below).
create policy exam_seating_plans_select on public.exam_seating_plans
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'exam_controller'])))
    or (
      superseded_by is null
      and institution_id = any((select app.my_institution_ids(array['guardian', 'student'])))
    )
  );

grant select on table public.exam_seating_plans to authenticated;
grant select, insert, update, delete on table public.exam_seating_plans to service_role;

create table public.exam_seats (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  plan_id uuid not null references public.exam_seating_plans (id),
  student_id uuid not null references public.students (id),
  class_section_id uuid not null references public.class_sections (id),
  room_id uuid not null references public.rooms (id),
  seat_no int not null check (seat_no between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, student_id),
  unique (plan_id, room_id, seat_no)
);

create index exam_seats_student_id_idx on public.exam_seats (student_id);

create trigger set_updated_at
before update on public.exam_seats
for each row execute function app.set_updated_at();

alter table public.exam_seats enable row level security;

-- Same staff set as the plans policy, every row. guardian/student: own
-- seat only, and only in a plan version that is still current — a
-- superseded plan's seats never reach them even if the student_id matches
-- (lesson 6: versioned data stays scoped to the current row).
create policy exam_seats_select on public.exam_seats
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'exam_controller'])))
    or (
      student_id = any((select app.my_student_ids()))
      and plan_id in (select p.id from public.exam_seating_plans p where p.superseded_by is null)
    )
  );

grant select on table public.exam_seats to authenticated;
grant select, insert, update, delete on table public.exam_seats to service_role;

insert into app.module_catalog (key, default_enabled) values ('exam_seating', false)
on conflict (key) do update set default_enabled = excluded.default_enabled;

-- ---------------------------------------------------------------------------
-- Part B (T3): app.generate_seating_plan + public wrapper (X06-tasks.md
-- "Generator"/"Interleaving" rulings). Not module-checked (MOD: not a
-- security boundary — the module gate lives in the TS action, T5).
--
-- Slot students = active enrolments in a section that has an exam_papers
-- row of this exam at exactly p_slot_start (distinct, so two papers of one
-- section at the same start — electives — still seat the student once).
--
-- Interleaving: k = a section's dense_rank by name within its grade (so
-- same-named sections across grades share k, e.g. every "A" section is
-- k=0); r = a student's row_number within their section by roll_no (nulls
-- last) then admission_no. Seat order = (r, k, grade sort_key) ascending —
-- same inputs always produce the same order, hence the same seats.
--
-- Rooms fill in p_rooms array order: cumulative seats per room (missing
-- `seats` = room capacity) partitions the 1..N seat ranks; seat_no is the
-- rank minus the previous rooms' cumulative seats.
--
-- Same split/shape as 0069's publish_timetable (app.* core + public.* thin
-- wrapper) with 0044's service_role-claim bypass (lesson 5): a service_role
-- caller skips the exam_write_roles() check and gets generated_by = null.
-- ---------------------------------------------------------------------------

create function app.generate_seating_plan(
  p_institution_id uuid,
  p_exam_id uuid,
  p_slot_start timestamptz,
  p_rooms jsonb
)
returns public.exam_seating_plans
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_service boolean;
  v_exam public.exams;
  v_room_count int;
  v_distinct_room_count int;
  v_student_count int;
  v_seat_total int;
  v_old_plan_id uuid;
  v_version_no int;
  v_new_id uuid := gen_random_uuid();
  v_resolved_rooms jsonb;
  v_section_ids uuid[];
  v_plan public.exam_seating_plans;
begin
  v_is_service := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role';

  if not v_is_service and app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_exam from public.exams where id = p_exam_id and institution_id = p_institution_id for update;
  if v_exam.id is null then
    raise exception 'code:not_found' using detail = 'exam not found';
  end if;

  if not v_is_service and not app.has_role(p_institution_id, app.exam_write_roles()) then
    raise exception 'code:forbidden' using detail = 'caller does not hold exam.manage for this institution';
  end if;

  if v_exam.status = 'published' then
    raise exception 'code:invalid_state' using detail = 'exam is published; seating is closed';
  end if;

  if now() >= p_slot_start then
    raise exception 'code:invalid_state' using detail = 'slot already started';
  end if;

  if not exists (select 1 from public.exam_papers p where p.exam_id = p_exam_id and p.scheduled_at = p_slot_start) then
    raise exception 'code:not_found' using detail = 'no paper scheduled at this slot';
  end if;

  if p_rooms is null or jsonb_typeof(p_rooms) <> 'array' then
    raise exception 'code:validation_failed' using detail = 'rooms must be a non-empty array';
  end if;

  v_room_count := jsonb_array_length(p_rooms);
  if v_room_count < 1 or v_room_count > 50 then
    raise exception 'code:validation_failed' using detail = 'rooms must have between 1 and 50 entries';
  end if;

  -- Review finding (LOW, X06): validate room_id/seats shape before any cast
  -- below — a malformed uuid or non-numeric seats must raise a clean
  -- validation_failed, not an unhandled Postgres cast error.
  if exists (
    select 1
    from jsonb_array_elements(p_rooms) elem
    where elem ->> 'room_id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or (elem ->> 'seats' is not null and elem ->> 'seats' !~ '^[0-9]+$')
  ) then
    raise exception 'code:validation_failed' using detail = 'room_id must be a uuid and seats must be a non-negative integer';
  end if;

  select count(distinct elem ->> 'room_id') into v_distinct_room_count from jsonb_array_elements(p_rooms) elem;
  if v_distinct_room_count <> v_room_count then
    raise exception 'code:validation_failed' using detail = 'duplicate room_id in rooms';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rooms) elem
    left join public.rooms r on r.id = (elem ->> 'room_id')::uuid and r.institution_id = p_institution_id
    where r.id is null
  ) then
    raise exception 'code:validation_failed' using detail = 'room not found in this institution';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rooms) elem
    join public.rooms r on r.id = (elem ->> 'room_id')::uuid and r.institution_id = p_institution_id
    where (elem ->> 'seats') is not null
      and ((elem ->> 'seats')::int < 1 or (elem ->> 'seats')::int > r.capacity)
  ) then
    raise exception 'code:validation_failed' using detail = 'seats out of range for room capacity';
  end if;

  select jsonb_agg(jsonb_build_object('room_id', resolved.room_id, 'seats', resolved.seats) order by resolved.ord), sum(resolved.seats)
  into v_resolved_rooms, v_seat_total
  from (
    select t.ord, (t.elem ->> 'room_id')::uuid as room_id, coalesce((t.elem ->> 'seats')::int, r.capacity) as seats
    from jsonb_array_elements(p_rooms) with ordinality as t(elem, ord)
    join public.rooms r on r.id = (t.elem ->> 'room_id')::uuid and r.institution_id = p_institution_id
  ) resolved;

  select count(*) into v_student_count
  from (
    select distinct e.student_id
    from public.enrolments e
    join public.exam_papers p on p.class_section_id = e.class_section_id and p.exam_id = p_exam_id and p.scheduled_at = p_slot_start
    join public.students s on s.id = e.student_id
    where e.status = 'active' and s.status = 'active'
  ) slot_students;

  if v_student_count = 0 then
    raise exception 'code:invalid_state' using detail = 'no active students to seat for this slot';
  end if;

  if v_student_count > v_seat_total then
    raise exception 'code:conflict' using detail = format('need %s seats, have %s', v_student_count, v_seat_total);
  end if;

  select array_agg(distinct p.class_section_id order by p.class_section_id) into v_section_ids
  from public.exam_papers p
  where p.exam_id = p_exam_id and p.scheduled_at = p_slot_start;

  select id, version_no into v_old_plan_id, v_version_no
  from public.exam_seating_plans
  where exam_id = p_exam_id and slot_start = p_slot_start and superseded_by is null
  for update;

  v_version_no := coalesce(v_version_no, 0) + 1;

  if v_old_plan_id is not null then
    update public.exam_seating_plans set superseded_by = v_new_id where id = v_old_plan_id;
  end if;

  insert into public.exam_seating_plans (
    id, institution_id, exam_id, slot_start, version_no, exam_name, rooms, section_ids, seat_count, generated_by
  ) values (
    v_new_id, p_institution_id, p_exam_id, p_slot_start, v_version_no, v_exam.name, v_resolved_rooms, v_section_ids, v_student_count,
    case when v_is_service then null else app.current_user_id() end
  )
  returning * into v_plan;

  insert into public.exam_seats (institution_id, plan_id, student_id, class_section_id, room_id, seat_no)
  with slot_sections as (
    select distinct p.class_section_id
    from public.exam_papers p
    where p.exam_id = p_exam_id and p.scheduled_at = p_slot_start
  ),
  slot_students as (
    select e.student_id, e.class_section_id, e.roll_no, s.admission_no, cs.grade_id, cs.name as section_name, g.sort_key as grade_sort_key
    from public.enrolments e
    join slot_sections ss on ss.class_section_id = e.class_section_id
    join public.class_sections cs on cs.id = e.class_section_id
    join public.grades g on g.id = cs.grade_id
    join public.students s on s.id = e.student_id
    where e.status = 'active' and s.status = 'active'
  ),
  section_rank as (
    select class_section_id, dense_rank() over (partition by grade_id order by section_name) as k
    from (select distinct class_section_id, grade_id, section_name from slot_students) section_info
  ),
  student_rank as (
    select student_id, class_section_id,
      row_number() over (partition by class_section_id order by roll_no nulls last, admission_no) as r
    from slot_students
  ),
  seated as (
    select
      ss.student_id,
      ss.class_section_id,
      row_number() over (order by st.r, sr.k, ss.grade_sort_key, ss.student_id) as seat_rank
    from slot_students ss
    join section_rank sr on sr.class_section_id = ss.class_section_id
    join student_rank st on st.student_id = ss.student_id and st.class_section_id = ss.class_section_id
  ),
  room_cum as (
    select
      (elem ->> 'room_id')::uuid as room_id,
      sum((elem ->> 'seats')::int) over (order by ord) as cum_end,
      sum((elem ->> 'seats')::int) over (order by ord) - (elem ->> 'seats')::int as cum_start
    from jsonb_array_elements(v_resolved_rooms) with ordinality as t(elem, ord)
  )
  select p_institution_id, v_new_id, seated.student_id, seated.class_section_id, rc.room_id, seated.seat_rank - rc.cum_start
  from seated
  join room_cum rc on seated.seat_rank > rc.cum_start and seated.seat_rank <= rc.cum_end;

  perform app.audit(
    p_institution_id,
    app.current_user_id(),
    'exam.seating.generated',
    'exam_seating_plans',
    v_new_id,
    null,
    null,
    jsonb_build_object(
      'plan_id', v_new_id,
      'exam_id', p_exam_id,
      'slot_start', p_slot_start,
      'version_no', v_version_no,
      'seat_count', v_student_count
    )
  );

  return v_plan;
exception
  when unique_violation then
    raise exception 'code:conflict' using detail = 'seating plan changed concurrently; retry';
end;
$$;

revoke execute on function app.generate_seating_plan(uuid, uuid, timestamptz, jsonb) from public, anon, authenticated;

create function public.generate_seating_plan(
  p_institution_id uuid,
  p_exam_id uuid,
  p_slot_start timestamptz,
  p_rooms jsonb
)
returns public.exam_seating_plans
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.generate_seating_plan(p_institution_id, p_exam_id, p_slot_start, p_rooms);
end;
$$;

revoke execute on function public.generate_seating_plan(uuid, uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.generate_seating_plan(uuid, uuid, timestamptz, jsonb) to authenticated, service_role;
