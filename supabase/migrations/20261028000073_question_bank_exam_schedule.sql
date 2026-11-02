-- M11-T2: question_bank (new owning module `question-bank`) + exam_papers
-- schedule columns (05 §3, §4; 07 §2.2 `question.manage`; M11 rulings).
--
-- question_bank: class C (staff-only, no guardian/student/admin/admissions/
-- accountant policy), initPlan style (lesson 7). SELECT/INSERT/UPDATE are
-- owner/principal/exam_controller institution-wide, or a teacher scoped to
-- the (grade, subject) pairs they teach — `app.my_taught_section_subjects()`
-- returns (class_section_id, subject_id); joined to class_sections for its
-- grade_id, since question_bank is graded directly, not per-section (a
-- question is reused across every section of a grade). No DELETE policy —
-- archive is `is_active = false` (packet). institution_id/created_by are
-- immutable via the column grant below (0037 precedent), not a trigger.
--
-- exam_papers: adds nullable schedule columns (scheduled_at/duration_
-- minutes/room_id) and rebinds `exam_papers_insert`/`_update` (0009) to also
-- check the room against the paper's institution — SELECT (staff-wide) is
-- untouched. Scheduling is advisory, not a DB-level overlap constraint
-- (M11 rulings "Schedule is not a constraint") — conflict detection is
-- T6/T7's application-layer job.

create table public.question_bank (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  subject_id uuid not null references public.subjects (id),
  grade_id uuid not null references public.grades (id),
  curriculum_unit_id uuid references public.curriculum_units (id),
  type text not null check (type in ('mcq', 'true_false', 'short_answer', 'long_answer')),
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  body text not null check (char_length(body) between 1 and 4000),
  options jsonb,
  answer text not null check (char_length(answer) between 1 and 4000),
  marks numeric(5, 2) not null default 1 check (marks > 0 and marks <= 100),
  is_active boolean not null default true,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    case
      when type = 'mcq' then options is not null and jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6
      else options is null
    end
  )
);

create index question_bank_scope_idx on public.question_bank (institution_id, grade_id, subject_id) where is_active;

create trigger set_updated_at
before update on public.question_bank
for each row execute function app.set_updated_at();

alter table public.question_bank enable row level security;

create policy question_bank_select on public.question_bank
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'exam_controller'])))
    or (question_bank.grade_id, question_bank.subject_id) in (
      select cs.grade_id, t.subject_id
      from app.my_taught_section_subjects() t
      join public.class_sections cs on cs.id = t.class_section_id
    )
  );

create policy question_bank_insert on public.question_bank
  for insert to authenticated
  with check (
    created_by = (select app.current_user_id())
    and exists (select 1 from public.subjects s where s.id = question_bank.subject_id and s.institution_id = question_bank.institution_id)
    and exists (select 1 from public.grades g where g.id = question_bank.grade_id and g.institution_id = question_bank.institution_id)
    and (
      question_bank.curriculum_unit_id is null
      or exists (
        select 1 from public.curriculum_units cu
        where cu.id = question_bank.curriculum_unit_id
          and cu.institution_id = question_bank.institution_id
          and cu.subject_id = question_bank.subject_id
          and cu.grade_id = question_bank.grade_id
      )
    )
    and (
      institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'exam_controller'])))
      or (question_bank.grade_id, question_bank.subject_id) in (
        select cs.grade_id, t.subject_id
        from app.my_taught_section_subjects() t
        join public.class_sections cs on cs.id = t.class_section_id
      )
    )
  );

create policy question_bank_update on public.question_bank
  for update to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'exam_controller'])))
    or (
      created_by = (select app.current_user_id())
      and (question_bank.grade_id, question_bank.subject_id) in (
        select cs.grade_id, t.subject_id
        from app.my_taught_section_subjects() t
        join public.class_sections cs on cs.id = t.class_section_id
      )
    )
  )
  with check (
    exists (select 1 from public.subjects s where s.id = question_bank.subject_id and s.institution_id = question_bank.institution_id)
    and exists (select 1 from public.grades g where g.id = question_bank.grade_id and g.institution_id = question_bank.institution_id)
    and (
      question_bank.curriculum_unit_id is null
      or exists (
        select 1 from public.curriculum_units cu
        where cu.id = question_bank.curriculum_unit_id
          and cu.institution_id = question_bank.institution_id
          and cu.subject_id = question_bank.subject_id
          and cu.grade_id = question_bank.grade_id
      )
    )
    and (
      institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'exam_controller'])))
      or (
        created_by = (select app.current_user_id())
        and (question_bank.grade_id, question_bank.subject_id) in (
          select cs.grade_id, t.subject_id
          from app.my_taught_section_subjects() t
          join public.class_sections cs on cs.id = t.class_section_id
        )
      )
    )
  );

-- institution_id/created_by immutable: excluded from the column grant
-- (0037 precedent), so a direct PostgREST update touching either column
-- is rejected at the grant layer (42501) before RLS even runs.
revoke update on public.question_bank from anon, authenticated;
grant update (subject_id, grade_id, curriculum_unit_id, type, difficulty, body, options, answer, marks, is_active) on public.question_bank to authenticated;

-- ---------------------------------------------------------------------------
-- exam_papers (0009): schedule columns + rebound insert/update policies.
-- ---------------------------------------------------------------------------

alter table public.exam_papers
  add column scheduled_at timestamptz,
  add column duration_minutes int,
  add column room_id uuid references public.rooms (id);

alter table public.exam_papers
  add constraint exam_papers_duration_minutes_check check (duration_minutes is null or duration_minutes between 15 and 300),
  add constraint exam_papers_schedule_pair_check check ((scheduled_at is null) = (duration_minutes is null)),
  add constraint exam_papers_room_requires_schedule_check check (room_id is null or scheduled_at is not null);

create index exam_papers_room_schedule_idx on public.exam_papers (room_id, scheduled_at) where room_id is not null;

drop policy exam_papers_insert on public.exam_papers;
create policy exam_papers_insert on public.exam_papers
  for insert to authenticated
  with check (
    institution_id = any((select app.my_institution_ids(app.exam_write_roles())))
    and exists (select 1 from public.exams e where e.id = exam_papers.exam_id and e.institution_id = exam_papers.institution_id)
    and exists (select 1 from public.class_sections cs where cs.id = exam_papers.class_section_id and cs.institution_id = exam_papers.institution_id)
    and exists (select 1 from public.subjects s where s.id = exam_papers.subject_id and s.institution_id = exam_papers.institution_id)
    and (
      exam_papers.room_id is null
      or exists (select 1 from public.rooms r where r.id = exam_papers.room_id and r.institution_id = exam_papers.institution_id)
    )
  );

drop policy exam_papers_update on public.exam_papers;
create policy exam_papers_update on public.exam_papers
  for update to authenticated
  using (institution_id = any((select app.my_institution_ids(app.exam_write_roles()))))
  with check (
    institution_id = any((select app.my_institution_ids(app.exam_write_roles())))
    and exists (select 1 from public.exams e where e.id = exam_papers.exam_id and e.institution_id = exam_papers.institution_id)
    and exists (select 1 from public.class_sections cs where cs.id = exam_papers.class_section_id and cs.institution_id = exam_papers.institution_id)
    and exists (select 1 from public.subjects s where s.id = exam_papers.subject_id and s.institution_id = exam_papers.institution_id)
    and (
      exam_papers.room_id is null
      or exists (select 1 from public.rooms r where r.id = exam_papers.room_id and r.institution_id = exam_papers.institution_id)
    )
  );
