-- T-036 phase 2 / DBT-21 (lead ruling, Batch B): a guardian or student JWT
-- can read quiz answers today because they live in `assignments.content`
-- jsonb (0005) — `assignments_select` (0020, P-01 rewrite) grants the
-- enrolled student/guardian SELECT on their own section's published
-- assignments, `content` included, answers/explanations and all.
-- `redactQuizAnswers` (src/modules/academics/assignments.schemas.ts) only
-- strips the app-layer read; a direct PostgREST `select content` still
-- returns everything (rule 2 — hiding UI is never authorization).
--
-- Moves answers/explanations into a new staff-only table. `assignments.
-- content` keeps questions/options/stems only from here on (existing rows
-- are not backfilled/rewritten — out of this migration's scope, flagged in
-- 10 §3). RLS follows the P-01 initPlan style (`col = any((select ...))`,
-- `app.my_taught_section_subjects()` — DBT-19's subject-level teacher scope,
-- stricter than `assignments`' own section-level `app.teaches_section`),
-- not a per-row `security definer` call.

create table public.assignment_answer_keys (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  assignment_id uuid not null references public.assignments (id),
  answers jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id)
);

create index assignment_answer_keys_institution_id_idx on public.assignment_answer_keys (institution_id);

create trigger set_updated_at
before update on public.assignment_answer_keys
for each row execute function app.set_updated_at();

alter table public.assignment_answer_keys enable row level security;

-- assignment.manage (07 §2.2) = owner/principal (institution-wide) + teacher
-- scoped to the subject they teach in the assignment's own section (not
-- `app.teaches_section`'s section-level scope — the packet names
-- `app.my_taught_section_subjects` explicitly). admin/exam_controller hold
-- neither `assignment.manage` nor `assignment.read`'s answer-bearing view,
-- so they get no policy at all here (same as guardians/students).
create policy assignment_answer_keys_select on public.assignment_answer_keys
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal'])))
    or exists (
      select 1 from public.assignments a
      where a.id = assignment_answer_keys.assignment_id
        and a.institution_id = assignment_answer_keys.institution_id
        and (a.class_section_id, a.subject_id) in (select t.class_section_id, t.subject_id from app.my_taught_section_subjects() t)
    )
  );

create policy assignment_answer_keys_insert on public.assignment_answer_keys
  for insert to authenticated
  with check (
    exists (
      select 1 from public.assignments a
      where a.id = assignment_answer_keys.assignment_id and a.institution_id = assignment_answer_keys.institution_id
    )
    and (
      institution_id = any((select app.my_institution_ids(array['owner', 'principal'])))
      or exists (
        select 1 from public.assignments a
        where a.id = assignment_answer_keys.assignment_id
          and a.institution_id = assignment_answer_keys.institution_id
          and (a.class_section_id, a.subject_id) in (select t.class_section_id, t.subject_id from app.my_taught_section_subjects() t)
      )
    )
  );

create policy assignment_answer_keys_update on public.assignment_answer_keys
  for update to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal'])))
    or exists (
      select 1 from public.assignments a
      where a.id = assignment_answer_keys.assignment_id
        and a.institution_id = assignment_answer_keys.institution_id
        and (a.class_section_id, a.subject_id) in (select t.class_section_id, t.subject_id from app.my_taught_section_subjects() t)
    )
  )
  with check (
    exists (
      select 1 from public.assignments a
      where a.id = assignment_answer_keys.assignment_id and a.institution_id = assignment_answer_keys.institution_id
    )
    and (
      institution_id = any((select app.my_institution_ids(array['owner', 'principal'])))
      or exists (
        select 1 from public.assignments a
        where a.id = assignment_answer_keys.assignment_id
          and a.institution_id = assignment_answer_keys.institution_id
          and (a.class_section_id, a.subject_id) in (select t.class_section_id, t.subject_id from app.my_taught_section_subjects() t)
      )
    )
  );
