-- 0138 — Study studio: AI-made study material (ten summary formats, flashcard
-- decks, mixed quizzes) for students and teachers, flashcard review state,
-- studio quiz attempts, study plans and study time.
--
-- Ownership model:
--   * study_materials: owned by the profile that saved it (user_id). A
--     student's material is private to that student (no staff, no guardian
--     read — same spirit as study_items, D32). A teacher's material is shared
--     to class sections through study_material_sections; enrolled students of
--     those sections read it; leaders read teacher material (aggregates).
--   * study_deck_progress / study_quiz_attempts / study_sessions: per student
--     (student_id). Student and linked guardians read (app.my_student_ids);
--     leaders read; a teacher reads rows only for their OWN shared material
--     and only for students they teach (engagement aggregates).
--   * study_plans: student writes own; student and linked guardians read.
-- Nothing here touches marks/results: studio quiz scores are practice only.
-- Helpers reused: app.current_user_id, app.my_institution_ids,
-- app.my_student_ids, app.my_taught_section_ids, app.my_taught_student_ids.
-- One new RLS helper: app.my_audience_study_material_ids (definer, initPlan).

-- ---------------------------------------------------------------------------
-- study_materials
-- ---------------------------------------------------------------------------

create table public.study_materials (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  user_id uuid not null references public.profiles (id) default app.current_user_id(),
  owner_role text not null check (owner_role in ('student', 'teacher')),
  format text not null check (format in (
    'quick_summary', 'revision_notes', 'cheat_sheet', 'key_concepts', 'glossary',
    'high_yield', 'exam_notes', 'one_page', 'active_recall', 'flashcards', 'quiz'
  )),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  subject_id uuid references public.subjects (id),
  curriculum_unit_id uuid references public.curriculum_units (id),
  source_kind text not null check (source_kind in ('unit', 'paste', 'resource', 'lesson_plan')),
  resource_id uuid references public.resources (id) on delete set null,
  -- Validated against the format's Zod schema by the save actions.
  content jsonb not null check (jsonb_typeof(content) = 'object' and pg_column_size(content) <= 131072),
  ai_generated boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index study_materials_owner_idx on public.study_materials (user_id, institution_id, updated_at desc);
create index study_materials_institution_role_idx on public.study_materials (institution_id, owner_role);
create index study_materials_subject_idx on public.study_materials (subject_id) where subject_id is not null;
create index study_materials_unit_idx on public.study_materials (curriculum_unit_id) where curriculum_unit_id is not null;
create index study_materials_resource_idx on public.study_materials (resource_id) where resource_id is not null;

create trigger set_updated_at
before update on public.study_materials
for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- study_material_sections — audience of a teacher's material
-- ---------------------------------------------------------------------------

create table public.study_material_sections (
  material_id uuid not null references public.study_materials (id) on delete cascade,
  institution_id uuid not null references public.institutions (id),
  class_section_id uuid not null references public.class_sections (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (material_id, class_section_id)
);

create index study_material_sections_section_idx on public.study_material_sections (class_section_id);
create index study_material_sections_institution_idx on public.study_material_sections (institution_id);

create trigger set_updated_at
before update on public.study_material_sections
for each row execute function app.set_updated_at();

-- Material ids shared to an active section of the caller's OWN student
-- membership (not a guardian's children: shared material is for students).
create function app.my_audience_study_material_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct sms.material_id
  from public.study_material_sections sms
  join public.enrolments e
    on e.class_section_id = sms.class_section_id
   and e.institution_id = sms.institution_id
   and e.status = 'active'
  join public.memberships m
    on m.student_id = e.student_id
   and m.institution_id = e.institution_id
  where m.user_id = app.current_user_id()
    and m.status = 'active';
$$;

revoke execute on function app.my_audience_study_material_ids() from public;
grant execute on function app.my_audience_study_material_ids() to authenticated;
comment on function app.my_audience_study_material_ids() is
  'RLS perf helper: study_materials ids shared to an active section of the caller''s own student enrolment. Called as (select app.my_audience_study_material_ids()) inside the study_materials policy.';

-- ---------------------------------------------------------------------------
-- study_deck_progress — one row per (flashcard deck, student); `state` maps
-- card id -> scheduler state (src/modules/study/srs.ts).
-- ---------------------------------------------------------------------------

create table public.study_deck_progress (
  material_id uuid not null references public.study_materials (id) on delete cascade,
  institution_id uuid not null references public.institutions (id),
  student_id uuid not null references public.students (id),
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object' and pg_column_size(state) <= 65536),
  reviews int not null default 0 check (reviews >= 0),
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (material_id, student_id)
);

create index study_deck_progress_student_idx on public.study_deck_progress (student_id);
create index study_deck_progress_institution_idx on public.study_deck_progress (institution_id);

create trigger set_updated_at
before update on public.study_deck_progress
for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- study_quiz_attempts — insert-only. auto_score is recomputed by the action
-- from the answer keys (self-attested, like practice_attempts); ai_points are
-- AI-checked short answers. Practice only: never marks or results.
-- ---------------------------------------------------------------------------

create table public.study_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  student_id uuid not null references public.students (id),
  material_id uuid references public.study_materials (id) on delete set null,
  subject_id uuid references public.subjects (id),
  curriculum_unit_id uuid references public.curriculum_units (id),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  questions jsonb not null check (jsonb_typeof(questions) = 'array' and pg_column_size(questions) <= 65536),
  answers jsonb not null check (jsonb_typeof(answers) = 'array' and pg_column_size(answers) <= 16384),
  ai_checks jsonb not null default '[]'::jsonb check (jsonb_typeof(ai_checks) = 'array' and pg_column_size(ai_checks) <= 32768),
  auto_score int not null check (auto_score >= 0),
  auto_max int not null check (auto_max >= 0),
  ai_points int not null default 0 check (ai_points >= 0),
  ai_max int not null default 0 check (ai_max >= 0),
  duration_seconds int check (duration_seconds between 0 and 14400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (auto_score <= auto_max and ai_points <= ai_max and auto_max + ai_max between 1 and 60)
);

create index study_quiz_attempts_student_idx on public.study_quiz_attempts (student_id, created_at desc);
create index study_quiz_attempts_material_idx on public.study_quiz_attempts (material_id) where material_id is not null;
create index study_quiz_attempts_institution_idx on public.study_quiz_attempts (institution_id);
create index study_quiz_attempts_subject_idx on public.study_quiz_attempts (subject_id) where subject_id is not null;
create index study_quiz_attempts_unit_idx on public.study_quiz_attempts (curriculum_unit_id) where curriculum_unit_id is not null;

create trigger set_updated_at
before update on public.study_quiz_attempts
for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- study_plans — day-by-day items as JSON (src/modules/study/planner.ts).
-- ---------------------------------------------------------------------------

create table public.study_plans (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  student_id uuid not null references public.students (id),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  -- Label copied from the student's upcoming exam paper (or typed); no FK:
  -- students cannot read exam_papers under RLS.
  exam_label text check (exam_label is null or char_length(exam_label) between 1 and 160),
  start_date date not null,
  target_date date not null,
  minutes_per_day int not null check (minutes_per_day between 10 and 480),
  status text not null default 'active' check (status in ('active', 'archived')),
  items jsonb not null check (jsonb_typeof(items) = 'array' and pg_column_size(items) <= 65536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (target_date >= start_date and target_date <= start_date + 366)
);

create unique index study_plans_one_active_idx on public.study_plans (student_id) where status = 'active';
create index study_plans_institution_idx on public.study_plans (institution_id);

create trigger set_updated_at
before update on public.study_plans
for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- study_sessions — insert-only study time log.
-- ---------------------------------------------------------------------------

create table public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  student_id uuid not null references public.students (id),
  activity text not null check (activity in ('flashcards', 'quiz', 'reading', 'plan')),
  minutes int not null check (minutes between 1 and 240),
  subject_id uuid references public.subjects (id),
  material_id uuid references public.study_materials (id) on delete set null,
  started_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index study_sessions_student_idx on public.study_sessions (student_id, started_at desc);
create index study_sessions_institution_idx on public.study_sessions (institution_id);
create index study_sessions_material_idx on public.study_sessions (material_id) where material_id is not null;
create index study_sessions_subject_idx on public.study_sessions (subject_id) where subject_id is not null;

create trigger set_updated_at
before update on public.study_sessions
for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.study_materials enable row level security;
alter table public.study_material_sections enable row level security;
alter table public.study_deck_progress enable row level security;
alter table public.study_quiz_attempts enable row level security;
alter table public.study_plans enable row level security;
alter table public.study_sessions enable row level security;

-- study_materials ------------------------------------------------------------

create policy study_materials_select on public.study_materials
  for select to authenticated
  using (
    (
      study_materials.user_id = (select app.current_user_id())
      and study_materials.institution_id = any((select app.my_institution_ids(array['student', 'teacher'])))
    )
    or study_materials.id = any((select app.my_audience_study_material_ids()))
    or (
      study_materials.owner_role = 'teacher'
      and study_materials.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    )
  );

create policy study_materials_insert on public.study_materials
  for insert to authenticated
  with check (
    study_materials.user_id = (select app.current_user_id())
    and (
      (study_materials.owner_role = 'student' and study_materials.institution_id = any((select app.my_institution_ids(array['student']))))
      or (study_materials.owner_role = 'teacher' and study_materials.institution_id = any((select app.my_institution_ids(array['teacher']))))
    )
    and (
      study_materials.subject_id is null
      or exists (select 1 from public.subjects su where su.id = study_materials.subject_id and su.institution_id = study_materials.institution_id)
    )
    and (
      study_materials.curriculum_unit_id is null
      or exists (
        select 1 from public.curriculum_units cu
        where cu.id = study_materials.curriculum_unit_id and cu.institution_id = study_materials.institution_id
      )
    )
    and (
      study_materials.resource_id is null
      or exists (select 1 from public.resources r where r.id = study_materials.resource_id and r.institution_id = study_materials.institution_id)
    )
  );

-- Column grant below limits UPDATE to title + content.
create policy study_materials_update on public.study_materials
  for update to authenticated
  using (study_materials.user_id = (select app.current_user_id()))
  with check (
    study_materials.user_id = (select app.current_user_id())
    and study_materials.institution_id = any((select app.my_institution_ids(array['student', 'teacher'])))
  );

create policy study_materials_delete on public.study_materials
  for delete to authenticated
  using (study_materials.user_id = (select app.current_user_id()));

revoke all on public.study_materials from anon, authenticated;
grant select, insert, delete on public.study_materials to authenticated;
grant update (title, content) on public.study_materials to authenticated;
grant select, insert, update, delete on public.study_materials to service_role;

-- study_material_sections ----------------------------------------------------

-- Visible exactly when the parent material is (study_materials RLS composes).
create policy study_material_sections_select on public.study_material_sections
  for select to authenticated
  using (
    exists (
      select 1 from public.study_materials m
      where m.id = study_material_sections.material_id
        and m.institution_id = study_material_sections.institution_id
    )
  );

create policy study_material_sections_insert on public.study_material_sections
  for insert to authenticated
  with check (
    study_material_sections.institution_id = any((select app.my_institution_ids(array['teacher'])))
    and study_material_sections.class_section_id = any((select app.my_taught_section_ids()))
    and exists (
      select 1 from public.class_sections cs
      where cs.id = study_material_sections.class_section_id
        and cs.institution_id = study_material_sections.institution_id
    )
    and exists (
      select 1 from public.study_materials m
      where m.id = study_material_sections.material_id
        and m.institution_id = study_material_sections.institution_id
        and m.user_id = (select app.current_user_id())
        and m.owner_role = 'teacher'
    )
  );

create policy study_material_sections_delete on public.study_material_sections
  for delete to authenticated
  using (
    exists (
      select 1 from public.study_materials m
      where m.id = study_material_sections.material_id
        and m.institution_id = study_material_sections.institution_id
        and m.user_id = (select app.current_user_id())
        and m.owner_role = 'teacher'
    )
  );

revoke all on public.study_material_sections from anon, authenticated;
grant select, insert, delete on public.study_material_sections to authenticated;
grant select, insert, update, delete on public.study_material_sections to service_role;

-- study_deck_progress --------------------------------------------------------

create policy study_deck_progress_select on public.study_deck_progress
  for select to authenticated
  using (
    study_deck_progress.student_id = any((select app.my_student_ids()))
    or study_deck_progress.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or (
      study_deck_progress.student_id = any((select app.my_taught_student_ids()))
      and study_deck_progress.material_id in (
        select m.id from public.study_materials m
        where m.user_id = (select app.current_user_id()) and m.owner_role = 'teacher'
      )
    )
  );

create policy study_deck_progress_insert on public.study_deck_progress
  for insert to authenticated
  with check (
    study_deck_progress.student_id = any((select app.my_student_ids()))
    and study_deck_progress.institution_id = any((select app.my_institution_ids(array['student'])))
    and exists (
      select 1 from public.students s
      where s.id = study_deck_progress.student_id and s.institution_id = study_deck_progress.institution_id
    )
    and exists (
      select 1 from public.study_materials m
      where m.id = study_deck_progress.material_id
        and m.institution_id = study_deck_progress.institution_id
        and m.format = 'flashcards'
    )
  );

-- Column grant below limits UPDATE to the review state.
create policy study_deck_progress_update on public.study_deck_progress
  for update to authenticated
  using (
    study_deck_progress.student_id = any((select app.my_student_ids()))
    and study_deck_progress.institution_id = any((select app.my_institution_ids(array['student'])))
  )
  with check (
    study_deck_progress.student_id = any((select app.my_student_ids()))
    and study_deck_progress.institution_id = any((select app.my_institution_ids(array['student'])))
  );

create policy study_deck_progress_delete on public.study_deck_progress
  for delete to authenticated
  using (
    study_deck_progress.student_id = any((select app.my_student_ids()))
    and study_deck_progress.institution_id = any((select app.my_institution_ids(array['student'])))
  );

revoke all on public.study_deck_progress from anon, authenticated;
grant select, insert, delete on public.study_deck_progress to authenticated;
grant update (state, reviews, last_reviewed_at) on public.study_deck_progress to authenticated;
grant select, insert, update, delete on public.study_deck_progress to service_role;

-- study_quiz_attempts --------------------------------------------------------

create policy study_quiz_attempts_select on public.study_quiz_attempts
  for select to authenticated
  using (
    study_quiz_attempts.student_id = any((select app.my_student_ids()))
    or study_quiz_attempts.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or (
      study_quiz_attempts.student_id = any((select app.my_taught_student_ids()))
      and study_quiz_attempts.material_id in (
        select m.id from public.study_materials m
        where m.user_id = (select app.current_user_id()) and m.owner_role = 'teacher'
      )
    )
  );

create policy study_quiz_attempts_insert on public.study_quiz_attempts
  for insert to authenticated
  with check (
    study_quiz_attempts.student_id = any((select app.my_student_ids()))
    and study_quiz_attempts.institution_id = any((select app.my_institution_ids(array['student'])))
    and exists (
      select 1 from public.students s
      where s.id = study_quiz_attempts.student_id and s.institution_id = study_quiz_attempts.institution_id
    )
    and (
      study_quiz_attempts.material_id is null
      or exists (
        select 1 from public.study_materials m
        where m.id = study_quiz_attempts.material_id
          and m.institution_id = study_quiz_attempts.institution_id
          and m.format = 'quiz'
      )
    )
    and (
      study_quiz_attempts.subject_id is null
      or exists (select 1 from public.subjects su where su.id = study_quiz_attempts.subject_id and su.institution_id = study_quiz_attempts.institution_id)
    )
    and (
      study_quiz_attempts.curriculum_unit_id is null
      or exists (
        select 1 from public.curriculum_units cu
        where cu.id = study_quiz_attempts.curriculum_unit_id and cu.institution_id = study_quiz_attempts.institution_id
      )
    )
  );

revoke all on public.study_quiz_attempts from anon, authenticated;
grant select, insert on public.study_quiz_attempts to authenticated;
grant select, insert, update, delete on public.study_quiz_attempts to service_role;

-- study_plans ----------------------------------------------------------------

create policy study_plans_select on public.study_plans
  for select to authenticated
  using (study_plans.student_id = any((select app.my_student_ids())));

create policy study_plans_insert on public.study_plans
  for insert to authenticated
  with check (
    study_plans.student_id = any((select app.my_student_ids()))
    and study_plans.institution_id = any((select app.my_institution_ids(array['student'])))
    and exists (
      select 1 from public.students s
      where s.id = study_plans.student_id and s.institution_id = study_plans.institution_id
    )
  );

-- Column grant below limits UPDATE to the plan's own content and status.
create policy study_plans_update on public.study_plans
  for update to authenticated
  using (
    study_plans.student_id = any((select app.my_student_ids()))
    and study_plans.institution_id = any((select app.my_institution_ids(array['student'])))
  )
  with check (
    study_plans.student_id = any((select app.my_student_ids()))
    and study_plans.institution_id = any((select app.my_institution_ids(array['student'])))
  );

create policy study_plans_delete on public.study_plans
  for delete to authenticated
  using (
    study_plans.student_id = any((select app.my_student_ids()))
    and study_plans.institution_id = any((select app.my_institution_ids(array['student'])))
  );

revoke all on public.study_plans from anon, authenticated;
grant select, insert, delete on public.study_plans to authenticated;
grant update (title, items, status) on public.study_plans to authenticated;
grant select, insert, update, delete on public.study_plans to service_role;

-- study_sessions -------------------------------------------------------------

create policy study_sessions_select on public.study_sessions
  for select to authenticated
  using (
    study_sessions.student_id = any((select app.my_student_ids()))
    or study_sessions.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
  );

create policy study_sessions_insert on public.study_sessions
  for insert to authenticated
  with check (
    study_sessions.student_id = any((select app.my_student_ids()))
    and study_sessions.institution_id = any((select app.my_institution_ids(array['student'])))
    and exists (
      select 1 from public.students s
      where s.id = study_sessions.student_id and s.institution_id = study_sessions.institution_id
    )
    and (
      study_sessions.subject_id is null
      or exists (select 1 from public.subjects su where su.id = study_sessions.subject_id and su.institution_id = study_sessions.institution_id)
    )
    and (
      study_sessions.material_id is null
      or exists (
        select 1 from public.study_materials m
        where m.id = study_sessions.material_id and m.institution_id = study_sessions.institution_id
      )
    )
  );

revoke all on public.study_sessions from anon, authenticated;
grant select, insert on public.study_sessions to authenticated;
grant select, insert, update, delete on public.study_sessions to service_role;

-- ---------------------------------------------------------------------------
-- public.enqueue_study_reminders — runner sweep (M20 enqueue_mastery_compute
-- pattern): once per local day per institution with the student AI module
-- on, enqueue `notify.study_reminders`. The handler notifies (in-app) only
-- students who use the studio: flashcards due, today's plan items, and an
-- exam paper within 3 days.
-- ---------------------------------------------------------------------------

create function public.enqueue_study_reminders()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_institution record;
  v_count int := 0;
begin
  for v_institution in
    select i.id, coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata') as tz
    from public.institutions i
    where app.module_enabled(i.id, 'ai_student')
  loop
    perform app.enqueue_job(
      v_institution.id,
      'notify.study_reminders',
      '{}'::jsonb,
      'notify.study_reminders:' || v_institution.id || ':' || to_char((now() at time zone v_institution.tz)::date, 'YYYYMMDD')
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.enqueue_study_reminders() from public, anon, authenticated;
grant execute on function public.enqueue_study_reminders() to service_role;
