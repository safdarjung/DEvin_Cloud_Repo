-- 0140 — Study help: study from an uploaded file, revision packs, mock exams,
-- teacher worksheets, Hindi/English variants, "ask my teacher" questions.
--
-- study_materials (0138) gains:
--   * formats 'worksheet' (teacher only, three levels with an answer key; never
--     shared to a section: the key would reach students) and 'mock_exam'
--     (student practice paper, sections by question type, unit per question);
--   * source kinds 'file' (a curriculum_materials upload read by the AI),
--     'revision_pack' (a student's weakest units), 'class_pack' (a section's
--     weakest units, aggregate only) and 'mock_exam' (an exam paper's units or
--     chosen units) and 'scope' (a "study with AI" scope of books, chapters,
--     units and files, rebuilt from the database);
--   * source_material_id (the curriculum file it was made from), language
--     ('en' | 'hi'), variant_of (the material this is a translation of),
--     bundle_id (the three items of one revision pack) and focus_unit_ids (the
--     units a pack or mock targets; feeds the planner).
--   A RESTRICTIVE insert policy binds every new reference to the same
--   institution AND to what the caller can already read (the subqueries run
--   under the caller's RLS): a student cannot name another student's private
--   file or another school's unit.
-- study_material_sections: a RESTRICTIVE insert policy refuses worksheets.
-- study_quiz_attempts: the insert policy now accepts a 'mock_exam' material.
-- assignments: study_material_id (a teacher's own non-worksheet study
--   material, linked to the homework). RESTRICTIVE insert/update policies.
-- study_ai_consents: one row per user who ticked "my file is sent to the
--   school's AI provider" (file reading). Own rows only.
-- study_questions: a student asks the subject's teacher(s) of their own
--   section about a material, quiz question or flashcard. Student and linked
--   guardians read; the teachers of that (section, subject) read and answer;
--   nobody else (no leader branch: it is a private study conversation).
--   app.notify_study_question() (definer trigger function, not callable)
--   writes in-app notifications: teachers on a new question, the student on
--   an answer — the same shape as app.post_message (0102).
-- public.my_exam_paper_scope(p_paper_id) (definer, authenticated): an exam
--   paper's subject, unit ids and duration for a paper of the caller's own
--   or linked child's active section (students cannot read exam_papers).
-- Nothing here touches marks/results: mock exams are practice only.

-- ---------------------------------------------------------------------------
-- study_materials
-- ---------------------------------------------------------------------------

alter table public.study_materials drop constraint study_materials_format_check;
alter table public.study_materials
  add constraint study_materials_format_check check (format in (
    'quick_summary', 'revision_notes', 'cheat_sheet', 'key_concepts', 'glossary',
    'high_yield', 'exam_notes', 'one_page', 'active_recall', 'flashcards', 'quiz',
    'worksheet', 'mock_exam'
  ));

alter table public.study_materials drop constraint study_materials_source_kind_check;
alter table public.study_materials
  add constraint study_materials_source_kind_check
  check (source_kind in ('unit', 'paste', 'resource', 'lesson_plan', 'textbook', 'file', 'revision_pack', 'class_pack', 'mock_exam', 'scope'));

-- variant_of is bound to the same institution by a composite FK (a policy
-- subquery on study_materials itself would recurse); the translate action
-- reads the original under the caller's RLS before it saves a variant.
alter table public.study_materials
  add constraint study_materials_id_institution_key unique (id, institution_id);

alter table public.study_materials
  add column source_material_id uuid references public.curriculum_materials (id) on delete set null,
  add column language text not null default 'en' check (language in ('en', 'hi')),
  add column variant_of uuid,
  add column bundle_id uuid,
  add column focus_unit_ids uuid[] not null default '{}' check (cardinality(focus_unit_ids) <= 12),
  add constraint study_materials_variant_fk foreign key (variant_of, institution_id) references public.study_materials (id, institution_id) on delete cascade,
  add constraint study_materials_variant_self_check check (variant_of is null or variant_of <> id),
  add constraint study_materials_worksheet_owner_check check (format <> 'worksheet' or owner_role = 'teacher'),
  add constraint study_materials_mock_owner_check check (format <> 'mock_exam' or owner_role = 'student');

create index study_materials_source_material_idx on public.study_materials (source_material_id) where source_material_id is not null;
create index study_materials_variant_idx on public.study_materials (variant_of) where variant_of is not null;
create index study_materials_bundle_idx on public.study_materials (bundle_id) where bundle_id is not null;

create policy study_materials_insert_refs on public.study_materials
  as restrictive
  for insert to authenticated
  with check (
    (
      study_materials.source_material_id is null
      or exists (
        select 1 from public.curriculum_materials cm
        where cm.id = study_materials.source_material_id
          and cm.institution_id = study_materials.institution_id
      )
    )
    and not exists (
      select 1 from unnest(study_materials.focus_unit_ids) f (unit_id)
      where not exists (
        select 1 from public.curriculum_units cu
        where cu.id = f.unit_id and cu.institution_id = study_materials.institution_id
      )
    )
  );

-- ---------------------------------------------------------------------------
-- study_material_sections: worksheets carry their answer key; never shared.
-- ---------------------------------------------------------------------------

create policy study_material_sections_insert_no_worksheet on public.study_material_sections
  as restrictive
  for insert to authenticated
  with check (
    not exists (
      select 1 from public.study_materials m
      where m.id = study_material_sections.material_id
        and m.format = 'worksheet'
    )
  );

-- ---------------------------------------------------------------------------
-- study_quiz_attempts: a mock exam is run in the same quiz runner.
-- ---------------------------------------------------------------------------

drop policy study_quiz_attempts_insert on public.study_quiz_attempts;
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
          and m.format in ('quiz', 'mock_exam')
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

-- ---------------------------------------------------------------------------
-- assignments: link a teacher's own study material to homework.
-- ---------------------------------------------------------------------------

alter table public.assignments
  add column study_material_id uuid references public.study_materials (id) on delete set null;

create index assignments_study_material_idx on public.assignments (study_material_id) where study_material_id is not null;

create policy assignments_insert_study_material on public.assignments
  as restrictive
  for insert to authenticated
  with check (
    assignments.study_material_id is null
    or exists (
      select 1 from public.study_materials m
      where m.id = assignments.study_material_id
        and m.institution_id = assignments.institution_id
        and m.user_id = (select app.current_user_id())
        and m.owner_role = 'teacher'
        and m.format <> 'worksheet'
    )
  );

create policy assignments_update_study_material on public.assignments
  as restrictive
  for update to authenticated
  using (true)
  with check (
    assignments.study_material_id is null
    or exists (
      select 1 from public.study_materials m
      where m.id = assignments.study_material_id
        and m.institution_id = assignments.institution_id
        and m.user_id = (select app.current_user_id())
        and m.owner_role = 'teacher'
        and m.format <> 'worksheet'
    )
  );

-- ---------------------------------------------------------------------------
-- study_ai_consents
-- ---------------------------------------------------------------------------

create table public.study_ai_consents (
  institution_id uuid not null references public.institutions (id),
  user_id uuid not null references public.profiles (id) default app.current_user_id(),
  kind text not null check (kind in ('file_reading')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (institution_id, user_id, kind)
);

create index study_ai_consents_user_idx on public.study_ai_consents (user_id);

create trigger set_updated_at
before update on public.study_ai_consents
for each row execute function app.set_updated_at();

alter table public.study_ai_consents enable row level security;

create policy study_ai_consents_select on public.study_ai_consents
  for select to authenticated
  using (
    study_ai_consents.user_id = (select app.current_user_id())
    and study_ai_consents.institution_id = any((select app.my_institution_ids(array['student', 'teacher'])))
  );

create policy study_ai_consents_insert on public.study_ai_consents
  for insert to authenticated
  with check (
    study_ai_consents.user_id = (select app.current_user_id())
    and study_ai_consents.institution_id = any((select app.my_institution_ids(array['student', 'teacher'])))
  );

create policy study_ai_consents_delete on public.study_ai_consents
  for delete to authenticated
  using (study_ai_consents.user_id = (select app.current_user_id()));

revoke all on public.study_ai_consents from anon, authenticated;
grant select, insert, delete on public.study_ai_consents to authenticated;
grant select, insert, update, delete on public.study_ai_consents to service_role;

-- ---------------------------------------------------------------------------
-- study_questions
-- ---------------------------------------------------------------------------

create table public.study_questions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  student_id uuid not null references public.students (id),
  class_section_id uuid not null references public.class_sections (id),
  subject_id uuid not null references public.subjects (id),
  asked_by uuid not null references public.profiles (id) default app.current_user_id(),
  context_kind text not null check (context_kind in ('material', 'quiz_question', 'flashcard', 'general')),
  material_id uuid references public.study_materials (id) on delete set null,
  -- The question/card text the student was looking at, copied from their own view.
  context_excerpt text check (context_excerpt is null or char_length(context_excerpt) between 1 and 1000),
  question text not null check (char_length(btrim(question)) between 1 and 1000),
  answer text check (answer is null or char_length(btrim(answer)) between 1 and 2000),
  answered_by uuid references public.profiles (id),
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((answer is null) = (answered_by is null) and (answer is null) = (answered_at is null))
);

create index study_questions_student_idx on public.study_questions (student_id, created_at desc);
create index study_questions_section_subject_idx on public.study_questions (class_section_id, subject_id, created_at desc);
create index study_questions_institution_idx on public.study_questions (institution_id);
create index study_questions_material_idx on public.study_questions (material_id) where material_id is not null;
create index study_questions_asked_by_idx on public.study_questions (asked_by);

create trigger set_updated_at
before update on public.study_questions
for each row execute function app.set_updated_at();

-- Invoker, no table reads (0067 guard shape): the column grant allows
-- `answer` only; this stamps who answered and when, so neither can be forged.
create function app.guard_study_question_answer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  then
    return new;
  end if;
  if new.answer is null then
    raise exception 'code:validation_failed' using detail = 'an answer cannot be removed';
  end if;
  new.answered_by := app.current_user_id();
  new.answered_at := now();
  return new;
end;
$$;

revoke execute on function app.guard_study_question_answer() from public;

create trigger guard_study_question_answer
before update on public.study_questions
for each row execute function app.guard_study_question_answer();

alter table public.study_questions enable row level security;

create policy study_questions_select on public.study_questions
  for select to authenticated
  using (
    study_questions.student_id = any((select app.my_student_ids()))
    or (
      study_questions.institution_id = any((select app.my_institution_ids(array['teacher'])))
      and (study_questions.class_section_id, study_questions.subject_id) in (
        select t.class_section_id, t.subject_id from app.my_taught_section_subjects() t
      )
    )
  );

create policy study_questions_insert on public.study_questions
  for insert to authenticated
  with check (
    study_questions.asked_by = (select app.current_user_id())
    and study_questions.answer is null
    and study_questions.answered_by is null
    and study_questions.answered_at is null
    and exists (
      select 1 from public.memberships m
      where m.user_id = (select app.current_user_id())
        and m.institution_id = study_questions.institution_id
        and m.role = 'student'
        and m.status = 'active'
        and m.student_id = study_questions.student_id
    )
    and exists (
      select 1 from public.enrolments e
      where e.student_id = study_questions.student_id
        and e.class_section_id = study_questions.class_section_id
        and e.institution_id = study_questions.institution_id
        and e.status = 'active'
    )
    and exists (
      select 1 from public.subject_assignments sa
      where sa.class_section_id = study_questions.class_section_id
        and sa.subject_id = study_questions.subject_id
        and sa.institution_id = study_questions.institution_id
    )
    and (
      study_questions.material_id is null
      or exists (
        select 1 from public.study_materials sm
        where sm.id = study_questions.material_id
          and sm.institution_id = study_questions.institution_id
      )
    )
  );

create policy study_questions_update on public.study_questions
  for update to authenticated
  using (
    study_questions.institution_id = any((select app.my_institution_ids(array['teacher'])))
    and (study_questions.class_section_id, study_questions.subject_id) in (
      select t.class_section_id, t.subject_id from app.my_taught_section_subjects() t
    )
  )
  with check (
    study_questions.institution_id = any((select app.my_institution_ids(array['teacher'])))
    and (study_questions.class_section_id, study_questions.subject_id) in (
      select t.class_section_id, t.subject_id from app.my_taught_section_subjects() t
    )
  );

revoke all on public.study_questions from anon, authenticated;
grant select, insert on public.study_questions to authenticated;
grant update (answer) on public.study_questions to authenticated;
grant select, insert, update, delete on public.study_questions to service_role;

-- In-app notifications (0102 post_message shape). Definer: notifications are
-- not writable by API roles. Not callable (trigger only, execute revoked).
create function app.notify_study_question()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notifications (institution_id, recipient_user_id, type, title, body, data)
    select distinct on (m.user_id)
           new.institution_id,
           m.user_id,
           'study.question',
           'A student asked a study question',
           left(new.question, 140),
           jsonb_build_object('question_id', new.id, 'subject_id', new.subject_id, 'key', 'study.question:' || new.id || ':' || m.user_id)
    from public.subject_assignments sa
    join public.memberships m
      on m.staff_id = sa.teacher_id
     and m.institution_id = sa.institution_id
     and m.status = 'active'
    where sa.class_section_id = new.class_section_id
      and sa.subject_id = new.subject_id
      and sa.institution_id = new.institution_id
    on conflict do nothing;
  elsif new.answer is not null and new.answer is distinct from old.answer then
    insert into public.notifications (institution_id, recipient_user_id, type, title, body, data)
    values (
      new.institution_id,
      new.asked_by,
      'study.answer',
      'Your teacher answered your question',
      left(new.answer, 140),
      jsonb_build_object('question_id', new.id, 'subject_id', new.subject_id)
    );
  end if;
  return null;
end;
$$;

revoke all on function app.notify_study_question() from public, anon, authenticated;

create trigger notify_study_question
after insert or update of answer on public.study_questions
for each row execute function app.notify_study_question();

-- ---------------------------------------------------------------------------
-- public.my_exam_paper_scope — a paper's subject, units and duration for a
-- paper of the caller's own (or linked child's) active section. Students and
-- guardians cannot read exam_papers under RLS (same reason as
-- my_upcoming_exam_papers, 0103). Returns nothing for any other paper.
-- ---------------------------------------------------------------------------

create function public.my_exam_paper_scope(p_paper_id uuid)
returns table (
  paper_id uuid,
  exam_name text,
  subject_id uuid,
  subject_name text,
  unit_ids uuid[],
  duration_minutes int,
  scheduled_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  return query
    select ep.id, ex.name, ep.subject_id, sub.name, ep.unit_ids, ep.duration_minutes, ep.scheduled_at
    from public.exam_papers ep
    join public.exams ex on ex.id = ep.exam_id and ex.institution_id = ep.institution_id
    join public.subjects sub on sub.id = ep.subject_id and sub.institution_id = ep.institution_id
    where ep.id = p_paper_id
      and ex.status <> 'draft'
      and ep.class_section_id = any (array(select app.my_student_section_ids()));
end;
$$;

revoke execute on function public.my_exam_paper_scope(uuid) from public, anon;
grant execute on function public.my_exam_paper_scope(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Study with AI on a chosen scope: the tutor chat is a study_items 'chat'
-- (0049, own rows only, no guardian read) with the scope it was opened on
-- (ids only: subjects, textbooks, chapters, units, files, a goal line). The
-- server rebuilds the model context from these ids under the caller's RLS on
-- every turn, so a forged id is simply dropped.
-- study_sessions gains the unit studied, for per-unit time on the picker.
-- ---------------------------------------------------------------------------

alter table public.study_items
  add column scope jsonb check (scope is null or (jsonb_typeof(scope) = 'object' and pg_column_size(scope) <= 8192));

alter table public.study_sessions
  add column curriculum_unit_id uuid references public.curriculum_units (id);

create index study_sessions_unit_idx on public.study_sessions (curriculum_unit_id) where curriculum_unit_id is not null;

create policy study_sessions_insert_unit on public.study_sessions
  as restrictive
  for insert to authenticated
  with check (
    study_sessions.curriculum_unit_id is null
    or exists (
      select 1 from public.curriculum_units cu
      where cu.id = study_sessions.curriculum_unit_id and cu.institution_id = study_sessions.institution_id
    )
  );
