-- T-011: grades, class_sections, subjects, subject_assignments, enrolments,
-- enrolment_status_history, curriculum_units, assignments,
-- assignment_submissions + RLS. This is where app.teaches_section (0001) and
-- app.teacher_sees_guardian (0004) resolve for real — both referenced these
-- tables before they existed.

create table public.grades (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  code text not null,
  display_name text not null,
  sort_key int not null,
  grade_group text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, code)
);

create trigger set_updated_at
before update on public.grades
for each row execute function app.set_updated_at();

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  code text not null,
  name text not null,
  kind text not null check (kind in ('scholastic', 'co_scholastic', 'skill', 'language')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, code)
);

create trigger set_updated_at
before update on public.subjects
for each row execute function app.set_updated_at();

create table public.class_sections (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  grade_id uuid not null references public.grades (id),
  academic_year_id uuid not null references public.academic_years (id),
  name text not null,
  class_teacher_id uuid references public.staff (id),
  capacity int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (grade_id, academic_year_id, name)
);

create index class_sections_class_teacher_idx on public.class_sections (class_teacher_id);

create function app.set_class_section_capacity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_capacity int;
begin
  if new.capacity is null then
    select coalesce((settings -> 'academic' ->> 'max_section_size')::int, 40) into v_capacity
    from public.institutions where id = new.institution_id;
    new.capacity := v_capacity;
  end if;
  return new;
end;
$$;

revoke execute on function app.set_class_section_capacity() from public;

create trigger set_capacity
before insert on public.class_sections
for each row execute function app.set_class_section_capacity();

create trigger set_updated_at
before update on public.class_sections
for each row execute function app.set_updated_at();

create table public.subject_assignments (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  class_section_id uuid not null references public.class_sections (id),
  subject_id uuid not null references public.subjects (id),
  teacher_id uuid not null references public.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_section_id, subject_id)
);

create index subject_assignments_teacher_idx on public.subject_assignments (teacher_id);

create trigger set_updated_at
before update on public.subject_assignments
for each row execute function app.set_updated_at();

create table public.enrolments (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  student_id uuid not null references public.students (id),
  class_section_id uuid not null references public.class_sections (id),
  academic_year_id uuid not null references public.academic_years (id),
  roll_no int,
  status text not null default 'active' check (status in ('active', 'transferred', 'completed', 'withdrawn')),
  started_on date not null,
  ended_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index enrolments_one_active_per_year_idx on public.enrolments (student_id, academic_year_id) where status = 'active';
create unique index enrolments_one_roll_no_per_section_idx on public.enrolments (class_section_id, roll_no) where roll_no is not null and status = 'active';
create index enrolments_section_status_idx on public.enrolments (class_section_id, status);

create trigger set_updated_at
before update on public.enrolments
for each row execute function app.set_updated_at();

create table public.enrolment_status_history (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  enrolment_id uuid not null references public.enrolments (id),
  from_status text,
  to_status text not null,
  reason text,
  changed_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index enrolment_status_history_enrolment_idx on public.enrolment_status_history (enrolment_id);

create trigger block_mutation
before update or delete on public.enrolment_status_history
for each row execute function app.block_mutation();

create function app.enrolment_status_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.enrolment_status_history (institution_id, enrolment_id, from_status, to_status, changed_by)
    values (new.institution_id, new.id, old.status, new.status, app.current_user_id());
  end if;
  return new;
end;
$$;

revoke execute on function app.enrolment_status_changed() from public;

create trigger enrolment_status_changed
after update on public.enrolments
for each row execute function app.enrolment_status_changed();

create table public.curriculum_units (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  subject_id uuid not null references public.subjects (id),
  grade_id uuid not null references public.grades (id),
  title text not null,
  description text,
  sequence int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_id, grade_id, sequence)
);

create trigger set_updated_at
before update on public.curriculum_units
for each row execute function app.set_updated_at();

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  class_section_id uuid not null references public.class_sections (id),
  subject_id uuid not null references public.subjects (id),
  curriculum_unit_id uuid references public.curriculum_units (id),
  title text not null,
  instructions text,
  content jsonb,
  due_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  created_by uuid not null references public.staff (id),
  ai_generated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index assignments_section_status_idx on public.assignments (class_section_id, status);

create trigger set_updated_at
before update on public.assignments
for each row execute function app.set_updated_at();

create table public.assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  assignment_id uuid not null references public.assignments (id),
  student_id uuid not null references public.students (id),
  submitted_at timestamptz not null default now(),
  content jsonb,
  score numeric,
  feedback text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, student_id)
);

create trigger set_updated_at
before update on public.assignment_submissions
for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.grades enable row level security;
alter table public.subjects enable row level security;
alter table public.class_sections enable row level security;
alter table public.subject_assignments enable row level security;
alter table public.enrolments enable row level security;
alter table public.enrolment_status_history enable row level security;
alter table public.curriculum_units enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_submissions enable row level security;

-- grades/subjects: institution-wide reference data (the class ladder and
-- subject catalog), not tied to any one section — every member reads them;
-- only owner/principal/admin manage them.
create policy grades_select on public.grades
  for select to authenticated
  using (app.is_member(institution_id));

create policy grades_insert on public.grades
  for insert to authenticated
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy grades_update on public.grades
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy subjects_select on public.subjects
  for select to authenticated
  using (app.is_member(institution_id));

create policy subjects_insert on public.subjects
  for insert to authenticated
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy subjects_update on public.subjects
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

-- class_sections: staff roles, or the caller's own linked child's/own active section.
create policy class_sections_select on public.class_sections
  for select to authenticated
  using (
    app.has_role(institution_id, app.staff_roles())
    or exists (
      select 1 from public.enrolments e
      where e.class_section_id = class_sections.id
        and e.status = 'active'
        and (
          e.student_id in (select app.guardian_student_ids(class_sections.institution_id))
          or e.student_id = app.own_student_id(class_sections.institution_id)
        )
    )
  );

create policy class_sections_insert on public.class_sections
  for insert to authenticated
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy class_sections_update on public.class_sections
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

-- subject_assignments: same scoping as class_sections, via the section they're attached to.
create policy subject_assignments_select on public.subject_assignments
  for select to authenticated
  using (
    app.has_role(institution_id, app.staff_roles())
    or exists (
      select 1 from public.enrolments e
      where e.class_section_id = subject_assignments.class_section_id
        and e.status = 'active'
        and (
          e.student_id in (select app.guardian_student_ids(subject_assignments.institution_id))
          or e.student_id = app.own_student_id(subject_assignments.institution_id)
        )
    )
  );

create policy subject_assignments_insert on public.subject_assignments
  for insert to authenticated
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy subject_assignments_update on public.subject_assignments
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

-- curriculum_units: tied to grade, not section — scoped via the caller's own active enrolment's grade.
create policy curriculum_units_select on public.curriculum_units
  for select to authenticated
  using (
    app.has_role(institution_id, app.staff_roles())
    or exists (
      select 1
      from public.enrolments e
      join public.class_sections cs on cs.id = e.class_section_id
      where cs.grade_id = curriculum_units.grade_id
        and e.status = 'active'
        and (
          e.student_id in (select app.guardian_student_ids(curriculum_units.institution_id))
          or e.student_id = app.own_student_id(curriculum_units.institution_id)
        )
    )
  );

create policy curriculum_units_insert on public.curriculum_units
  for insert to authenticated
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy curriculum_units_update on public.curriculum_units
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

-- enrolments: class S+G; writes owner/principal/admin/admissions; no DELETE.
create policy enrolments_select on public.enrolments
  for select to authenticated
  using (
    app.has_role(institution_id, app.staff_roles())
    or student_id in (select app.guardian_student_ids(institution_id))
    or student_id = app.own_student_id(institution_id)
  );

create policy enrolments_insert on public.enrolments
  for insert to authenticated
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']));

create policy enrolments_update on public.enrolments
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']))
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']));

-- enrolment_status_history: read as enrolments; writes via trigger only.
create policy enrolment_status_history_select on public.enrolment_status_history
  for select to authenticated
  using (
    app.has_role(institution_id, app.staff_roles())
    or exists (
      select 1 from public.enrolments e
      where e.id = enrolment_status_history.enrolment_id
        and (
          e.student_id in (select app.guardian_student_ids(enrolment_status_history.institution_id))
          or e.student_id = app.own_student_id(enrolment_status_history.institution_id)
        )
    )
  );

-- assignments: staff roles see all; guardian/student see only published for their own section;
-- writes by owner/principal, or the teacher of that section.
create policy assignments_select on public.assignments
  for select to authenticated
  using (
    app.has_role(institution_id, app.staff_roles())
    or (
      status = 'published'
      and exists (
        select 1 from public.enrolments e
        where e.class_section_id = assignments.class_section_id
          and e.status = 'active'
          and (
            e.student_id in (select app.guardian_student_ids(assignments.institution_id))
            or e.student_id = app.own_student_id(assignments.institution_id)
          )
      )
    )
  );

create policy assignments_insert on public.assignments
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal'])
    or app.teaches_section(institution_id, class_section_id)
  );

create policy assignments_update on public.assignments
  for update to authenticated
  using (
    app.has_role(institution_id, array['owner', 'principal'])
    or app.teaches_section(institution_id, class_section_id)
  )
  with check (
    app.has_role(institution_id, array['owner', 'principal'])
    or app.teaches_section(institution_id, class_section_id)
  );

-- assignment_submissions: own student/guardian read; teacher of the section reads; writes own student only.
create policy assignment_submissions_select on public.assignment_submissions
  for select to authenticated
  using (
    student_id in (select app.guardian_student_ids(institution_id))
    or student_id = app.own_student_id(institution_id)
    or exists (
      select 1 from public.assignments a
      where a.id = assignment_submissions.assignment_id
        and app.teaches_section(assignment_submissions.institution_id, a.class_section_id)
    )
  );

create policy assignment_submissions_insert on public.assignment_submissions
  for insert to authenticated
  with check (student_id = app.own_student_id(institution_id));

create policy assignment_submissions_update on public.assignment_submissions
  for update to authenticated
  using (student_id = app.own_student_id(institution_id))
  with check (student_id = app.own_student_id(institution_id));
