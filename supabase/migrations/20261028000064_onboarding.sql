-- M03-T1: onboarding — invitations table, membership-bootstrap guard,
-- `create_institution` RPC (06 M03 Task 1).
--
-- A brand-new user has no membership anywhere, so `create_institution`
-- inserts the caller's own owner membership — exactly what 0033/0038's
-- `app.guard_membership_write` exists to block. Fix: a transaction-local
-- GUC (`app.allow_membership_bootstrap`), same pattern as 0010's
-- `app.allow_publish` — never settable by a PostgREST caller, only set
-- inside this definer function before its own membership insert.
--
-- `invitations` lands here (ahead of M03-T2's invite/accept RPCs) so the
-- table, RLS and column grants exist for review now; no RPC writes it yet.

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  email text not null check (email = lower(email)),
  role text not null check (role in (
    'owner', 'principal', 'admin', 'admissions', 'accountant',
    'exam_controller', 'teacher', 'student', 'guardian'
  )),
  staff_id uuid references public.staff (id),
  guardian_id uuid references public.guardians (id),
  student_id uuid references public.students (id),
  token_hash text not null unique,
  invited_by uuid references public.profiles (id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index invitations_institution_id_idx on public.invitations (institution_id);

create trigger set_updated_at
before update on public.invitations
for each row execute function app.set_updated_at();

alter table public.invitations enable row level security;

-- Owner/principal/admin only; no INSERT/UPDATE/DELETE policy — every write
-- goes through a security-definer RPC (M03-T2: invite_member/accept_invitation/
-- revoke_invitation), same "function-only" shape as institution_sequences (0002).
create policy invitations_select on public.invitations
  for select to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']));

-- Default privileges (0045) grant table-wide SELECT to authenticated on any
-- new table; narrow it to every column except token_hash so an admin query
-- can never read the raw token (only its hash is stored; accept_invitation
-- compares by hash, M03-T2).
revoke select on table public.invitations from authenticated;
grant select (
  id, institution_id, email, role, staff_id, guardian_id, student_id,
  invited_by, expires_at, accepted_at, accepted_by, revoked_at, created_at, updated_at
) on table public.invitations to authenticated;

-- ---------------------------------------------------------------------------
-- Membership-bootstrap guard (0038 body + bootstrap bypass)
-- ---------------------------------------------------------------------------

create or replace function app.guard_membership_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_roles text[] := array[new.role];
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  then
    return new;
  end if;

  -- M03-T1: create_institution/accept_invitation insert the caller's own
  -- membership; set only inside those definer functions (never reachable
  -- from PostgREST), cleared at transaction end (`set_config(..., true)`).
  if coalesce(current_setting('app.allow_membership_bootstrap', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id or new.institution_id is distinct from old.institution_id then
      raise exception 'code:forbidden' using detail = 'a membership''s user and institution never change';
    end if;
    v_roles := v_roles || old.role;
  end if;

  if new.user_id = app.current_user_id()
    or (tg_op = 'UPDATE' and old.user_id = app.current_user_id())
  then
    raise exception 'code:forbidden' using detail = 'members cannot change their own membership';
  end if;

  if 'owner' = any(v_roles) and not app.has_role(new.institution_id, array['owner']) then
    raise exception 'code:forbidden' using detail = 'only an owner manages owner memberships';
  end if;

  if 'principal' = any(v_roles) and not app.has_role(new.institution_id, array['owner', 'principal']) then
    raise exception 'code:forbidden' using detail = 'only an owner or principal manages principal memberships';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_institution (M03-T1)
-- ---------------------------------------------------------------------------

create function public.create_institution(
  p_name text,
  p_slug text,
  p_timezone text default 'Asia/Kolkata',
  p_year_start date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_name text;
  v_email text;
  v_full_name text;
  v_owned_count int;
  v_institution_id uuid;
  v_staff_id uuid;
  v_year_id uuid;
  v_year_start date;
  v_year_end date;
  v_year_name text;
  v_term1_end date;
  v_term2_start date;
begin
  v_uid := app.current_user_id();
  if v_uid is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  v_name := trim(p_name);
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'code:validation_failed' using detail = 'name must be 2-120 characters';
  end if;

  if p_slug !~ '^[a-z0-9](-?[a-z0-9])*$' or length(p_slug) < 3 or length(p_slug) > 40 then
    raise exception 'code:validation_failed' using detail = 'slug must be 3-40 lowercase alphanumeric characters, hyphen-separated';
  end if;

  if p_slug = any(array[
    'api', 's', 'login', 'logout', 'auth', 'admin', 'app', 'www',
    'static', 'public', 'demo', 'invite', 'onboarding'
  ]) then
    raise exception 'code:validation_failed' using detail = 'slug is reserved';
  end if;

  -- shortcut: per-user cap of 3 owned institutions; replace with a billing
  -- plan check once M17 ships (no plan/billing model exists yet).
  select count(*) into v_owned_count
  from public.memberships
  where user_id = v_uid and role = 'owner' and status = 'active';
  if v_owned_count >= 3 then
    raise exception 'code:quota_exceeded' using detail = 'caller already owns the maximum number of institutions';
  end if;

  select full_name into v_full_name from public.profiles where id = v_uid;
  select email into v_email from auth.users where id = v_uid;

  v_year_start := coalesce(
    p_year_start,
    case
      when extract(month from current_date) >= 4
        then make_date(extract(year from current_date)::int, 4, 1)
      else make_date(extract(year from current_date)::int - 1, 4, 1)
    end
  );
  v_year_end := (v_year_start + interval '1 year')::date - 1;
  v_year_name := to_char(v_year_start, 'YYYY') || '-' || to_char(v_year_start + interval '1 year', 'YY');
  v_term1_end := make_date(extract(year from v_year_start)::int, 9, 30);
  v_term2_start := make_date(extract(year from v_year_start)::int, 10, 1);

  begin
    insert into public.institutions (id, slug, name, settings)
    values (
      gen_random_uuid(), p_slug, v_name,
      jsonb_build_object('locale', jsonb_build_object('timezone', p_timezone, 'currency', 'INR'))
    )
    returning id into v_institution_id;
  exception
    when unique_violation then
      raise exception 'code:conflict' using detail = 'slug already in use';
  end;

  insert into public.staff (id, institution_id, employee_no, full_name, designation, email, user_id)
  values (gen_random_uuid(), v_institution_id, 'OWN-001', coalesce(v_full_name, 'Owner'), 'Owner', v_email, v_uid)
  returning id into v_staff_id;

  perform set_config('app.allow_membership_bootstrap', 'on', true);
  insert into public.memberships (institution_id, user_id, role, status, staff_id)
  values (v_institution_id, v_uid, 'owner', 'active', v_staff_id);

  insert into public.academic_years (id, institution_id, name, starts_on, ends_on, is_current)
  values (gen_random_uuid(), v_institution_id, v_year_name, v_year_start, v_year_end, true)
  returning id into v_year_id;

  insert into public.terms (institution_id, academic_year_id, name, sequence, starts_on, ends_on)
  values
    (v_institution_id, v_year_id, 'Term 1', 1, v_year_start, v_term1_end),
    (v_institution_id, v_year_id, 'Term 2', 2, v_term2_start, v_year_end);

  perform app.audit(
    v_institution_id, v_uid, 'core.institution.created', 'institutions', v_institution_id, null, null, null
  );

  return v_institution_id;
end;
$$;

revoke execute on function public.create_institution(text, text, text, date) from public, anon;
grant execute on function public.create_institution(text, text, text, date) to authenticated;
