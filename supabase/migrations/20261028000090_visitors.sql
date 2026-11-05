-- X07-T2: visitor_entries, pickup_persons, gate_passes (X07-tasks.md
-- rulings). New owning module `visitors` (default off). Mirrors
-- 0075 (operations) for RLS/FK-binding/guard shape, 0035/0020 for the
-- initPlan `app.my_*` setof-uuid helpers, 0014 for `app.enqueue_job`.
--
-- `app.module_enabled` / `app.module_catalog` are defined once in 0084
-- (MOD) and never redefined here — this migration only inserts its own
-- catalog row, per 0084's own comment.

insert into app.module_catalog (key, default_enabled) values ('visitors', false)
on conflict (key) do update set default_enabled = excluded.default_enabled;

-- ---------------------------------------------------------------------------
-- app.my_class_teacher_student_ids — students with an active enrolment in a
-- section the caller is the class teacher of (app.my_class_teacher_section_ids,
-- 0026). Institution-joined on every leg (lesson 2 / T-042 fix shape, same
-- as app.my_taught_student_ids, 0035). X07 (0090) owns this helper; M20
-- (0093) reuses it and must never redefine it.
-- ---------------------------------------------------------------------------

create function app.my_class_teacher_student_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct e.student_id
  from public.enrolments e
  join public.class_sections cs
    on cs.id = e.class_section_id
   and cs.institution_id = e.institution_id
  join public.students st
    on st.id = e.student_id
   and st.institution_id = e.institution_id
  where e.status = 'active'
    and e.class_section_id = any(array(select app.my_class_teacher_section_ids()));
$$;

revoke execute on function app.my_class_teacher_student_ids() from public;
grant execute on function app.my_class_teacher_student_ids() to authenticated;
comment on function app.my_class_teacher_student_ids() is
  'RLS perf helper (P-01): student ids of sections where the caller is the class teacher. Owned by X07 (0090); reused, never redefined, by M20 (0093).';

-- ---------------------------------------------------------------------------
-- app.my_guardian_student_ids — the guardian branch of app.my_student_ids
-- (0020) only, so a student user never gets write scope through it (rulings:
-- "the guardian branch ... only").
-- ---------------------------------------------------------------------------

create function app.my_guardian_student_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select gs.student_id
  from public.memberships m
  join public.guardian_students gs
    on gs.guardian_id = m.guardian_id
   and gs.institution_id = m.institution_id
  where m.user_id = app.current_user_id()
    and m.status = 'active'
    and m.guardian_id is not null;
$$;

revoke execute on function app.my_guardian_student_ids() from public;
grant execute on function app.my_guardian_student_ids() to authenticated;
comment on function app.my_guardian_student_ids() is
  'RLS perf helper (P-01): student ids the caller may see/write as guardian (linked children). Unlike app.my_student_ids, excludes the student-self branch.';

-- ---------------------------------------------------------------------------
-- visitor_entries — front-desk visitor log. No full ID number column
-- anywhere (DPDP: type + last 4 only).
-- ---------------------------------------------------------------------------

create table public.visitor_entries (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  full_name text not null check (length(full_name) between 1 and 80),
  phone text not null check (phone ~ '^[6-9][0-9]{9}$'),
  purpose text not null check (length(purpose) between 1 and 120),
  host_staff_id uuid references public.staff (id),
  meeting_with text check (length(meeting_with) between 1 and 80),
  id_type text check (id_type in ('aadhaar', 'driving_licence', 'voter_id', 'pan', 'passport', 'other')),
  id_last4 text check (id_last4 ~ '^[0-9A-Z]{4}$'),
  checked_in_at timestamptz not null default now(),
  checked_in_by uuid not null references public.profiles (id),
  checked_out_at timestamptz,
  checked_out_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visitor_entries_host_or_meeting check (host_staff_id is not null or meeting_with is not null),
  constraint visitor_entries_id_pair check ((id_type is null) = (id_last4 is null)),
  constraint visitor_entries_checkout_after_checkin check (checked_out_at is null or checked_out_at >= checked_in_at)
);

create index visitor_entries_institution_checked_in_idx on public.visitor_entries (institution_id, checked_in_at desc);

create trigger set_updated_at
before update on public.visitor_entries
for each row execute function app.set_updated_at();

-- Invoker guard (lesson 3: direct PostgREST writes obey the same rules).
-- INSERT: for a real end-user JWT, checked_in_at/checked_in_by/
-- checked_out_* are always server-set, never trusted from the client
-- (test: "backdated checked_in_at overwritten", "checked_in_by forced to
-- caller"); the service-role/postgres bypass (lesson 5) lets seed/
-- demo-reset insert backdated, already-checked-out historical rows
-- directly. UPDATE: the only legal move is a fresh check-out; anything
-- else (already out, any other column touched) is code:invalid_state.
create function app.guard_visitor_entries()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_is_trusted boolean;
begin
  if tg_op = 'INSERT' then
    v_is_trusted := (
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' = 'service_role'
      or session_user = 'postgres'
    );
    if not v_is_trusted then
      new.checked_in_at := now();
      new.checked_in_by := app.current_user_id();
      new.checked_out_at := null;
      new.checked_out_by := null;
    end if;
    return new;
  end if;

  if old.checked_out_at is not null then
    raise exception 'code:invalid_state' using detail = 'visitor already checked out';
  end if;

  if new.institution_id is distinct from old.institution_id
    or new.full_name is distinct from old.full_name
    or new.phone is distinct from old.phone
    or new.purpose is distinct from old.purpose
    or new.host_staff_id is distinct from old.host_staff_id
    or new.meeting_with is distinct from old.meeting_with
    or new.id_type is distinct from old.id_type
    or new.id_last4 is distinct from old.id_last4
    or new.checked_in_at is distinct from old.checked_in_at
    or new.checked_in_by is distinct from old.checked_in_by
  then
    raise exception 'code:invalid_state' using detail = 'only a check-out may be recorded on a visitor entry';
  end if;

  new.checked_out_at := now();
  new.checked_out_by := app.current_user_id();
  return new;
end;
$$;

create trigger guard_visitor_entries
before insert or update on public.visitor_entries
for each row execute function app.guard_visitor_entries();

alter table public.visitor_entries enable row level security;

create policy visitor_entries_select on public.visitor_entries
  for select to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

create policy visitor_entries_insert on public.visitor_entries
  for insert to authenticated
  with check (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    and checked_in_by = (select app.current_user_id())
    and checked_out_at is null
    and checked_out_by is null
    and (
      host_staff_id is null
      or exists (select 1 from public.staff s where s.id = visitor_entries.host_staff_id and s.institution_id = visitor_entries.institution_id)
    )
  );

create policy visitor_entries_update on public.visitor_entries
  for update to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))))
  with check (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

-- Retention purge only (DPDP, 180 days from check-in) — no other delete.
create policy visitor_entries_delete on public.visitor_entries
  for delete to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    and checked_in_at < now() - interval '180 days'
  );

-- ---------------------------------------------------------------------------
-- pickup_persons — guardian-maintained list of people authorised to collect
-- a student. No update (remove + add); no photo.
-- ---------------------------------------------------------------------------

create table public.pickup_persons (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  student_id uuid not null references public.students (id),
  full_name text not null check (length(full_name) between 1 and 80),
  relation text not null check (relation in ('father', 'mother', 'grandparent', 'uncle', 'aunt', 'sibling', 'driver', 'other')),
  phone text not null check (phone ~ '^[6-9][0-9]{9}$'),
  created_by uuid not null references public.profiles (id) default app.current_user_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pickup_persons_student_phone_key unique (student_id, phone)
);

create trigger set_updated_at
before update on public.pickup_persons
for each row execute function app.set_updated_at();

alter table public.pickup_persons enable row level security;

create policy pickup_persons_select on public.pickup_persons
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or student_id = any((select app.my_class_teacher_student_ids()))
    or student_id = any((select app.my_guardian_student_ids()))
  );

create policy pickup_persons_insert on public.pickup_persons
  for insert to authenticated
  with check (
    (
      institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
      or student_id = any((select app.my_guardian_student_ids()))
    )
    and created_by = (select app.current_user_id())
    and exists (select 1 from public.students s where s.id = pickup_persons.student_id and s.institution_id = pickup_persons.institution_id)
  );

-- No UPDATE policy (rulings).
create policy pickup_persons_delete on public.pickup_persons
  for delete to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or student_id = any((select app.my_guardian_student_ids()))
  );

-- ---------------------------------------------------------------------------
-- gate_passes — student early-leave gate pass. No delete; no phone stored
-- (collector_name/collector_relation are snapshots, server-filled).
-- ---------------------------------------------------------------------------

create table public.gate_passes (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  student_id uuid not null references public.students (id),
  reason text not null check (length(reason) between 1 and 200),
  guardian_id uuid references public.guardians (id),
  pickup_person_id uuid references public.pickup_persons (id) on delete set null,
  collector_name text not null check (length(collector_name) between 1 and 80),
  collector_relation text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled', 'exited')),
  requested_by uuid not null references public.profiles (id),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  exited_at timestamptz,
  exit_marked_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Partial unique: at most one open (pending/approved) pass per student.
create unique index gate_passes_one_open_key on public.gate_passes (student_id) where status in ('pending', 'approved');
create index gate_passes_institution_requested_idx on public.gate_passes (institution_id, requested_at desc);

create trigger set_updated_at
before update on public.gate_passes
for each row execute function app.set_updated_at();

-- Definer (DBT-45 shape): reads guardian_students/guardians/pickup_persons
-- without RLS recursion to validate the collector and snapshot their
-- name/relation server-side. Non-trusted writers (an actual end-user JWT)
-- additionally get status/requested_*/decided_*/exited_* forced, so a
-- client can never submit anything but a fresh pending request; the
-- service-role/postgres bypass (lesson 5) lets seed/demo-reset insert
-- already-decided or already-exited rows directly.
create function app.gate_pass_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_trusted boolean;
  v_guardian_name text;
  v_guardian_relationship text;
  v_pickup_name text;
  v_pickup_relation text;
begin
  v_is_trusted := (
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' = 'service_role'
    or session_user = 'postgres'
  );

  if (new.guardian_id is not null) = (new.pickup_person_id is not null) then
    raise exception 'code:validation_failed' using detail = 'exactly one of guardian_id or pickup_person_id is required';
  end if;

  if new.guardian_id is not null then
    select g.full_name, gs.relationship into v_guardian_name, v_guardian_relationship
    from public.guardian_students gs
    join public.guardians g on g.id = gs.guardian_id
    where gs.guardian_id = new.guardian_id
      and gs.student_id = new.student_id
      and gs.institution_id = new.institution_id;

    if v_guardian_name is null then
      raise exception 'code:validation_failed' using detail = 'collector is not authorised for this student';
    end if;

    new.collector_name := v_guardian_name;
    new.collector_relation := v_guardian_relationship;
  else
    select p.full_name, p.relation into v_pickup_name, v_pickup_relation
    from public.pickup_persons p
    where p.id = new.pickup_person_id
      and p.student_id = new.student_id
      and p.institution_id = new.institution_id;

    if v_pickup_name is null then
      raise exception 'code:validation_failed' using detail = 'collector is not authorised for this student';
    end if;

    new.collector_name := v_pickup_name;
    new.collector_relation := v_pickup_relation;
  end if;

  if not v_is_trusted then
    new.status := 'pending';
    new.requested_by := app.current_user_id();
    new.requested_at := now();
    new.decided_by := null;
    new.decided_at := null;
    new.exited_at := null;
    new.exit_marked_by := null;
  end if;

  return new;
end;
$$;

create trigger gate_pass_before_insert
before insert on public.gate_passes
for each row execute function app.gate_pass_before_insert();

-- Invoker guard: status transition table. pending -> approved|rejected|
-- cancelled; approved -> cancelled|exited; rejected/cancelled/exited are
-- terminal. Everything except status is immutable, EXCEPT the one
-- legitimate non-status write: pickup_person_id being cascaded to null by
-- the FK's own `on delete set null` when a guardian removes a person used
-- by a past pass — recognised and allowed before the immutability check
-- runs, with no status change and no decided_*/exited_* stamping.
create function app.guard_gate_passes_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.pickup_person_id is null and old.pickup_person_id is not null
    and new.status = old.status
    and new.institution_id = old.institution_id
    and new.student_id = old.student_id
    and new.guardian_id is not distinct from old.guardian_id
    and new.reason = old.reason
    and new.collector_name = old.collector_name
    and new.collector_relation = old.collector_relation
    and new.requested_by = old.requested_by
    and new.requested_at = old.requested_at
    and new.decided_by is not distinct from old.decided_by
    and new.decided_at is not distinct from old.decided_at
    and new.exited_at is not distinct from old.exited_at
    and new.exit_marked_by is not distinct from old.exit_marked_by
  then
    return new;
  end if;

  if old.status in ('rejected', 'cancelled', 'exited') then
    raise exception 'code:invalid_state' using detail = format('gate pass status %s is terminal', old.status);
  end if;

  if new.institution_id is distinct from old.institution_id
    or new.student_id is distinct from old.student_id
    or new.guardian_id is distinct from old.guardian_id
    or new.pickup_person_id is distinct from old.pickup_person_id
    or new.reason is distinct from old.reason
    or new.collector_name is distinct from old.collector_name
    or new.collector_relation is distinct from old.collector_relation
    or new.requested_by is distinct from old.requested_by
    or new.requested_at is distinct from old.requested_at
  then
    raise exception 'code:invalid_state' using detail = 'only status may change on a gate pass';
  end if;

  if old.status = 'pending' and new.status in ('approved', 'rejected', 'cancelled') then
    null;
  elsif old.status = 'approved' and new.status in ('cancelled', 'exited') then
    null;
  else
    raise exception 'code:invalid_state' using detail = format('cannot move gate pass from %s to %s', old.status, new.status);
  end if;

  if new.status in ('approved', 'rejected', 'cancelled') then
    new.decided_by := app.current_user_id();
    new.decided_at := now();
  else
    new.decided_by := old.decided_by;
    new.decided_at := old.decided_at;
  end if;

  if new.status = 'exited' then
    new.exited_at := now();
    new.exit_marked_by := app.current_user_id();
  else
    new.exited_at := old.exited_at;
    new.exit_marked_by := old.exit_marked_by;
  end if;

  return new;
end;
$$;

create trigger guard_gate_passes_update
before update on public.gate_passes
for each row execute function app.guard_gate_passes_update();

-- Definer: enqueues the approval notice job exactly once per pending ->
-- approved transition. Payload id only (lesson 3/10).
create function app.enqueue_gate_pass_notice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'pending' and new.status = 'approved' then
    perform app.enqueue_job(
      new.institution_id,
      'notify.gate_pass',
      jsonb_build_object('gate_pass_id', new.id),
      'gatepass:' || new.id
    );
  end if;
  return new;
end;
$$;

create trigger enqueue_gate_pass_notice
after update of status on public.gate_passes
for each row execute function app.enqueue_gate_pass_notice();

alter table public.gate_passes enable row level security;

create policy gate_passes_select on public.gate_passes
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or student_id = any((select app.my_class_teacher_student_ids()))
  );

create policy gate_passes_insert on public.gate_passes
  for insert to authenticated
  with check (
    (
      institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
      or student_id = any((select app.my_class_teacher_student_ids()))
    )
    and exists (select 1 from public.students s where s.id = gate_passes.student_id and s.institution_id = gate_passes.institution_id)
    and (
      guardian_id is null
      or exists (select 1 from public.guardians g where g.id = gate_passes.guardian_id and g.institution_id = gate_passes.institution_id)
    )
    and (
      pickup_person_id is null
      or exists (select 1 from public.pickup_persons p where p.id = gate_passes.pickup_person_id and p.institution_id = gate_passes.institution_id)
    )
  );

create policy gate_passes_update on public.gate_passes
  for update to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or student_id = any((select app.my_class_teacher_student_ids()))
  )
  with check (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or student_id = any((select app.my_class_teacher_student_ids()))
  );

-- No DELETE policy (rulings). Guardians/students get none (notification only).
