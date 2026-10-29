-- T-010: departments, staff, students, guardians, guardian_students + RLS (S+G).
-- Also adds the three FKs on memberships.{staff_id,guardian_id,student_id}
-- deferred from 0002 (T-004) since those tables didn't exist yet.

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, name)
);

create trigger set_updated_at
before update on public.departments
for each row execute function app.set_updated_at();

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  employee_no text not null,
  full_name text not null,
  designation text not null,
  department_id uuid references public.departments (id),
  user_id uuid references public.profiles (id),
  phone text,
  email text,
  status text not null default 'active',
  is_teaching boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, employee_no)
);

create index staff_user_id_idx on public.staff (user_id);

create trigger set_updated_at
before update on public.staff
for each row execute function app.set_updated_at();

create table public.students (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  admission_no text not null,
  first_name text not null,
  last_name text,
  dob date not null,
  gender text not null,
  user_id uuid references public.profiles (id),
  status text not null default 'active' check (status in ('active', 'alumni', 'withdrawn')),
  source_application_id uuid unique,
  photo_path text,
  details jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, admission_no)
);

create index students_institution_status_idx on public.students (institution_id, status);
create unique index students_one_user_per_institution_idx on public.students (institution_id, user_id) where user_id is not null;

create trigger set_updated_at
before update on public.students
for each row execute function app.set_updated_at();

create table public.guardians (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  full_name text not null,
  phone text not null check (phone ~ '^[6-9][0-9]{9}$'),
  email text,
  user_id uuid references public.profiles (id),
  details jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, phone)
);

create unique index guardians_one_user_per_institution_idx on public.guardians (institution_id, user_id) where user_id is not null;

create trigger set_updated_at
before update on public.guardians
for each row execute function app.set_updated_at();

create table public.guardian_students (
  institution_id uuid not null references public.institutions (id),
  guardian_id uuid not null references public.guardians (id),
  student_id uuid not null references public.students (id),
  relationship text not null check (relationship in ('father', 'mother', 'legal_guardian', 'grandparent', 'other')),
  is_primary boolean not null default false,
  portal_access boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (guardian_id, student_id)
);

create unique index guardian_students_one_primary_idx on public.guardian_students (student_id) where is_primary;

create trigger set_updated_at
before update on public.guardian_students
for each row execute function app.set_updated_at();

-- Deferred from 0002 (T-004): staff/guardians/students now exist.
alter table public.memberships
  add constraint memberships_staff_id_fkey foreign key (staff_id) references public.staff (id),
  add constraint memberships_guardian_id_fkey foreign key (guardian_id) references public.guardians (id),
  add constraint memberships_student_id_fkey foreign key (student_id) references public.students (id);

-- ---------------------------------------------------------------------------
-- Teacher visibility of guardians needs enrolments/class_sections (0005,
-- T-011) — plpgsql defers resolution to call time (same pattern as 0001's
-- RLS helpers), so this evaluates to false until T-011 lands; that packet
-- adds the test.
-- ---------------------------------------------------------------------------

create function app.teacher_sees_guardian(p_institution_id uuid, p_guardian_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid := app.staff_id(p_institution_id);
begin
  if v_staff_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.guardian_students gs
    join public.enrolments e on e.student_id = gs.student_id and e.status = 'active'
    where gs.guardian_id = p_guardian_id
      and app.teaches_section(p_institution_id, e.class_section_id)
  );
end;
$$;

revoke execute on function app.teacher_sees_guardian(uuid, uuid) from public;
grant execute on function app.teacher_sees_guardian(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS (05 §5 class S+G)
-- ---------------------------------------------------------------------------

alter table public.departments enable row level security;
alter table public.staff enable row level security;
alter table public.students enable row level security;
alter table public.guardians enable row level security;
alter table public.guardian_students enable row level security;

-- departments: class S.
create policy departments_select on public.departments
  for select to authenticated
  using (app.has_role(institution_id, app.staff_roles()));

create policy departments_insert on public.departments
  for insert to authenticated
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy departments_update on public.departments
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

-- staff: SELECT owner/principal/admin/accountant/exam_controller + own row; writes owner/principal/admin.
create policy staff_select on public.staff
  for select to authenticated
  using (
    app.has_role(institution_id, array['owner', 'principal', 'admin', 'accountant', 'exam_controller'])
    or user_id = app.current_user_id()
  );

create policy staff_insert on public.staff
  for insert to authenticated
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy staff_update on public.staff
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

-- students: staff roles, or caller's own linked children, or caller's own student row; writes owner/principal/admin/admissions.
create policy students_select on public.students
  for select to authenticated
  using (
    app.has_role(institution_id, app.staff_roles())
    or id in (select app.guardian_student_ids(institution_id))
    or id = app.own_student_id(institution_id)
  );

create policy students_insert on public.students
  for insert to authenticated
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']));

create policy students_update on public.students
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']))
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']));

-- guardians: staff roles minus exam_controller/teacher (teacher scoped via app.teacher_sees_guardian), or own row; writes owner/principal/admin/admissions.
create policy guardians_select on public.guardians
  for select to authenticated
  using (
    app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions', 'accountant'])
    or user_id = app.current_user_id()
    or app.teacher_sees_guardian(institution_id, id)
  );

create policy guardians_insert on public.guardians
  for insert to authenticated
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']));

create policy guardians_update on public.guardians
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']))
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']));

-- guardian_students: same visibility as students, plus the caller's own guardian-identity rows; writes owner/principal/admin/admissions.
create policy guardian_students_select on public.guardian_students
  for select to authenticated
  using (
    app.has_role(institution_id, app.staff_roles())
    or student_id in (select app.guardian_student_ids(institution_id))
    or student_id = app.own_student_id(institution_id)
    or guardian_id in (
      select m.guardian_id
      from public.memberships m
      where m.user_id = app.current_user_id()
        and m.institution_id = guardian_students.institution_id
        and m.guardian_id is not null
    )
  );

create policy guardian_students_insert on public.guardian_students
  for insert to authenticated
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']));

create policy guardian_students_update on public.guardian_students
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']))
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']));
