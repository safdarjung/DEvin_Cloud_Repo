-- T-004: core tables — institutions, campuses, academic_years, terms,
-- profiles, memberships, institution_sequences + RLS.
--
-- Deferred to later migrations:
--   - memberships.staff_id / guardian_id / student_id have no FK yet; staff,
--     guardians, students are created in 0004 (T-010), which must
--     `alter table memberships add constraint ... foreign key ...` for each.
--   - The membership revision-audit trigger (via app.audit) is NOT created
--     here; `05 §7` assigns it to 0003 (T-005), which creates audit_events
--     and app.audit first, then attaches the audit trigger to memberships.
--     This migration only creates the role<->link validation trigger.

create table public.institutions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  board text not null default 'CBSE',
  is_demo boolean not null default false,
  ai_policy text not null default 'local_only'
    check (ai_policy in ('local_only', 'cloud_allowed', 'local_with_cloud_fallback')),
  settings jsonb not null default '{}'::jsonb,
  address jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index institutions_is_demo_idx on public.institutions (id) where is_demo;

create trigger set_updated_at
before update on public.institutions
for each row execute function app.set_updated_at();

create table public.campuses (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, name)
);

create unique index campuses_one_default_idx on public.campuses (institution_id) where is_default;

create trigger set_updated_at
before update on public.campuses
for each row execute function app.set_updated_at();

create table public.academic_years (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  name text not null,
  starts_on date not null,
  ends_on date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, name),
  check (ends_on > starts_on)
);

create unique index academic_years_one_current_idx on public.academic_years (institution_id) where is_current;

create trigger set_updated_at
before update on public.academic_years
for each row execute function app.set_updated_at();

create table public.terms (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  academic_year_id uuid not null references public.academic_years (id),
  name text not null,
  sequence int not null,
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academic_year_id, sequence),
  check (ends_on > starts_on)
);

create index terms_institution_id_idx on public.terms (institution_id);

create trigger set_updated_at
before update on public.terms
for each row execute function app.set_updated_at();

create function app.validate_term_dates()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_year public.academic_years;
begin
  select * into v_year from public.academic_years where id = new.academic_year_id;

  if new.starts_on < v_year.starts_on or new.ends_on > v_year.ends_on then
    raise exception 'code:validation_failed' using detail = 'term dates must fall within the academic year';
  end if;

  return new;
end;
$$;

create trigger validate_term_dates
before insert or update on public.terms
for each row execute function app.validate_term_dates();

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  avatar_path text,
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at
before update on public.profiles
for each row execute function app.set_updated_at();

create function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function app.handle_new_auth_user();

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  user_id uuid not null references public.profiles (id),
  role text not null check (role in (
    'owner', 'principal', 'admin', 'admissions', 'accountant',
    'exam_controller', 'teacher', 'student', 'guardian'
  )),
  status text not null default 'active' check (status in ('active', 'invited', 'disabled')),
  -- No FK yet: staff/guardians/students land in migration 0004 (T-010),
  -- which adds the foreign keys for these three columns.
  staff_id uuid,
  guardian_id uuid,
  student_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, user_id, role)
);

create index memberships_user_id_idx on public.memberships (user_id);

create trigger set_updated_at
before update on public.memberships
for each row execute function app.set_updated_at();

create function app.validate_membership_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role = any(app.staff_roles()) then
    if new.staff_id is null or new.guardian_id is not null or new.student_id is not null then
      raise exception 'code:validation_failed' using detail = 'staff-class role requires staff_id and no guardian_id/student_id';
    end if;
  elsif new.role = 'guardian' then
    if new.guardian_id is null or new.staff_id is not null or new.student_id is not null then
      raise exception 'code:validation_failed' using detail = 'guardian role requires guardian_id and no staff_id/student_id';
    end if;
  elsif new.role = 'student' then
    if new.student_id is null or new.staff_id is not null or new.guardian_id is not null then
      raise exception 'code:validation_failed' using detail = 'student role requires student_id and no staff_id/guardian_id';
    end if;
  end if;

  return new;
end;
$$;

create trigger validate_membership_link
before insert or update on public.memberships
for each row execute function app.validate_membership_link();

create table public.institution_sequences (
  institution_id uuid not null references public.institutions (id),
  key text not null,
  next_value bigint not null default 1,
  pattern text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (institution_id, key)
);

create trigger set_updated_at
before update on public.institution_sequences
for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS (05 §5)
-- ---------------------------------------------------------------------------

alter table public.institutions enable row level security;
alter table public.campuses enable row level security;
alter table public.academic_years enable row level security;
alter table public.terms enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.institution_sequences enable row level security;

-- institutions: class A-ish (own row only); no INSERT/DELETE (seed/service-role only).
create policy institutions_select on public.institutions
  for select to authenticated
  using (app.is_member(id));

create policy institutions_update on public.institutions
  for update to authenticated
  using (app.has_role(id, array['owner', 'principal', 'admin']))
  with check (app.has_role(id, array['owner', 'principal', 'admin']));

-- campuses / academic_years / terms: class S.
create policy campuses_select on public.campuses
  for select to authenticated
  using (app.has_role(institution_id, app.staff_roles()));

create policy campuses_insert on public.campuses
  for insert to authenticated
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy campuses_update on public.campuses
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy academic_years_select on public.academic_years
  for select to authenticated
  using (app.has_role(institution_id, app.staff_roles()));

create policy academic_years_insert on public.academic_years
  for insert to authenticated
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy academic_years_update on public.academic_years
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy terms_select on public.terms
  for select to authenticated
  using (app.has_role(institution_id, app.staff_roles()));

create policy terms_insert on public.terms
  for insert to authenticated
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy terms_update on public.terms
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

-- profiles: class O (own row) plus SELECT of profiles sharing an institution.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = app.current_user_id()
    or exists (
      select 1
      from public.memberships m1
      join public.memberships m2 on m2.institution_id = m1.institution_id
      where m1.user_id = app.current_user_id()
        and m1.status = 'active'
        and m2.user_id = profiles.id
        and m2.status = 'active'
    )
  );

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = app.current_user_id())
  with check (id = app.current_user_id());

-- memberships: class O own rows; owner/principal/admin manage within their institution; no DELETE.
create policy memberships_select on public.memberships
  for select to authenticated
  using (
    user_id = app.current_user_id()
    or app.has_role(institution_id, array['owner', 'principal', 'admin'])
  );

create policy memberships_insert on public.memberships
  for insert to authenticated
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy memberships_update on public.memberships
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

-- institution_sequences: no policies — function-only (app.next_sequence runs security definer).
