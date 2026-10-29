-- T-014: attendance_sessions, attendance_records, attendance_corrections + RLS.
-- One register per section per day (session), one row per student per
-- session (record), and an append-only correction log (05 §2.4, §6).

create table public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  class_section_id uuid not null references public.class_sections (id),
  date date not null,
  status text not null default 'open' check (status in ('open', 'submitted')),
  marked_by uuid references public.staff (id),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_section_id, date)
);

create index attendance_sessions_institution_date_idx on public.attendance_sessions (institution_id, date);

create trigger set_updated_at
before update on public.attendance_sessions
for each row execute function app.set_updated_at();

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  session_id uuid not null references public.attendance_sessions (id),
  student_id uuid not null references public.students (id),
  status text not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, student_id)
);

create index attendance_records_institution_idx on public.attendance_records (institution_id);
create index attendance_records_student_session_idx on public.attendance_records (student_id, session_id);

create trigger set_updated_at
before update on public.attendance_records
for each row execute function app.set_updated_at();

-- Validates `status` against the institution's configured codes (05 §4.1
-- `settings.attendance.statuses[*].code`, e.g. P/A/L/HD/OL) so a renamed or
-- removed code can never be written. SECURITY DEFINER (not invoker) so this
-- holds regardless of the firing role's own SELECT access to institutions —
-- T-012's lesson: don't let a trigger's behavior depend on the firing
-- role's incidental privileges.
create function app.validate_attendance_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_valid boolean;
begin
  select exists (
    select 1
    from public.institutions i,
         jsonb_array_elements(coalesce(i.settings -> 'attendance' -> 'statuses', '[]'::jsonb)) as s
    where i.id = new.institution_id
      and s ->> 'code' = new.status
  ) into v_valid;

  if not v_valid then
    raise exception 'code:invalid_input' using detail = format(
      'attendance status %L is not a configured status for this institution', new.status
    );
  end if;

  return new;
end;
$$;

revoke execute on function app.validate_attendance_status() from public;

create trigger validate_attendance_status
before insert or update on public.attendance_records
for each row execute function app.validate_attendance_status();

create table public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  record_id uuid not null references public.attendance_records (id),
  old_status text not null,
  new_status text not null,
  reason text not null,
  corrected_by uuid references public.staff (id),
  created_at timestamptz not null default now()
);

create index attendance_corrections_institution_idx on public.attendance_corrections (institution_id);
create index attendance_corrections_record_idx on public.attendance_corrections (record_id);

create trigger block_mutation
before update or delete on public.attendance_corrections
for each row execute function app.block_mutation();

-- ---------------------------------------------------------------------------
-- RLS (05 §5, 07 §2.2): full read for owner/principal/admin/exam_controller;
-- a teacher is scoped to sections they teach (app.teaches_section), not
-- every staff role; guardian/student scoped to their own/linked children.
-- T writes on sessions/records (also enrolment-checked, see below);
-- corrections insert by the same T set; no DELETE policies anywhere
-- (05 §6 append-only/no-delete).
-- ---------------------------------------------------------------------------

alter table public.attendance_sessions enable row level security;
alter table public.attendance_records enable row level security;
alter table public.attendance_corrections enable row level security;

-- attendance_sessions: 07 §2.2 attendance.read — owner/principal/admin/
-- exam_controller see every section; a teacher sees only sections they
-- teach (app.teaches_section), not every staff-role member (admissions,
-- accountant, other teachers excluded). Guardian/student scoped via the
-- student's active enrolment in the session's section (same join shape as
-- class_sections_select in 0005) — unchanged.
create policy attendance_sessions_select on public.attendance_sessions
  for select to authenticated
  using (
    app.has_role(institution_id, array['owner', 'principal', 'admin', 'exam_controller'])
    or app.teaches_section(institution_id, class_section_id)
    or exists (
      select 1 from public.enrolments e
      where e.class_section_id = attendance_sessions.class_section_id
        and e.status = 'active'
        and (
          e.student_id in (select app.guardian_student_ids(attendance_sessions.institution_id))
          or e.student_id = app.own_student_id(attendance_sessions.institution_id)
        )
    )
  );

create policy attendance_sessions_insert on public.attendance_sessions
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    or app.teaches_section(institution_id, class_section_id)
  );

create policy attendance_sessions_update on public.attendance_sessions
  for update to authenticated
  using (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    or app.teaches_section(institution_id, class_section_id)
  )
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    or app.teaches_section(institution_id, class_section_id)
  );

-- attendance_records: student_id is a direct column. SELECT narrowed the
-- same way as sessions (full read owner/principal/admin/exam_controller;
-- teacher only via app.teaches_section on the session's section); guardian/
-- student branches unchanged.
create policy attendance_records_select on public.attendance_records
  for select to authenticated
  using (
    app.has_role(institution_id, array['owner', 'principal', 'admin', 'exam_controller'])
    or app.teaches_section(
      institution_id,
      (select s.class_section_id from public.attendance_sessions s where s.id = attendance_records.session_id)
    )
    or student_id in (select app.guardian_student_ids(institution_id))
    or student_id = app.own_student_id(institution_id)
  );

-- INSERT/UPDATE: a teacher may write only within a section they teach
-- (unchanged) AND `student_id` must actually be enrolled in that session's
-- section — otherwise a teacher of A could write a record naming any
-- student_id, including a student of another section or another tenant
-- entirely (CRITICAL, security review). Deliberately not filtered to
-- `status = 'active'`: a correction to a past record must still be writable
-- after the student transfers out; who may currently mark attendance is the
-- action layer's (T-015) concern, not RLS's.
create policy attendance_records_insert on public.attendance_records
  for insert to authenticated
  with check (
    (
      app.has_role(institution_id, array['owner', 'principal', 'admin'])
      or app.teaches_section(
        institution_id,
        (select s.class_section_id from public.attendance_sessions s where s.id = attendance_records.session_id)
      )
    )
    and exists (
      select 1
      from public.attendance_sessions s
      join public.enrolments e on e.class_section_id = s.class_section_id
      where s.id = attendance_records.session_id
        and e.institution_id = attendance_records.institution_id
        and e.student_id = attendance_records.student_id
    )
  );

create policy attendance_records_update on public.attendance_records
  for update to authenticated
  using (
    (
      app.has_role(institution_id, array['owner', 'principal', 'admin'])
      or app.teaches_section(
        institution_id,
        (select s.class_section_id from public.attendance_sessions s where s.id = attendance_records.session_id)
      )
    )
    and exists (
      select 1
      from public.attendance_sessions s
      join public.enrolments e on e.class_section_id = s.class_section_id
      where s.id = attendance_records.session_id
        and e.institution_id = attendance_records.institution_id
        and e.student_id = attendance_records.student_id
    )
  )
  with check (
    (
      app.has_role(institution_id, array['owner', 'principal', 'admin'])
      or app.teaches_section(
        institution_id,
        (select s.class_section_id from public.attendance_sessions s where s.id = attendance_records.session_id)
      )
    )
    and exists (
      select 1
      from public.attendance_sessions s
      join public.enrolments e on e.class_section_id = s.class_section_id
      where s.id = attendance_records.session_id
        and e.institution_id = attendance_records.institution_id
        and e.student_id = attendance_records.student_id
    )
  );

-- attendance_corrections: read scoped like attendance_records — full read
-- owner/principal/admin/exam_controller; teacher only via the corrected
-- record's session's section (app.teaches_section); guardian/student via
-- the corrected record's student (unchanged). Write is INSERT-only by the
-- same T set as sessions/records — append-only, enforced again by the
-- block_mutation trigger above (defense in depth, also covers any future
-- service-role path).
create policy attendance_corrections_select on public.attendance_corrections
  for select to authenticated
  using (
    app.has_role(institution_id, array['owner', 'principal', 'admin', 'exam_controller'])
    or exists (
      select 1
      from public.attendance_records r
      join public.attendance_sessions s on s.id = r.session_id
      where r.id = attendance_corrections.record_id
        and app.teaches_section(attendance_corrections.institution_id, s.class_section_id)
    )
    or exists (
      select 1 from public.attendance_records r
      where r.id = attendance_corrections.record_id
        and (
          r.student_id in (select app.guardian_student_ids(attendance_corrections.institution_id))
          or r.student_id = app.own_student_id(attendance_corrections.institution_id)
        )
    )
  );

create policy attendance_corrections_insert on public.attendance_corrections
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    or app.teaches_section(
      institution_id,
      (
        select s.class_section_id
        from public.attendance_records r
        join public.attendance_sessions s on s.id = r.session_id
        where r.id = record_id
      )
    )
  );
