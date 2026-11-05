-- X02-T2: migration 0091 part 1 — certificates table, RLS, guards, module
-- key. T3 (same file) appends app.issue_certificate / public.issue_certificate.
-- Rulings: docs/planning/fabric/06-backend-packets/X02-tasks.md.

insert into app.module_catalog (key, default_enabled) values
  ('certificates', true)
on conflict (key) do update set default_enabled = excluded.default_enabled;

-- ---------------------------------------------------------------------------
-- public.certificates — append-only (rule 5 extended). Rows come only from
-- T3's app.issue_certificate (or the seed over public.issue_certificate).
-- ---------------------------------------------------------------------------

create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  student_id uuid not null references public.students (id),
  kind text not null check (kind in ('bonafide', 'character', 'transfer')),
  serial_no text not null check (char_length(serial_no) between 1 and 60),
  lifecycle_event_id uuid references public.student_lifecycle_events (id),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  issued_by uuid not null references public.profiles (id),
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'transfer') = (lifecycle_event_id is not null))
);

create unique index certificates_institution_serial_idx
  on public.certificates (institution_id, serial_no);
create unique index certificates_lifecycle_event_idx
  on public.certificates (lifecycle_event_id) where lifecycle_event_id is not null;
create index certificates_institution_student_issued_idx
  on public.certificates (institution_id, student_id, issued_at desc);

create trigger set_updated_at
before update on public.certificates
for each row execute function app.set_updated_at();

create trigger block_mutation
before update or delete on public.certificates
for each row execute function app.block_mutation();

alter table public.certificates enable row level security;

-- SELECT only (07 §2.2 certificate.manage; same shape as 0076's
-- student_lifecycle_events_select, narrowed role list). No INSERT/UPDATE/
-- DELETE policy: rows come only from T3's SECURITY DEFINER function, which
-- runs as the table owner and bypasses RLS.
create policy certificates_select on public.certificates
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'admissions'])))
  );

-- ---------------------------------------------------------------------------
-- X02-T3: app.issue_certificate / public.issue_certificate — bonafide,
-- character and transfer certificates. Snapshot built from rows (lesson 3);
-- the caller supplies only purpose/conduct text. No role check in app.*
-- (callers: the public wrapper below, and the seed over its own ctx.sql
-- pool — finance.ts precedent, file header). Numbering follows the 0076
-- tc_no precedent: a missing settings.numbering.<key> is seeded with the
-- default pattern on first use; the sequence itself never resets.
-- ---------------------------------------------------------------------------

create function app.issue_certificate(
  p_actor uuid,
  p_student_id uuid,
  p_kind text,
  p_purpose text,
  p_conduct text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students;
  v_institution_id uuid;
  v_event public.student_lifecycle_events;
  v_existing_id uuid;
  v_existing_serial text;
  v_serial_no text;
  v_lifecycle_event_id uuid;
  v_tc jsonb;
  v_pattern text;
  v_seq_key text;
  v_default_pattern text;
  v_school_name text;
  v_school_board text;
  v_school_address jsonb;
  v_address text;
  v_student_name text;
  v_guardian_name text;
  v_guardian_relationship text;
  v_grade_code text;
  v_section_name text;
  v_year_name text;
  v_roll_no int;
  v_enrolment_status text;
  v_admitted_on date;
  v_issued_by_name text;
  v_timezone text;
  v_issued_on date;
  v_snapshot jsonb;
  v_certificate_id uuid;
begin
  select * into v_student from public.students where id = p_student_id;
  if v_student.id is null then
    raise exception 'code:not_found' using detail = 'student not found';
  end if;
  v_institution_id := v_student.institution_id;

  if p_kind = 'bonafide' then
    if v_student.status <> 'active' or not exists (
      select 1 from public.enrolments where student_id = p_student_id and status = 'active'
    ) then
      raise exception 'code:invalid_state' using detail = 'student is not active with an active enrolment';
    end if;
    if p_purpose is null or char_length(btrim(p_purpose)) < 3 or char_length(btrim(p_purpose)) > 200 then
      raise exception 'code:validation_failed' using detail = 'purpose must be 3-200 characters';
    end if;
    if p_conduct is not null then
      raise exception 'code:validation_failed' using detail = 'bonafide does not take conduct';
    end if;
  elsif p_kind = 'character' then
    if not exists (select 1 from public.enrolments where student_id = p_student_id) then
      raise exception 'code:invalid_state' using detail = 'student has no enrolment';
    end if;
    if p_conduct is null or char_length(btrim(p_conduct)) < 2 or char_length(btrim(p_conduct)) > 100 then
      raise exception 'code:validation_failed' using detail = 'conduct must be 2-100 characters';
    end if;
    if p_purpose is not null and (char_length(btrim(p_purpose)) < 3 or char_length(btrim(p_purpose)) > 200) then
      raise exception 'code:validation_failed' using detail = 'purpose must be 3-200 characters';
    end if;
  elsif p_kind = 'transfer' then
    if v_student.status <> 'withdrawn' then
      raise exception 'code:invalid_state' using detail = 'student is not withdrawn';
    end if;

    select * into v_event from public.student_lifecycle_events
    where student_id = p_student_id and kind in ('transferred_out', 'withdrawn')
    order by created_at desc
    limit 1;
    if v_event.id is null then
      raise exception 'code:invalid_state' using detail = 'no transfer/withdrawal event found for student';
    end if;

    -- One TC certificate per event: a repeat call returns the existing row
    -- untouched (no second insert, no second audit row).
    select id, serial_no into v_existing_id, v_existing_serial
    from public.certificates where lifecycle_event_id = v_event.id;
    if v_existing_id is not null then
      return jsonb_build_object('certificate_id', v_existing_id, 'serial_no', v_existing_serial, 'created', false);
    end if;

    if p_purpose is not null or p_conduct is not null then
      raise exception 'code:validation_failed' using detail = 'transfer takes neither purpose nor conduct';
    end if;
  else
    raise exception 'code:validation_failed' using detail = 'kind must be bonafide, character or transfer';
  end if;

  select coalesce(settings -> 'locale' ->> 'timezone', 'Asia/Kolkata'), name, board, address
  into v_timezone, v_school_name, v_school_board, v_school_address
  from public.institutions where id = v_institution_id;

  v_issued_on := (now() at time zone v_timezone)::date;

  v_address := nullif(concat_ws(', ',
    v_school_address ->> 'line1',
    v_school_address ->> 'line2',
    v_school_address ->> 'city',
    v_school_address ->> 'state',
    v_school_address ->> 'pincode'
  ), '');

  select full_name into v_issued_by_name from public.profiles where id = p_actor;

  v_student_name := btrim(concat(v_student.first_name, ' ', coalesce(v_student.last_name, '')));

  -- Guardian: primary, else earliest linked.
  select g.full_name, gs.relationship
  into v_guardian_name, v_guardian_relationship
  from public.guardian_students gs
  join public.guardians g on g.id = gs.guardian_id
  where gs.student_id = p_student_id
  order by gs.is_primary desc, gs.created_at asc
  limit 1;

  -- Enrolment: latest by started_on.
  select g.code, cs.name, y.name, e.roll_no, e.status
  into v_grade_code, v_section_name, v_year_name, v_roll_no, v_enrolment_status
  from public.enrolments e
  join public.class_sections cs on cs.id = e.class_section_id
  join public.grades g on g.id = cs.grade_id
  join public.academic_years y on y.id = cs.academic_year_id
  where e.student_id = p_student_id
  order by e.started_on desc
  limit 1;

  select min(started_on) into v_admitted_on from public.enrolments where student_id = p_student_id;

  if p_kind = 'transfer' then
    v_serial_no := v_event.tc_no;
    v_lifecycle_event_id := v_event.id;
    v_tc := v_event.tc_snapshot;
  else
    v_seq_key := case p_kind when 'bonafide' then 'bonafide_no' else 'character_no' end;
    v_default_pattern := case p_kind when 'bonafide' then 'BON/{YYYY}/{SEQ:5}' else 'CHR/{YYYY}/{SEQ:5}' end;

    select settings -> 'numbering' ->> v_seq_key into v_pattern
    from public.institutions where id = v_institution_id;

    if v_pattern is null then
      update public.institutions
      set settings = jsonb_set(
        settings,
        '{numbering}',
        coalesce(settings -> 'numbering', '{}'::jsonb) || jsonb_build_object(v_seq_key, v_default_pattern),
        true
      )
      where id = v_institution_id;
    end if;

    v_serial_no := app.next_sequence(v_institution_id, v_seq_key);
    v_lifecycle_event_id := null;
    v_tc := null;
  end if;

  v_snapshot := jsonb_build_object(
    'kind', p_kind,
    'serial_no', v_serial_no,
    'issued_on', v_issued_on,
    'issued_by_name', v_issued_by_name,
    'school', jsonb_build_object('name', v_school_name, 'board', v_school_board, 'address', v_address),
    'student', jsonb_build_object(
      'name', v_student_name,
      'admission_no', v_student.admission_no,
      'dob', v_student.dob,
      'gender', v_student.gender,
      'status', v_student.status
    ),
    'guardian', case when v_guardian_name is null then null
      else jsonb_build_object('name', v_guardian_name, 'relationship', v_guardian_relationship) end,
    'enrolment', case when v_grade_code is null then null
      else jsonb_build_object(
        'grade', v_grade_code,
        'section', v_section_name,
        'academic_year', v_year_name,
        'roll_no', v_roll_no,
        'status', v_enrolment_status
      ) end,
    'admitted_on', v_admitted_on,
    'purpose', p_purpose,
    'conduct', p_conduct,
    'tc', v_tc
  );

  insert into public.certificates (institution_id, student_id, kind, serial_no, lifecycle_event_id, snapshot, issued_by)
  values (v_institution_id, p_student_id, p_kind, v_serial_no, v_lifecycle_event_id, v_snapshot, p_actor)
  returning id into v_certificate_id;

  perform app.audit(
    v_institution_id,
    p_actor,
    'certificate.issued',
    'certificate',
    v_certificate_id,
    null,
    null,
    jsonb_build_object('certificate_id', v_certificate_id, 'kind', p_kind, 'serial_no', v_serial_no)
  );

  return jsonb_build_object('certificate_id', v_certificate_id, 'serial_no', v_serial_no, 'created', true);
end;
$$;

revoke execute on function app.issue_certificate(uuid, uuid, text, text, text) from public, anon, authenticated;

create function public.issue_certificate(
  p_student_id uuid,
  p_kind text,
  p_purpose text default null,
  p_conduct text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_institution_id uuid;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select institution_id into v_institution_id from public.students where id = p_student_id;
  if v_institution_id is null then
    raise exception 'code:not_found' using detail = 'student not found';
  end if;

  if not app.has_role(v_institution_id, array['owner', 'principal', 'admin', 'admissions']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold a certificate.manage role for this institution';
  end if;

  return app.issue_certificate(v_caller, p_student_id, p_kind, p_purpose, p_conduct);
end;
$$;

revoke execute on function public.issue_certificate(uuid, text, text, text) from public, anon;
grant execute on function public.issue_certificate(uuid, text, text, text) to authenticated;
