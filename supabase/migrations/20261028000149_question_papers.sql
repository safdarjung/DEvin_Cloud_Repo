-- 0149 — Question papers (15-learning-exam-system-plan.md, Phase 3).
--
-- question_papers           header: year, grade, optional section, subject,
--                           optional exam + exam_papers link (offline marks
--                           entry keeps working), marks, instructions,
--                           negative marking, status, current_version
-- question_paper_sections   ordered; choose_count = "attempt any N"
-- question_paper_items      a SNAPSHOT of the question (text, options, answer,
--                           key, marks, ...) plus source_question_id and the
--                           source's origin (manual | ai | import, set by the
--                           child guard, kept when the item is edited); items
--                           sharing a choice_group inside one section are
--                           OR-alternatives (the student answers one)
-- question_paper_versions   immutable frozen copy, written on approve and publish
-- question_paper_templates  school-defined blueprints (rows of type x count x
--                           marks x difficulty, chapter weights, difficulty
--                           mix); nothing here is board-specific
--
-- Blueprint JSON (Zod: src/modules/question-papers/schemas.ts):
--   { sections: [{ title, instructions?, chooseCount?, rows: [{ type, count, marks, difficulty? }] }],
--     chapterWeights?: [{ curriculumUnitId, percent }],
--     difficultyMix?: { easy?, medium?, hard? }   -- percent of marks }
--
-- Status: draft -> in_review -> approved -> published; archived from any.
-- Only public.transition_question_paper() moves status (guard trigger checks
-- the transaction-local app.allow_paper_transition flag, 0016 precedent). It
-- runs app.validate_paper() and refuses approved/published when ok = false,
-- so a direct PostgREST write cannot skip validation. approved/published
-- papers are frozen: header, sections and items reject every write; changes
-- go through copy_question_paper(id, true), a new draft with revision_of_id
-- (only that function may set it). in_review papers are frozen for everyone
-- but app.exam_write_roles(): the creator returns it to draft to edit. Every
-- section/item write touches the paper row (lock + updated_at), so approve can
-- refuse a stale p_expected_updated_at. Publishing a revision archives the
-- paper it revises; one published paper per exam_paper_id.
--
-- Access (07 §2.2 question.manage / paper.approve / paper.publish):
--   owner/principal/exam_controller: every paper of the school;
--   teacher: reads papers of the (grade, subject, year) they teach, edits the
--   ones they created (0073 pattern, app.my_taught_section_subjects);
--   approve/publish/archive-approved: app.exam_write_roles() only;
--   students/guardians/admin/admissions/accountant: no policy at all.
-- AI (rule 6): AI questions never enter a paper directly. They are saved as
-- draft bank questions (origin ai) and added by source_question_id;
-- validate_paper() blocks approval until every source question is approved,
-- and an ai/import item whose source link was cleared (edited) never passes.

-- ---------------------------------------------------------------------------
-- question_paper_templates
-- ---------------------------------------------------------------------------

create table public.question_paper_templates (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  grade_id uuid references public.grades (id),
  subject_id uuid references public.subjects (id),
  exam_type text check (exam_type is null or char_length(exam_type) <= 60),
  duration_minutes int check (duration_minutes is null or duration_minutes between 1 and 600),
  instructions text check (instructions is null or char_length(instructions) <= 4000),
  blueprint jsonb not null check (jsonb_typeof(blueprint -> 'sections') = 'array'),
  created_by uuid not null references public.profiles (id) default app.current_user_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint question_paper_templates_id_institution_key unique (id, institution_id)
);

create index question_paper_templates_institution_idx on public.question_paper_templates (institution_id);

create trigger set_updated_at
before update on public.question_paper_templates
for each row execute function app.set_updated_at();

alter table public.question_paper_templates enable row level security;

create policy question_paper_templates_select on public.question_paper_templates
  for select to authenticated
  using (question_paper_templates.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'exam_controller', 'teacher']))));

create policy question_paper_templates_insert on public.question_paper_templates
  for insert to authenticated
  with check (
    question_paper_templates.created_by = (select app.current_user_id())
    and question_paper_templates.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'exam_controller', 'teacher'])))
    and (question_paper_templates.grade_id is null or exists (
      select 1 from public.grades g where g.id = question_paper_templates.grade_id and g.institution_id = question_paper_templates.institution_id))
    and (question_paper_templates.subject_id is null or exists (
      select 1 from public.subjects s where s.id = question_paper_templates.subject_id and s.institution_id = question_paper_templates.institution_id))
  );

create policy question_paper_templates_update on public.question_paper_templates
  for update to authenticated
  using (
    question_paper_templates.institution_id = any((select app.my_institution_ids(app.exam_write_roles())))
    or (question_paper_templates.created_by = (select app.current_user_id())
        and question_paper_templates.institution_id = any((select app.my_institution_ids(array['teacher']))))
  )
  with check (
    (question_paper_templates.institution_id = any((select app.my_institution_ids(app.exam_write_roles())))
     or (question_paper_templates.created_by = (select app.current_user_id())
         and question_paper_templates.institution_id = any((select app.my_institution_ids(array['teacher'])))))
    and (question_paper_templates.grade_id is null or exists (
      select 1 from public.grades g where g.id = question_paper_templates.grade_id and g.institution_id = question_paper_templates.institution_id))
    and (question_paper_templates.subject_id is null or exists (
      select 1 from public.subjects s where s.id = question_paper_templates.subject_id and s.institution_id = question_paper_templates.institution_id))
  );

create policy question_paper_templates_delete on public.question_paper_templates
  for delete to authenticated
  using (
    question_paper_templates.institution_id = any((select app.my_institution_ids(app.exam_write_roles())))
    or (question_paper_templates.created_by = (select app.current_user_id())
        and question_paper_templates.institution_id = any((select app.my_institution_ids(array['teacher']))))
  );

revoke all on public.question_paper_templates from anon, authenticated;
grant select, insert, delete on public.question_paper_templates to authenticated;
grant update (name, grade_id, subject_id, exam_type, duration_minutes, instructions, blueprint) on public.question_paper_templates to authenticated;
grant select, insert, update, delete on public.question_paper_templates to service_role;

-- ---------------------------------------------------------------------------
-- question_papers
-- ---------------------------------------------------------------------------

create table public.question_papers (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  academic_year_id uuid not null references public.academic_years (id),
  grade_id uuid not null references public.grades (id),
  section_id uuid references public.class_sections (id),
  subject_id uuid not null references public.subjects (id),
  exam_id uuid references public.exams (id),
  exam_paper_id uuid references public.exam_papers (id),
  template_id uuid,
  revision_of_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  exam_type text check (exam_type is null or char_length(exam_type) <= 60),
  exam_date date,
  duration_minutes int check (duration_minutes is null or duration_minutes between 1 and 600),
  total_marks numeric(6, 2) not null check (total_marks > 0 and total_marks <= 1000),
  pass_marks numeric(6, 2) not null default 0 check (pass_marks >= 0),
  instructions text check (instructions is null or char_length(instructions) <= 4000),
  negative_marking numeric(4, 2) not null default 0 check (negative_marking between 0 and 10),
  blueprint jsonb check (blueprint is null or jsonb_typeof(blueprint -> 'sections') = 'array'),
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'published', 'archived')),
  current_version int not null default 0 check (current_version >= 0),
  created_by uuid not null references public.profiles (id) default app.current_user_id(),
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint question_papers_id_institution_key unique (id, institution_id),
  constraint question_papers_pass_within_total_check check (pass_marks <= total_marks),
  -- Self column first: app.demo_reset nulls conkey[1] of self references.
  constraint question_papers_revision_of_fkey
    foreign key (revision_of_id, institution_id) references public.question_papers (id, institution_id) on delete set null (revision_of_id),
  constraint question_papers_template_fkey
    foreign key (template_id, institution_id) references public.question_paper_templates (id, institution_id) on delete set null (template_id)
);

create index question_papers_scope_idx on public.question_papers (institution_id, grade_id, subject_id, status);
create index question_papers_exam_paper_idx on public.question_papers (exam_paper_id) where exam_paper_id is not null;
-- One published paper feeds an exam paper's marks entry (race backstop for transition_question_paper).
create unique index question_papers_published_exam_paper_key on public.question_papers (exam_paper_id)
  where status = 'published' and exam_paper_id is not null;

create trigger set_updated_at
before update on public.question_papers
for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- question_paper_sections / question_paper_items / question_paper_versions
-- ---------------------------------------------------------------------------

create table public.question_paper_sections (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  paper_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  instructions text check (instructions is null or char_length(instructions) <= 2000),
  position int not null default 0 check (position between 0 and 1000),
  choose_count smallint check (choose_count is null or choose_count between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint question_paper_sections_id_paper_key unique (id, paper_id),
  foreign key (paper_id, institution_id) references public.question_papers (id, institution_id) on delete cascade
);

create index question_paper_sections_paper_idx on public.question_paper_sections (paper_id, position);

create trigger set_updated_at
before update on public.question_paper_sections
for each row execute function app.set_updated_at();

create table public.question_paper_items (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  paper_id uuid not null,
  section_id uuid not null,
  position int not null default 0 check (position between 0 and 10000),
  source_question_id uuid,
  -- Lineage: the bank question this item was taken from. Kept when an edit
  -- clears source_question_id; never client-set (app.question_paper_child_guard).
  -- No FK: a deleted bank question has nothing left to hold back from practice (0151).
  derived_from_question_id uuid,
  origin text not null default 'manual' check (origin in ('manual', 'ai', 'import')),
  type text not null check (type in (
    'mcq', 'true_false', 'short_answer', 'long_answer',
    'multi_select', 'fill_blank', 'match', 'very_short_answer', 'case_based',
    'assertion_reason', 'numerical', 'passage', 'diagram'
  )),
  body text not null check (char_length(body) between 1 and 4000),
  options jsonb,
  answer text check (answer is null or char_length(answer) <= 4000),
  answer_key jsonb,
  marks numeric(5, 2) not null check (marks > 0 and marks <= 100),
  explanation text check (explanation is null or char_length(explanation) <= 4000),
  marking_scheme text check (marking_scheme is null or char_length(marking_scheme) <= 4000),
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  curriculum_unit_id uuid references public.curriculum_units (id) on delete set null,
  curriculum_topic_id uuid,
  source_subject_textbook_id uuid,
  source_chapter_no smallint check (source_chapter_no is null or source_chapter_no between 1 and 99),
  source_page int check (source_page is null or source_page between 1 and 2000),
  choice_group smallint check (choice_group is null or choice_group between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (paper_id, institution_id) references public.question_papers (id, institution_id) on delete cascade,
  foreign key (section_id, paper_id) references public.question_paper_sections (id, paper_id) on delete cascade,
  foreign key (source_question_id, institution_id) references public.question_bank (id, institution_id) on delete set null (source_question_id),
  foreign key (curriculum_topic_id, institution_id) references public.curriculum_topics (id, institution_id) on delete set null (curriculum_topic_id),
  foreign key (source_subject_textbook_id, institution_id) references public.subject_textbooks (id, institution_id) on delete set null (source_subject_textbook_id)
);

create index question_paper_items_section_idx on public.question_paper_items (section_id, position);
create index question_paper_items_paper_idx on public.question_paper_items (paper_id);
create index question_paper_items_source_idx on public.question_paper_items (source_question_id) where source_question_id is not null;
create index question_paper_items_derived_idx on public.question_paper_items (derived_from_question_id) where derived_from_question_id is not null;

create trigger set_updated_at
before update on public.question_paper_items
for each row execute function app.set_updated_at();

create table public.question_paper_versions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  paper_id uuid not null,
  version_no int not null check (version_no >= 1),
  snapshot jsonb not null,
  reason text check (reason is null or char_length(reason) <= 500),
  created_by uuid references public.profiles (id) default app.current_user_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (paper_id, version_no),
  foreign key (paper_id, institution_id) references public.question_papers (id, institution_id) on delete cascade
);

create trigger set_updated_at
before update on public.question_paper_versions
for each row execute function app.set_updated_at();

-- Immutable history (rule 5): no update or delete, except app.demo_reset.
create trigger question_paper_versions_immutable
before update or delete on public.question_paper_versions
for each row execute function app.block_mutation();

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

create function app.question_paper_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := app.current_user_id();
  v_transition boolean := coalesce(current_setting('app.allow_paper_transition', true), '') = 'on';
begin
  if coalesce(current_setting('app.allow_reset', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT'
     or (new.academic_year_id, new.grade_id, new.section_id, new.subject_id, new.exam_id, new.exam_paper_id)
        is distinct from (old.academic_year_id, old.grade_id, old.section_id, old.subject_id, old.exam_id, old.exam_paper_id) then
    if not exists (select 1 from public.academic_years y where y.id = new.academic_year_id and y.institution_id = new.institution_id)
       or not exists (select 1 from public.grades g where g.id = new.grade_id and g.institution_id = new.institution_id)
       or not exists (select 1 from public.subjects s where s.id = new.subject_id and s.institution_id = new.institution_id) then
      raise exception 'code:validation_failed' using detail = 'Year, class or subject is not part of this school.';
    end if;
    if new.section_id is not null and not exists (
      select 1 from public.class_sections cs
      where cs.id = new.section_id and cs.institution_id = new.institution_id
        and cs.grade_id = new.grade_id and cs.academic_year_id = new.academic_year_id
    ) then
      raise exception 'code:validation_failed' using detail = 'The section is not in this class and year.';
    end if;
    if new.exam_id is not null and not exists (
      select 1 from public.exams e
      where e.id = new.exam_id and e.institution_id = new.institution_id and e.academic_year_id = new.academic_year_id
    ) then
      raise exception 'code:validation_failed' using detail = 'The exam is not in this school year.';
    end if;
    if new.exam_paper_id is not null and not exists (
      select 1 from public.exam_papers ep
      join public.class_sections cs on cs.id = ep.class_section_id
      join public.exams e on e.id = ep.exam_id and e.academic_year_id = new.academic_year_id
      where ep.id = new.exam_paper_id and ep.institution_id = new.institution_id
        and ep.subject_id = new.subject_id and cs.grade_id = new.grade_id
        and (new.exam_id is null or ep.exam_id = new.exam_id)
        and (new.section_id is null or ep.class_section_id = new.section_id)
    ) then
      raise exception 'code:validation_failed' using detail = 'The marks-entry paper is for a different exam, year, class or subject.';
    end if;
  end if;

  if v_uid is null or v_transition then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.revision_of_id is not null and coalesce(current_setting('app.allow_paper_copy', true), '') <> 'on' then
      raise exception 'code:forbidden' using detail = 'Start a new revision from the approved or published paper.';
    end if;
    new.created_by := v_uid;
    new.status := 'draft';
    new.current_version := 0;
    new.approved_by := null;
    new.approved_at := null;
    new.published_at := null;
    return new;
  end if;

  if (new.status, new.current_version, new.approved_by, new.approved_at, new.published_at)
     is distinct from (old.status, old.current_version, old.approved_by, old.approved_at, old.published_at) then
    raise exception 'code:forbidden' using detail = 'Use the paper actions to change its status.';
  end if;
  if old.status not in ('draft', 'in_review') then
    raise exception 'code:invalid_state' using detail = 'This paper is approved or published and cannot change. Start a new revision.';
  end if;
  -- Under review only the approvers may change it (the child guard routes section/item writes here too).
  if old.status = 'in_review' and old.institution_id not in (select app.my_institution_ids(app.exam_write_roles())) then
    raise exception 'code:invalid_state' using detail = 'This paper is in review. Return it to draft to change it.';
  end if;
  return new;
end;
$$;

create trigger question_paper_guard
before insert or update on public.question_papers
for each row execute function app.question_paper_guard();

-- Sections and items: writable only while the caller may edit their paper.
-- The no-op UPDATE of the paper row locks it against a concurrent
-- transition_question_paper, bumps updated_at (approve's staleness check) and
-- runs app.question_paper_guard (frozen / in-review rules) under the caller's
-- UPDATE policy: no row back means the caller cannot edit this paper.
create function app.question_paper_child_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_paper_id uuid;
begin
  -- Lineage follows source_question_id when it points at a question; clearing
  -- the link keeps it. A client INSERT cannot set it on its own (no UPDATE
  -- grant); only copy_question_paper and service writes pass it through.
  if tg_table_name = 'question_paper_items' and tg_op <> 'DELETE' then
    if new.source_question_id is not null
       and (tg_op = 'INSERT' or new.source_question_id is distinct from old.source_question_id) then
      new.derived_from_question_id := new.source_question_id;
    elsif tg_op = 'INSERT' and coalesce(current_setting('app.allow_paper_copy', true), '') <> 'on'
       and app.current_user_id() is not null then
      new.derived_from_question_id := null;
    end if;
  end if;
  if coalesce(current_setting('app.allow_reset', true), '') = 'on' or app.current_user_id() is null then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.paper_id is distinct from old.paper_id then
    raise exception 'code:validation_failed' using detail = 'A section or question cannot move to another paper.';
  end if;
  update public.question_papers p set title = p.title
  where p.id = coalesce(new.paper_id, old.paper_id)
  returning p.id into v_paper_id;
  if v_paper_id is null then
    raise exception 'code:not_found' using detail = 'Paper not found, or you cannot change it.';
  end if;
  -- Origin follows the bank row the item points at; clearing the link keeps it,
  -- so an edited AI draft never reads as manual. Only copy_question_paper copies it as is.
  if tg_table_name = 'question_paper_items' and tg_op <> 'DELETE'
     and coalesce(current_setting('app.allow_paper_copy', true), '') <> 'on' then
    if tg_op = 'UPDATE' then
      new.origin := old.origin;
    else
      new.origin := 'manual';
    end if;
    if new.source_question_id is not null
       and (tg_op = 'INSERT' or new.source_question_id is distinct from old.source_question_id) then
      select q.origin into new.origin from public.question_bank q
      where q.id = new.source_question_id and q.institution_id = new.institution_id;
      if not found then
        raise exception 'code:validation_failed' using detail = 'The bank question is not available.';
      end if;
    end if;
  end if;
  -- Nested IFs: plpgsql does not short-circuit, and sections have no curriculum_unit_id.
  if tg_table_name = 'question_paper_items' and tg_op <> 'DELETE' then
    if new.curriculum_unit_id is not null
       and (tg_op = 'INSERT' or new.curriculum_unit_id is distinct from old.curriculum_unit_id)
       and not exists (select 1 from public.curriculum_units cu where cu.id = new.curriculum_unit_id and cu.institution_id = new.institution_id) then
      raise exception 'code:validation_failed' using detail = 'The chapter is not part of this school.';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger question_paper_child_guard
before insert or update or delete on public.question_paper_sections
for each row execute function app.question_paper_child_guard();

create trigger question_paper_child_guard
before insert or update or delete on public.question_paper_items
for each row execute function app.question_paper_child_guard();

-- Versions are written only by transition_question_paper (or service role).
create function app.question_paper_version_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.current_user_id() is not null
     and coalesce(current_setting('app.allow_paper_transition', true), '') <> 'on' then
    raise exception 'code:forbidden' using detail = 'Versions are written when a paper is approved or published.';
  end if;
  return new;
end;
$$;

create trigger question_paper_version_guard
before insert on public.question_paper_versions
for each row execute function app.question_paper_version_guard();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.question_papers enable row level security;
alter table public.question_paper_sections enable row level security;
alter table public.question_paper_items enable row level security;
alter table public.question_paper_versions enable row level security;

create policy question_papers_select on public.question_papers
  for select to authenticated
  using (
    question_papers.institution_id = any((select app.my_institution_ids(app.exam_write_roles())))
    or (question_papers.grade_id, question_papers.subject_id, question_papers.academic_year_id) in (
      select cs.grade_id, t.subject_id, cs.academic_year_id
      from app.my_taught_section_subjects() t
      join public.class_sections cs on cs.id = t.class_section_id
    )
  );

create policy question_papers_insert on public.question_papers
  for insert to authenticated
  with check (
    question_papers.created_by = (select app.current_user_id())
    and (
      question_papers.institution_id = any((select app.my_institution_ids(app.exam_write_roles())))
      or (question_papers.grade_id, question_papers.subject_id, question_papers.academic_year_id) in (
        select cs.grade_id, t.subject_id, cs.academic_year_id
        from app.my_taught_section_subjects() t
        join public.class_sections cs on cs.id = t.class_section_id
      )
    )
  );

create policy question_papers_update on public.question_papers
  for update to authenticated
  using (
    question_papers.institution_id = any((select app.my_institution_ids(app.exam_write_roles())))
    or (
      question_papers.created_by = (select app.current_user_id())
      and (question_papers.grade_id, question_papers.subject_id, question_papers.academic_year_id) in (
        select cs.grade_id, t.subject_id, cs.academic_year_id
        from app.my_taught_section_subjects() t
        join public.class_sections cs on cs.id = t.class_section_id
      )
    )
  )
  with check (
    question_papers.institution_id = any((select app.my_institution_ids(app.exam_write_roles())))
    or (
      question_papers.created_by = (select app.current_user_id())
      and (question_papers.grade_id, question_papers.subject_id, question_papers.academic_year_id) in (
        select cs.grade_id, t.subject_id, cs.academic_year_id
        from app.my_taught_section_subjects() t
        join public.class_sections cs on cs.id = t.class_section_id
      )
    )
  );

-- Children: read follows the paper's SELECT policy (the subquery runs under
-- it); writes need the paper's editor (leadership, or the teacher who created it).
create policy question_paper_sections_select on public.question_paper_sections
  for select to authenticated
  using (exists (
    select 1 from public.question_papers p
    where p.id = question_paper_sections.paper_id and p.institution_id = question_paper_sections.institution_id
  ));

create policy question_paper_sections_insert on public.question_paper_sections
  for insert to authenticated
  with check (exists (
    select 1 from public.question_papers p
    where p.id = question_paper_sections.paper_id and p.institution_id = question_paper_sections.institution_id
      and (p.institution_id = any((select app.my_institution_ids(app.exam_write_roles()))) or p.created_by = (select app.current_user_id()))
  ));

create policy question_paper_sections_update on public.question_paper_sections
  for update to authenticated
  using (exists (
    select 1 from public.question_papers p
    where p.id = question_paper_sections.paper_id and p.institution_id = question_paper_sections.institution_id
      and (p.institution_id = any((select app.my_institution_ids(app.exam_write_roles()))) or p.created_by = (select app.current_user_id()))
  ))
  with check (exists (
    select 1 from public.question_papers p
    where p.id = question_paper_sections.paper_id and p.institution_id = question_paper_sections.institution_id
      and (p.institution_id = any((select app.my_institution_ids(app.exam_write_roles()))) or p.created_by = (select app.current_user_id()))
  ));

create policy question_paper_sections_delete on public.question_paper_sections
  for delete to authenticated
  using (exists (
    select 1 from public.question_papers p
    where p.id = question_paper_sections.paper_id and p.institution_id = question_paper_sections.institution_id
      and (p.institution_id = any((select app.my_institution_ids(app.exam_write_roles()))) or p.created_by = (select app.current_user_id()))
  ));

create policy question_paper_items_select on public.question_paper_items
  for select to authenticated
  using (exists (
    select 1 from public.question_papers p
    where p.id = question_paper_items.paper_id and p.institution_id = question_paper_items.institution_id
  ));

create policy question_paper_items_insert on public.question_paper_items
  for insert to authenticated
  with check (exists (
    select 1 from public.question_papers p
    where p.id = question_paper_items.paper_id and p.institution_id = question_paper_items.institution_id
      and (p.institution_id = any((select app.my_institution_ids(app.exam_write_roles()))) or p.created_by = (select app.current_user_id()))
  ));

create policy question_paper_items_update on public.question_paper_items
  for update to authenticated
  using (exists (
    select 1 from public.question_papers p
    where p.id = question_paper_items.paper_id and p.institution_id = question_paper_items.institution_id
      and (p.institution_id = any((select app.my_institution_ids(app.exam_write_roles()))) or p.created_by = (select app.current_user_id()))
  ))
  with check (exists (
    select 1 from public.question_papers p
    where p.id = question_paper_items.paper_id and p.institution_id = question_paper_items.institution_id
      and (p.institution_id = any((select app.my_institution_ids(app.exam_write_roles()))) or p.created_by = (select app.current_user_id()))
  ));

create policy question_paper_items_delete on public.question_paper_items
  for delete to authenticated
  using (exists (
    select 1 from public.question_papers p
    where p.id = question_paper_items.paper_id and p.institution_id = question_paper_items.institution_id
      and (p.institution_id = any((select app.my_institution_ids(app.exam_write_roles()))) or p.created_by = (select app.current_user_id()))
  ));

create policy question_paper_versions_select on public.question_paper_versions
  for select to authenticated
  using (exists (
    select 1 from public.question_papers p
    where p.id = question_paper_versions.paper_id and p.institution_id = question_paper_versions.institution_id
  ));

create policy question_paper_versions_insert on public.question_paper_versions
  for insert to authenticated
  with check (
    question_paper_versions.created_by = (select app.current_user_id())
    and exists (
      select 1 from public.question_papers p
      where p.id = question_paper_versions.paper_id and p.institution_id = question_paper_versions.institution_id
        and (p.institution_id = any((select app.my_institution_ids(app.exam_write_roles()))) or p.created_by = (select app.current_user_id()))
    )
  );

-- status/current_version/approved_*/published_at/exam_paper_id are in the
-- grant only so transition_question_paper (security invoker) can write them;
-- app.question_paper_guard rejects them outside that function.
revoke all on public.question_papers from anon, authenticated;
grant select, insert on public.question_papers to authenticated;
grant update (
  academic_year_id, grade_id, section_id, subject_id, exam_id, exam_paper_id, template_id,
  title, exam_type, exam_date, duration_minutes, total_marks, pass_marks, instructions, negative_marking, blueprint,
  status, current_version, approved_by, approved_at, published_at
) on public.question_papers to authenticated;
grant select, insert, update, delete on public.question_papers to service_role;

revoke all on public.question_paper_sections from anon, authenticated;
grant select, insert, delete on public.question_paper_sections to authenticated;
grant update (title, instructions, position, choose_count) on public.question_paper_sections to authenticated;
grant select, insert, update, delete on public.question_paper_sections to service_role;

-- origin is not granted: app.question_paper_child_guard derives it from the
-- bank on every write. source_question_id stays (replace / edit clear it);
-- re-pointing it re-derives origin, clearing it keeps the old one.
-- derived_from_question_id (lineage) is not granted either.
revoke all on public.question_paper_items from anon, authenticated;
grant select, insert, delete on public.question_paper_items to authenticated;
grant update (
  section_id, position, source_question_id, type, body, options, answer, answer_key, marks, explanation, marking_scheme,
  difficulty, curriculum_unit_id, curriculum_topic_id, source_subject_textbook_id, source_chapter_no, source_page, choice_group
) on public.question_paper_items to authenticated;
grant select, insert, update, delete on public.question_paper_items to service_role;

revoke all on public.question_paper_versions from anon, authenticated;
grant select, insert on public.question_paper_versions to authenticated;
grant select, insert, update, delete on public.question_paper_versions to service_role;

-- ---------------------------------------------------------------------------
-- app.validate_paper — {ok, errors[], warnings[], computedTotal}
-- Security invoker: reads the paper, items and source questions under the
-- caller's RLS (a source question the caller cannot see counts as unapproved).
-- Marks: per section, items sharing a choice_group are one slot worth the
-- highest of them (OR); choose_count keeps the best N slots.
-- ---------------------------------------------------------------------------

create function app.validate_paper(p_paper_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_paper public.question_papers;
  v_errors text[] := array[]::text[];
  v_warnings text[] := array[]::text[];
  v_total numeric := 0;
  v_share numeric;
  r record;
begin
  select * into v_paper from public.question_papers where id = p_paper_id;
  if not found then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('Paper not found.'), 'warnings', '[]'::jsonb, 'computedTotal', 0);
  end if;

  if not exists (select 1 from public.question_paper_items i where i.paper_id = p_paper_id) then
    v_errors := v_errors || 'The paper has no questions.'::text;
  end if;

  -- Marks, section by section.
  for r in
    with slots as (
      select i.section_id, coalesce('g' || i.choice_group::text, i.id::text) as slot,
             max(i.marks) as marks, min(i.marks) as min_marks, count(*) as n, bool_or(i.choice_group is not null) as grouped
      from public.question_paper_items i
      where i.paper_id = p_paper_id
      group by i.section_id, coalesce('g' || i.choice_group::text, i.id::text)
    )
    select s.title, s.choose_count,
           (select count(*) from slots sl where sl.section_id = s.id) as slot_count,
           (select coalesce(sum(t.marks), 0) from (
              select sl.marks from slots sl where sl.section_id = s.id order by sl.marks desc limit s.choose_count
            ) t) as effective,
           (select count(*) from slots sl where sl.section_id = s.id and sl.marks <> sl.min_marks) as uneven,
           (select count(*) from slots sl where sl.section_id = s.id and sl.grouped and sl.n = 1) as lonely
    from public.question_paper_sections s
    where s.paper_id = p_paper_id
    order by s.position, s.id
  loop
    if r.slot_count = 0 then
      v_warnings := v_warnings || format('Section "%s" has no questions.', r.title);
    end if;
    if r.choose_count is not null and r.choose_count > r.slot_count then
      v_errors := v_errors || format('Section "%s" says attempt any %s but has only %s.', r.title, r.choose_count, r.slot_count);
    end if;
    if r.uneven > 0 then
      v_warnings := v_warnings || format('Section "%s": OR choices carry different marks; the higher one counts.', r.title);
    end if;
    if r.lonely > 0 then
      v_warnings := v_warnings || format('Section "%s": a choice group has only one question.', r.title);
    end if;
    v_total := v_total + r.effective;
  end loop;

  if v_total <> v_paper.total_marks then
    v_errors := v_errors || format('Questions add up to %s marks, but the paper is for %s.', trim_scale(v_total), trim_scale(v_paper.total_marks));
  end if;

  -- Per-item checks, numbered as printed.
  for r in
    with numbered as (
      select i.*, row_number() over (order by s.position, s.id, i.position, i.id) as qno
      from public.question_paper_items i
      join public.question_paper_sections s on s.id = i.section_id
      where i.paper_id = p_paper_id
    )
    select n.qno,
           (n.type in ('mcq', 'true_false', 'assertion_reason') and nullif(btrim(coalesce(n.answer, '')), '') is null)
             or (n.type in ('multi_select', 'fill_blank', 'match', 'numerical') and n.answer_key is null) as no_key,
           n.source_question_id is not null and coalesce(q.status, '') <> 'approved' as unapproved,
           n.source_question_id is null and n.origin <> 'manual' as unreviewed
    from numbered n
    left join public.question_bank q on q.id = n.source_question_id
    order by n.qno
  loop
    if r.no_key then
      v_errors := v_errors || format('Question %s has no answer key.', r.qno);
    end if;
    if r.unapproved then
      v_errors := v_errors || format('Question %s comes from a bank question that is not approved yet.', r.qno);
    end if;
    if r.unreviewed then
      v_errors := v_errors || format('Question %s is AI-written or imported text that the question bank has not approved.', r.qno);
    end if;
  end loop;

  for r in
    select count(*) as n from public.question_paper_items i
    where i.paper_id = p_paper_id and i.source_question_id is not null
    group by i.source_question_id having count(*) > 1
  loop
    v_errors := v_errors || format('The same bank question is used %s times.', r.n);
  end loop;

  for r in
    with numbered as (
      select i.id, i.body, row_number() over (order by s.position, s.id, i.position, i.id) as qno
      from public.question_paper_items i
      join public.question_paper_sections s on s.id = i.section_id
      where i.paper_id = p_paper_id
    )
    select a.qno as qa, b.qno as qb
    from numbered a join numbered b on a.qno < b.qno
    where extensions.similarity(a.body, b.body) >= 0.8
    order by 1, 2
    limit 20
  loop
    v_warnings := v_warnings || format('Questions %s and %s look alike.', r.qa, r.qb);
  end loop;

  if v_paper.blueprint is not null then
    -- Counts: one per slot (an OR pair counts once), keyed by type and marks.
    for r in
      with expected as (
        select rw ->> 'type' as type, (rw ->> 'marks')::numeric as marks, sum((rw ->> 'count')::int) as n
        from jsonb_array_elements(v_paper.blueprint -> 'sections') sec,
             jsonb_array_elements(coalesce(sec -> 'rows', '[]'::jsonb)) rw
        group by 1, 2
      ), reps as (
        select distinct on (i.section_id, coalesce('g' || i.choice_group::text, i.id::text)) i.type, i.marks
        from public.question_paper_items i
        where i.paper_id = p_paper_id
        order by i.section_id, coalesce('g' || i.choice_group::text, i.id::text), i.position, i.id
      ), actual as (
        select reps.type, reps.marks, count(*) as n from reps group by 1, 2
      )
      select coalesce(e.type, a.type) as type, coalesce(e.marks, a.marks) as marks, coalesce(e.n, 0) as want, coalesce(a.n, 0) as have
      from expected e full join actual a on a.type = e.type and a.marks = e.marks
      where coalesce(e.n, 0) <> coalesce(a.n, 0)
      order by 1, 2
    loop
      v_errors := v_errors || format('Blueprint: %s × %s (%s marks) planned, %s in the paper.',
        r.want, replace(r.type, '_', ' '), trim_scale(r.marks), r.have);
    end loop;

    if v_total > 0 then
      for r in
        select w ->> 'curriculumUnitId' as unit_id, (w ->> 'percent')::numeric as pct, cu.title
        from jsonb_array_elements(coalesce(v_paper.blueprint -> 'chapterWeights', '[]'::jsonb)) w
        left join public.curriculum_units cu on cu.id::text = w ->> 'curriculumUnitId'
      loop
        select coalesce(sum(i.marks), 0) * 100 / v_total into v_share
        from public.question_paper_items i
        where i.paper_id = p_paper_id and i.curriculum_unit_id::text = r.unit_id
          and (i.choice_group is null or i.id = (
            select j.id from public.question_paper_items j
            where j.section_id = i.section_id and j.choice_group = i.choice_group
            order by j.position, j.id limit 1));
        if abs(v_share - r.pct) > 10 then
          v_warnings := v_warnings || format('Chapter "%s": %s%% of marks planned, %s%% in the paper.',
            coalesce(r.title, 'unknown'), trim_scale(r.pct), round(v_share));
        end if;
      end loop;

      for r in
        select d.key as level, d.value::numeric as pct
        from jsonb_each_text(coalesce(v_paper.blueprint -> 'difficultyMix', '{}'::jsonb)) d
      loop
        select coalesce(sum(i.marks), 0) * 100 / v_total into v_share
        from public.question_paper_items i
        where i.paper_id = p_paper_id and i.difficulty = r.level
          and (i.choice_group is null or i.id = (
            select j.id from public.question_paper_items j
            where j.section_id = i.section_id and j.choice_group = i.choice_group
            order by j.position, j.id limit 1));
        if abs(v_share - r.pct) > 10 then
          v_warnings := v_warnings || format('Difficulty "%s": %s%% of marks planned, %s%% in the paper.', r.level, trim_scale(r.pct), round(v_share));
        end if;
      end loop;
    end if;
  end if;

  return jsonb_build_object(
    'ok', cardinality(v_errors) = 0,
    'errors', to_jsonb(v_errors),
    'warnings', to_jsonb(v_warnings),
    'computedTotal', v_total
  );
end;
$$;

revoke execute on function app.validate_paper(uuid) from public;
grant execute on function app.validate_paper(uuid) to authenticated;

-- PostgREST exposes only `public`; the wrapper is the action's read path.
create function public.validate_question_paper(p_paper_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select app.validate_paper(p_paper_id);
$$;

revoke execute on function public.validate_question_paper(uuid) from public, anon;
grant execute on function public.validate_question_paper(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- public.transition_question_paper — the only way status moves.
-- Security invoker: the row lock needs the caller's UPDATE policy (creator
-- teacher or leadership); approve/publish/archive-approved need
-- app.exam_write_roles() (= paper.approve / paper.publish).
-- Publish links (or creates) the exam_papers row for offline marks entry:
-- the explicit exam_paper_id, else (exam, section, subject); its max/pass
-- marks follow the paper unless marks were already entered against it.
-- ---------------------------------------------------------------------------

create function public.transition_question_paper(
  p_paper_id uuid, p_to text, p_reason text default null, p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_paper public.question_papers;
  v_uid uuid := app.current_user_id();
  v_check jsonb;
  v_version int;
  v_exam_paper_id uuid;
  v_ep public.exam_papers;
begin
  if p_to not in ('draft', 'in_review', 'approved', 'published', 'archived') then
    raise exception 'code:validation_failed' using detail = 'Unknown paper status.';
  end if;
  if p_reason is not null and char_length(p_reason) > 500 then
    raise exception 'code:validation_failed' using detail = 'Reason is too long.';
  end if;

  select * into v_paper from public.question_papers where id = p_paper_id for update;
  if not found then
    raise exception 'code:not_found' using detail = 'Paper not found, or you cannot change it.';
  end if;
  -- Milliseconds: a JS Date round-trip drops microseconds.
  if p_expected_updated_at is not null
     and date_trunc('milliseconds', v_paper.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'code:conflict' using detail = 'The paper changed since you opened it. Reload and review it again.';
  end if;

  if not (
    (v_paper.status = 'draft' and p_to = 'in_review')
    or (v_paper.status = 'in_review' and p_to = 'draft')
    or (v_paper.status in ('draft', 'in_review') and p_to = 'approved')
    or (v_paper.status = 'approved' and p_to = 'published')
    or (v_paper.status <> 'archived' and p_to = 'archived')
  ) then
    raise exception 'code:invalid_state' using detail = format('A %s paper cannot move to %s.', replace(v_paper.status, '_', ' '), replace(p_to, '_', ' '));
  end if;

  if (p_to in ('approved', 'published') or (p_to = 'archived' and v_paper.status in ('approved', 'published')))
     and v_uid is not null
     and v_paper.institution_id not in (select app.my_institution_ids(app.exam_write_roles())) then
    raise exception 'code:forbidden' using detail = 'Only the owner, principal or exam controller can approve, publish or archive an approved paper.';
  end if;

  if p_to in ('approved', 'published') then
    v_check := app.validate_paper(p_paper_id);
    if not (v_check ->> 'ok')::boolean then
      raise exception 'code:validation_failed' using detail = 'Fix the paper first: ' ||
        (select string_agg(e, ' ') from jsonb_array_elements_text(v_check -> 'errors') e);
    end if;
  end if;

  perform set_config('app.allow_paper_transition', 'on', true);

  v_version := v_paper.current_version + case when p_to in ('approved', 'published') then 1 else 0 end;
  v_exam_paper_id := v_paper.exam_paper_id;

  if p_to = 'published' then
    if v_exam_paper_id is null and v_paper.exam_id is not null and v_paper.section_id is not null then
      select ep.id into v_exam_paper_id from public.exam_papers ep
      where ep.exam_id = v_paper.exam_id and ep.class_section_id = v_paper.section_id and ep.subject_id = v_paper.subject_id;
      if v_exam_paper_id is null then
        insert into public.exam_papers (institution_id, exam_id, class_section_id, subject_id, max_marks, pass_marks, held_on)
        values (v_paper.institution_id, v_paper.exam_id, v_paper.section_id, v_paper.subject_id, v_paper.total_marks, v_paper.pass_marks, v_paper.exam_date)
        returning id into v_exam_paper_id;
      end if;
    end if;
    if v_exam_paper_id is not null then
      -- Locked first: marks entered between this check and the update would be out of the old max.
      select * into v_ep from public.exam_papers where id = v_exam_paper_id for update;
      if (v_ep.max_marks, v_ep.pass_marks) is distinct from (v_paper.total_marks, v_paper.pass_marks) then
        if exists (select 1 from public.marks m where m.exam_paper_id = v_exam_paper_id) then
          raise exception 'code:conflict' using detail = format(
            'Marks are already entered out of %s for this exam paper; this paper is out of %s.', trim_scale(v_ep.max_marks), trim_scale(v_paper.total_marks));
        end if;
        update public.exam_papers set max_marks = v_paper.total_marks, pass_marks = v_paper.pass_marks where id = v_exam_paper_id;
      end if;
    end if;
    -- A published revision replaces the paper it revises; any other published paper on the same marks entry is a conflict.
    if v_paper.revision_of_id is not null then
      update public.question_papers set status = 'archived' where id = v_paper.revision_of_id and status = 'published';
    end if;
    if v_exam_paper_id is not null and exists (
      select 1 from public.question_papers q
      where q.exam_paper_id = v_exam_paper_id and q.status = 'published' and q.id <> p_paper_id
    ) then
      raise exception 'code:conflict' using detail = 'Another published paper already feeds this exam''s marks entry. Archive it first.';
    end if;
  end if;

  update public.question_papers set
    status = p_to,
    current_version = v_version,
    approved_by = case when p_to = 'approved' then v_uid when p_to in ('draft', 'in_review') then null else approved_by end,
    approved_at = case when p_to = 'approved' then now() when p_to in ('draft', 'in_review') then null else approved_at end,
    published_at = case when p_to = 'published' then now() else published_at end,
    exam_paper_id = v_exam_paper_id
  where id = p_paper_id;

  if p_to in ('approved', 'published') then
    insert into public.question_paper_versions (institution_id, paper_id, version_no, snapshot, reason, created_by)
    select p.institution_id, p.id, v_version,
      jsonb_build_object(
        'paper', to_jsonb(p) - array['created_at', 'updated_at'],
        'sections', coalesce((
          select jsonb_agg(
            (to_jsonb(s) - array['created_at', 'updated_at']) || jsonb_build_object('items', coalesce((
              select jsonb_agg(to_jsonb(i) - array['created_at', 'updated_at'] order by i.position, i.id)
              from public.question_paper_items i where i.section_id = s.id
            ), '[]'::jsonb))
            order by s.position, s.id)
          from public.question_paper_sections s where s.paper_id = p.id
        ), '[]'::jsonb)
      ),
      coalesce(p_reason, p_to), v_uid
    from public.question_papers p where p.id = p_paper_id;
  end if;

  perform set_config('app.allow_paper_transition', 'off', true);

  return jsonb_build_object('status', p_to, 'version', v_version, 'examPaperId', v_exam_paper_id, 'validation', v_check);
end;
$$;

revoke execute on function public.transition_question_paper(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.transition_question_paper(uuid, text, text, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- public.copy_question_paper — duplicate (any visible paper) or new revision
-- (approved/published only; keeps the exam link, sets revision_of_id).
-- Security invoker: the copy is a draft created by the caller under RLS.
-- ---------------------------------------------------------------------------

create function public.copy_question_paper(p_paper_id uuid, p_as_revision boolean)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_src public.question_papers;
  v_new uuid;
  v_section uuid;
  s record;
begin
  select * into v_src from public.question_papers where id = p_paper_id;
  if not found then
    raise exception 'code:not_found' using detail = 'Paper not found.';
  end if;
  if p_as_revision and v_src.status not in ('approved', 'published') then
    raise exception 'code:invalid_state' using detail = 'Only an approved or published paper needs a new revision; edit the draft directly.';
  end if;

  -- Lets the guards accept revision_of_id and the items' origin as copied.
  perform set_config('app.allow_paper_copy', 'on', true);

  insert into public.question_papers (
    institution_id, academic_year_id, grade_id, section_id, subject_id, exam_id, exam_paper_id, template_id, revision_of_id,
    title, exam_type, exam_date, duration_minutes, total_marks, pass_marks, instructions, negative_marking, blueprint
  ) values (
    v_src.institution_id, v_src.academic_year_id, v_src.grade_id, v_src.section_id, v_src.subject_id,
    v_src.exam_id, case when p_as_revision then v_src.exam_paper_id end, v_src.template_id,
    case when p_as_revision then v_src.id end,
    case when p_as_revision then v_src.title else left('Copy of ' || v_src.title, 200) end,
    v_src.exam_type, v_src.exam_date, v_src.duration_minutes, v_src.total_marks, v_src.pass_marks,
    v_src.instructions, v_src.negative_marking, v_src.blueprint
  ) returning id into v_new;

  for s in select * from public.question_paper_sections where paper_id = p_paper_id order by position, id loop
    insert into public.question_paper_sections (institution_id, paper_id, title, instructions, position, choose_count)
    values (s.institution_id, v_new, s.title, s.instructions, s.position, s.choose_count)
    returning id into v_section;

    insert into public.question_paper_items (
      institution_id, paper_id, section_id, position, source_question_id, derived_from_question_id, origin, type, body, options, answer, answer_key, marks,
      explanation, marking_scheme, difficulty, curriculum_unit_id, curriculum_topic_id, source_subject_textbook_id,
      source_chapter_no, source_page, choice_group
    )
    select i.institution_id, v_new, v_section, i.position, i.source_question_id, i.derived_from_question_id, i.origin, i.type, i.body, i.options, i.answer, i.answer_key, i.marks,
      i.explanation, i.marking_scheme, i.difficulty, i.curriculum_unit_id, i.curriculum_topic_id, i.source_subject_textbook_id,
      i.source_chapter_no, i.source_page, i.choice_group
    from public.question_paper_items i
    where i.section_id = s.id;
  end loop;

  perform set_config('app.allow_paper_copy', 'off', true);
  return v_new;
end;
$$;

revoke execute on function public.copy_question_paper(uuid, boolean) from public, anon;
grant execute on function public.copy_question_paper(uuid, boolean) to authenticated, service_role;
