-- T-026: enquiries, applications, application_decisions + RLS +
-- app.submit_public_enquiry (05 §2.5; 06 §W3 inside the function, §W4 states
-- only; 07 §1 T12, §2.2 admissions.*, §4).
--
-- `public.websites` (is_live) and `public.applications`'s own
-- `academic_year_id`/`grade_applied_id` FKs all resolve fine even though
-- `websites` itself lands in 0010 (T-023): this file's functions are
-- plpgsql, so Postgres resolves relation names at call time, not at CREATE
-- FUNCTION time (0001's rationale, reused here for the same reason).

create table public.enquiries (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  child_name text not null,
  grade_applied_id uuid references public.grades (id),
  guardian_name text not null,
  phone text not null,
  email text,
  source text not null default 'other' check (source in ('website', 'walk_in', 'phone', 'referral', 'other')),
  status text not null default 'new' check (status in ('new', 'contacted', 'visit_scheduled', 'application_sent', 'converted', 'closed')),
  assigned_to uuid references public.staff (id),
  notes jsonb,
  source_ip_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- (institution_id, status) for pipeline board queries; (institution_id,
-- phone, created_at) for the 24h dedupe check; (institution_id,
-- source_ip_hash, created_at) for the 60min rate-limit check (05 §2.5, T12).
create index enquiries_institution_status_idx on public.enquiries (institution_id, status);
create index enquiries_institution_phone_idx on public.enquiries (institution_id, phone, created_at);
create index enquiries_institution_ip_idx on public.enquiries (institution_id, source_ip_hash, created_at);

create trigger set_updated_at
before update on public.enquiries
for each row execute function app.set_updated_at();

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  enquiry_id uuid references public.enquiries (id),
  applicant jsonb not null,
  guardian jsonb not null,
  grade_applied_id uuid not null references public.grades (id),
  academic_year_id uuid not null references public.academic_years (id),
  status text not null default 'submitted' check (status in ('submitted', 'under_review', 'interaction_scheduled', 'offered', 'accepted', 'rejected', 'withdrawn', 'enrolled')),
  -- not null, but left unset on INSERT and filled by the assign_application_no
  -- trigger below (BEFORE INSERT runs before the not-null/unique check).
  application_no text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, application_no)
);

-- (institution_id, status) covers the pipeline-board read and keeps
-- institution_id indexed (05 §5: every institution_id is indexed), wider
-- than the packet's literal "index(status)".
create index applications_institution_status_idx on public.applications (institution_id, status);

create trigger set_updated_at
before update on public.applications
for each row execute function app.set_updated_at();

-- application_no allocation (D15 numbering, settings.numbering.application_no
-- = "APP/{YYYY}/{SEQ:5}"). SECURITY DEFINER so it works regardless of the
-- firing role's own privileges (0006's lesson re validate_attendance_status),
-- and because app.next_sequence itself is security definer / revoked from
-- authenticated (0001).
create function app.assign_application_no()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.application_no is null then
    new.application_no := app.next_sequence(new.institution_id, 'application_no');
  end if;
  return new;
end;
$$;

revoke execute on function app.assign_application_no() from public;

create trigger assign_application_no
before insert on public.applications
for each row execute function app.assign_application_no();

-- application_decisions: append-only decision log (05 §2.5, §6). No
-- UPDATE/DELETE policy at all (defense in depth) plus block_mutation
-- (same belt-and-suspenders pattern as attendance_corrections in 0006).
create table public.application_decisions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  application_id uuid not null references public.applications (id),
  decision text not null check (decision in ('offer', 'reject', 'accept', 'withdraw')),
  decided_by uuid references public.profiles (id),
  note text,
  created_at timestamptz not null default now()
);

create index application_decisions_institution_idx on public.application_decisions (institution_id);
create index application_decisions_application_idx on public.application_decisions (application_id);

create trigger block_mutation
before update or delete on public.application_decisions
for each row execute function app.block_mutation();

-- ---------------------------------------------------------------------------
-- RLS (05 §5, 07 §2.2).
--
-- enquiries / applications: 07 §2.2 `admissions.enquiry.read/write` and
-- `admissions.enrol` both grant own/principal/admin/admissions (not the
-- wider app.staff_roles() — accountant/exam_controller/teacher excluded),
-- matching the packet's stated role set exactly.
--
-- application_decisions DEVIATES from the packet's uniform
-- "SELECT/INSERT/UPDATE for {owner,principal,admin,admissions}" on INSERT
-- only: 07 §2.2 `admissions.application.decide` grants own/principal/
-- admissions — admin is NOT listed for that row (unlike enquiry.read/write
-- and enrol, where admin is listed). Per the lead's standing instruction
-- ("if the packet's RLS class conflicts with the matrix, follow the
-- matrix"), INSERT on application_decisions excludes admin; SELECT keeps
-- admin (no separate "decisions.read" matrix row exists, and admin reads
-- everything else in the pipeline). No UPDATE policy (append-only).
-- ---------------------------------------------------------------------------

alter table public.enquiries enable row level security;
alter table public.applications enable row level security;
alter table public.application_decisions enable row level security;

create policy enquiries_select on public.enquiries
  for select to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']));

create policy enquiries_insert on public.enquiries
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions'])
    and (
      grade_applied_id is null
      or exists (
        select 1 from public.grades g
        where g.id = enquiries.grade_applied_id and g.institution_id = enquiries.institution_id
      )
    )
    and (
      assigned_to is null
      or exists (
        select 1 from public.staff s
        where s.id = enquiries.assigned_to and s.institution_id = enquiries.institution_id
      )
    )
  );

create policy enquiries_update on public.enquiries
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']))
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions'])
    and (
      grade_applied_id is null
      or exists (
        select 1 from public.grades g
        where g.id = enquiries.grade_applied_id and g.institution_id = enquiries.institution_id
      )
    )
    and (
      assigned_to is null
      or exists (
        select 1 from public.staff s
        where s.id = enquiries.assigned_to and s.institution_id = enquiries.institution_id
      )
    )
  );

create policy applications_select on public.applications
  for select to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']));

create policy applications_insert on public.applications
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions'])
    and (
      enquiry_id is null
      or exists (
        select 1 from public.enquiries e
        where e.id = applications.enquiry_id and e.institution_id = applications.institution_id
      )
    )
    and exists (
      select 1 from public.grades g
      where g.id = applications.grade_applied_id and g.institution_id = applications.institution_id
    )
    and exists (
      select 1 from public.academic_years y
      where y.id = applications.academic_year_id and y.institution_id = applications.institution_id
    )
  );

create policy applications_update on public.applications
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']))
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions'])
    and (
      enquiry_id is null
      or exists (
        select 1 from public.enquiries e
        where e.id = applications.enquiry_id and e.institution_id = applications.institution_id
      )
    )
    and exists (
      select 1 from public.grades g
      where g.id = applications.grade_applied_id and g.institution_id = applications.institution_id
    )
    and exists (
      select 1 from public.academic_years y
      where y.id = applications.academic_year_id and y.institution_id = applications.institution_id
    )
  );

create policy application_decisions_select on public.application_decisions
  for select to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']));

-- INSERT excludes admin (matrix deviation, see comment above).
create policy application_decisions_insert on public.application_decisions
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admissions'])
    and exists (
      select 1 from public.applications a
      where a.id = application_decisions.application_id
        and a.institution_id = application_decisions.institution_id
    )
  );

-- ---------------------------------------------------------------------------
-- app.submit_public_enquiry (06 §W3, 07 §1 T12, §1 T12 controls, 08 §3
-- C-81/C-82). Core logic lives in the `app` schema (not exposed over
-- PostgREST); `public.submit_public_enquiry` below is the thin exposed
-- wrapper (same shape as 0012's public.jobs_claim wrapping app.claim_job).
--
-- Every input is validated here, in SQL, regardless of what the calling
-- route already checked (defense in depth — "never trusting the route
-- alone"). Honeypot handling (C-83) is the route's job (T-024), not this
-- function's. Only a caller-supplied `ip_hash` is ever stored; this
-- function never receives or stores a raw IP.
--
-- Neither `anon` nor `authenticated` may call `public.submit_public_enquiry`
-- directly (lead security review, HIGH): a direct PostgREST RPC call skips
-- T-024's honeypot check entirely and lets the caller pick a fresh
-- `p_ip_hash` per request, defeating the T12 rate limit — each call still
-- inserts a row and enqueues a notification, so unrestricted direct access
-- is a spam/notification-flood vector. The only caller is T-024's server
-- route, running as `service_role` after its own honeypot + Zod validation
-- and a server-computed `ip_hash`; this function is granted to `service_role`
-- only.
-- ---------------------------------------------------------------------------

create function app.submit_public_enquiry(p_slug text, p_payload jsonb, p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_child_name text := trim(coalesce(p_payload->>'childName', ''));
  v_guardian_name text := trim(coalesce(p_payload->>'guardianName', ''));
  v_phone text := trim(coalesce(p_payload->>'phone', ''));
  v_email text := nullif(trim(coalesce(p_payload->>'email', '')), '');
  v_message text := nullif(p_payload->>'message', '');
  v_grade_code text := nullif(trim(coalesce(p_payload->>'gradeCode', '')), '');
  v_grade_id uuid;
  v_recent_count int;
  v_existing_id uuid;
  v_id uuid;
begin
  select i.id into v_institution_id
  from public.institutions i
  where i.slug = p_slug
    and exists (
      select 1 from public.websites w
      where w.institution_id = i.id and w.is_live = true
    );

  if v_institution_id is null then
    raise exception 'code:not_found' using detail = 'unknown institution, or its website is not live';
  end if;

  if length(v_child_name) < 1 or length(v_child_name) > 120 then
    raise exception 'code:validation_failed' using detail = 'childName must be 1-120 characters';
  end if;

  if length(v_guardian_name) < 1 or length(v_guardian_name) > 200 then
    raise exception 'code:validation_failed' using detail = 'guardianName must be 1-200 characters';
  end if;

  if v_phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'code:validation_failed' using detail = 'phone must be a 10-digit Indian mobile number';
  end if;

  if v_email is not null and (length(v_email) > 200 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'code:validation_failed' using detail = 'email is not a valid address';
  end if;

  if v_message is not null and length(v_message) > 2000 then
    raise exception 'code:validation_failed' using detail = 'message must be at most 2000 characters';
  end if;

  -- T12: rate limit — 5 or more submissions from this ip_hash in the last
  -- 60 minutes rejects the 6th (counts existing rows, so the 5th attempt is
  -- still allowed and only the 6th sees count >= 5).
  select count(*) into v_recent_count
  from public.enquiries e
  where e.institution_id = v_institution_id
    and e.source_ip_hash = p_ip_hash
    and e.created_at > now() - interval '60 minutes';

  if v_recent_count >= 5 then
    raise exception 'code:rate_limited' using detail = 'too many submissions from this source; try again later';
  end if;

  -- C-82: same (institution, phone, lower(child_name)) within 24h returns
  -- the existing reference instead of inserting a second row.
  select e.id into v_existing_id
  from public.enquiries e
  where e.institution_id = v_institution_id
    and e.phone = v_phone
    and lower(e.child_name) = lower(v_child_name)
    and e.created_at > now() - interval '24 hours'
  order by e.created_at desc
  limit 1;

  if v_existing_id is not null then
    return jsonb_build_object(
      'enquiry_id', v_existing_id,
      'reference', 'ENQ-' || left(v_existing_id::text, 8),
      'duplicate', true
    );
  end if;

  if v_grade_code is not null then
    select g.id into v_grade_id
    from public.grades g
    where g.institution_id = v_institution_id and g.code = v_grade_code;

    if v_grade_id is null then
      raise exception 'code:validation_failed' using detail = 'gradeCode does not match a grade for this institution';
    end if;
  end if;

  insert into public.enquiries (
    institution_id, child_name, grade_applied_id, guardian_name, phone, email, source, status, notes, source_ip_hash
  ) values (
    v_institution_id, v_child_name, v_grade_id, v_guardian_name, v_phone, v_email, 'website', 'new',
    case when v_message is not null then jsonb_build_object('message', v_message) else null end,
    p_ip_hash
  )
  returning id into v_id;

  perform app.enqueue_job(
    v_institution_id,
    'notify.enquiry_received',
    jsonb_build_object('enquiry_id', v_id, 'child_name', v_child_name, 'guardian_name', v_guardian_name, 'phone', v_phone),
    'enquiry:' || v_id
  );

  return jsonb_build_object(
    'enquiry_id', v_id,
    'reference', 'ENQ-' || left(v_id::text, 8),
    'duplicate', false
  );
end;
$$;

revoke execute on function app.submit_public_enquiry(text, jsonb, text) from public, anon, authenticated;

create function public.submit_public_enquiry(p_slug text, p_payload jsonb, p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.submit_public_enquiry(p_slug, p_payload, p_ip_hash);
end;
$$;

revoke execute on function public.submit_public_enquiry(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.submit_public_enquiry(text, jsonb, text) to service_role;
