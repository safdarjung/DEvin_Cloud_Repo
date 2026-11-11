-- Features-18 #5: health module (`health`, default on).
--
-- Tables:    public.health_profiles (one per student), public.health_visits
--            (infirmary log), public.vaccinations
-- Functions: none — plain CRUD under RLS; no state machine.
--
-- RLS matrix (M = owner/principal/admin; same for all three tables):
--   role                  select                       insert   update                     delete
--   M                     all rows of the institution  yes      yes (see column grants)    no
--   guardian              own children only            no       no                         no
--                         (app.my_guardian_student_ids)
--   teacher, student,     none                         no       no                         no
--   other staff roles
--
-- Teachers never read health (SPEC role guidance). Students do not read
-- their own record (SPEC: guardian only). No DELETE anywhere (medical
-- record); mistakes are corrected by update. All three tables grant UPDATE
-- only on the clinical columns, so student_id, institution_id and
-- recorded_by are immutable after insert.
--
-- Reuses (never redefines): app.set_updated_at, app.current_user_id,
-- app.my_institution_ids (0020), app.my_guardian_student_ids (0090),
-- app.module_catalog (0084).

insert into app.module_catalog (key, default_enabled) values ('health', true)
on conflict (key) do update set default_enabled = excluded.default_enabled;

-- ---------------------------------------------------------------------------
-- health_profiles — one row per student.
-- ---------------------------------------------------------------------------

create table public.health_profiles (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  student_id uuid not null references public.students (id),
  blood_group text check (blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  allergies text check (char_length(allergies) <= 500),
  conditions text check (char_length(conditions) <= 500),
  emergency_note text check (char_length(emergency_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint health_profiles_student_key unique (student_id)
);

create index health_profiles_institution_idx on public.health_profiles (institution_id);

create trigger set_updated_at
before update on public.health_profiles
for each row execute function app.set_updated_at();

alter table public.health_profiles enable row level security;

create policy health_profiles_select on public.health_profiles
  for select to authenticated
  using (
    health_profiles.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or health_profiles.student_id = any((select app.my_guardian_student_ids()))
  );

create policy health_profiles_insert on public.health_profiles
  for insert to authenticated
  with check (
    health_profiles.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    and exists (
      select 1 from public.students s
      where s.id = health_profiles.student_id and s.institution_id = health_profiles.institution_id
    )
  );

create policy health_profiles_update on public.health_profiles
  for update to authenticated
  using (health_profiles.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))))
  with check (health_profiles.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

-- UPDATE on clinical columns only (student/institution fixed after insert).
-- Note: PostgREST upsert on this table would need UPDATE on student_id too —
-- callers insert, then update by id.
revoke all on public.health_profiles from anon, authenticated;
grant select, insert on public.health_profiles to authenticated;
grant update (blood_group, allergies, conditions, emergency_note) on public.health_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- health_visits — infirmary visit log.
-- ---------------------------------------------------------------------------

create table public.health_visits (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  student_id uuid not null references public.students (id),
  visited_at timestamptz not null default now(),
  complaint text not null check (char_length(complaint) between 1 and 300),
  treatment text check (char_length(treatment) <= 500),
  outcome text not null default 'returned_to_class'
    check (outcome in ('returned_to_class', 'rested', 'sent_home', 'referred')),
  recorded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index health_visits_institution_visited_idx on public.health_visits (institution_id, visited_at desc);
create index health_visits_student_visited_idx on public.health_visits (student_id, visited_at desc);

create trigger set_updated_at
before update on public.health_visits
for each row execute function app.set_updated_at();

alter table public.health_visits enable row level security;

create policy health_visits_select on public.health_visits
  for select to authenticated
  using (
    health_visits.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or health_visits.student_id = any((select app.my_guardian_student_ids()))
  );

create policy health_visits_insert on public.health_visits
  for insert to authenticated
  with check (
    health_visits.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    and health_visits.recorded_by = (select app.current_user_id())
    and exists (
      select 1 from public.students s
      where s.id = health_visits.student_id and s.institution_id = health_visits.institution_id
    )
  );

create policy health_visits_update on public.health_visits
  for update to authenticated
  using (health_visits.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))))
  with check (health_visits.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

revoke all on public.health_visits from anon, authenticated;
grant select, insert on public.health_visits to authenticated;
grant update (visited_at, complaint, treatment, outcome) on public.health_visits to authenticated;

-- ---------------------------------------------------------------------------
-- vaccinations — one row per dose given.
-- ---------------------------------------------------------------------------

create table public.vaccinations (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  student_id uuid not null references public.students (id),
  vaccine text not null check (char_length(vaccine) between 1 and 80),
  dose text check (char_length(dose) between 1 and 20),
  administered_on date not null,
  notes text check (char_length(notes) <= 300),
  recorded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index vaccinations_institution_idx on public.vaccinations (institution_id);
create index vaccinations_student_administered_idx on public.vaccinations (student_id, administered_on desc);

create trigger set_updated_at
before update on public.vaccinations
for each row execute function app.set_updated_at();

alter table public.vaccinations enable row level security;

create policy vaccinations_select on public.vaccinations
  for select to authenticated
  using (
    vaccinations.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or vaccinations.student_id = any((select app.my_guardian_student_ids()))
  );

create policy vaccinations_insert on public.vaccinations
  for insert to authenticated
  with check (
    vaccinations.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    and vaccinations.recorded_by = (select app.current_user_id())
    and exists (
      select 1 from public.students s
      where s.id = vaccinations.student_id and s.institution_id = vaccinations.institution_id
    )
  );

create policy vaccinations_update on public.vaccinations
  for update to authenticated
  using (vaccinations.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))))
  with check (vaccinations.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

revoke all on public.vaccinations from anon, authenticated;
grant select, insert on public.vaccinations to authenticated;
grant update (vaccine, dose, administered_on, notes) on public.vaccinations to authenticated;
